using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.State;
using RushsiteMatch.Core.Stats;

namespace RushsiteMatch.Core.Match;

public enum MatchPhase
{
    Warmup,
    Live,
    Ended,
    Abandoned,
}

// Runs one match. Call every method from the game thread.
//
// Two flows share this class and the split is decided once by the win condition.
//
// Aim modes (first_to_N). The plugin manages the match. It holds warmup, runs !ready and !unready,
// validates sides, sets mp_maxrounds and related convars, starts the match, pauses on disconnect.
//
// Rush (valve_rush). Valve's rush_001.js runs round rules and the match end.
// The plugin never touches mp_ round convars or pauses. It does hold each config team on its
// configured side (teams[0] CT and teams[1] T by default) and holds warmup until all six are
// in and on their side. Both are server fill, not rule changes.
//
// Both flows enforce the whitelist and password, record and upload the demo, track rounds and stats,
// and emit round_end, match_end and match_abandoned.
public sealed class MatchController
{
    public const string ChatPrefix = "[rushsite]";

    private readonly MatchConfig _cfg;
    private readonly MatchSettings _settings;
    private readonly IGameServer _game;
    private readonly IEventSink _sink;
    private readonly IClock _clock;
    private readonly IDemoUploader _uploader;
    private readonly IMatchStateStore? _store;

    private readonly PresenceTracker _presence;
    private readonly SideMap _sides;
    private readonly StatsAggregator _stats;
    private readonly ReadyTracker? _ready;
    private readonly FirstToScoreTracker? _firstTo;
    private readonly RushScoreTracker? _rush;
    private readonly Dictionary<string, int> _teamScore;

    private int _round;
    // True from round_end until the next round starts. Kills in that gap belong to the round that just ended.
    private bool _betweenRounds;
    private string? _currentArena;
    private bool _started;
    private bool _recording;
    private bool _pausedForDisconnect;
    private DateTimeOffset? _allConnectedSince;
    private DateTimeOffset? _endDeadline;
    private DateTimeOffset? _stopDemoAt;
    private DateTimeOffset _lastReminder;
    private DateTimeOffset _lastLineupReminder = DateTimeOffset.MinValue;
    private bool _warmupHeld;

    // Fully connected players Steam has not authorized yet, by user id, with the id they claim.
    private readonly Dictionary<int, string?> _awaitingAuth = new();
    private readonly HashSet<string> _loggedOnServer = new();
    private readonly Dictionary<string, int> _joinRefusals = new();
    private readonly Dictionary<string, int> _forcedMoves = new();
    public const int MaxForcedMovesPerPlayer = 5;

    public MatchController(
        MatchConfig cfg,
        MatchSettings settings,
        IGameServer game,
        IEventSink sink,
        IClock clock,
        IDemoUploader uploader,
        IMatchStateStore? store = null)
    {
        _cfg = cfg;
        _settings = settings;
        _game = game;
        _sink = sink;
        _clock = clock;
        _uploader = uploader;
        _store = store;

        _presence = new PresenceTracker(cfg.AllowedSteamIds, clock.UtcNow);
        _sides = new SideMap(cfg, fixedFromConfig: !cfg.ParsedWinCondition.PluginManagesMatch);
        _stats = new StatsAggregator(cfg.AllowedSteamIds, cfg.TeamOf);
        _teamScore = cfg.Teams.ToDictionary(t => t.Name, _ => 0);

        if (ManagesMatch)
        {
            _ready = new ReadyTracker(cfg.AllowedSteamIds);
            _firstTo = new FirstToScoreTracker(cfg.ParsedWinCondition.RoundsToWin, cfg.Teams.Select(t => t.Name));
        }
        else
        {
            _rush = new RushScoreTracker();
        }
    }

    public MatchPhase Phase { get; private set; } = MatchPhase.Warmup;
    public bool ManagesMatch => _cfg.ParsedWinCondition.PluginManagesMatch;
    public bool IsRush => !ManagesMatch;
    public int Round => _round;
    public IReadOnlyDictionary<string, int> Score => _teamScore;
    public string DemoName => "rushsite_" + SafeName(_cfg.MatchId);
    public string DemoPath => Path.Combine(_game.CsgoDirectory, DemoName + ".dem");
    public Task? UploadTask { get; private set; }
    public bool DemoPending => _recording || UploadTask is { IsCompleted: false };

    // Called once after the config is loaded and the map is up.
    public void Start()
    {
        if (_started) return;
        _started = true;
        ApplyServerSetup();
        if (ManagesMatch)
        {
            _game.ExecuteCommand("mp_warmup_start");
            _game.ExecuteCommand("mp_warmup_pausetimer 1");
        }
        else
        {
            HoldRushWarmup();
        }
        _game.Log($"match {_cfg.MatchId} mode {_cfg.Mode} win condition {_cfg.WinCondition}. " +
                  (ManagesMatch ? "Plugin manages warmup and rounds." : "Valve's Rush rules. Plugin holds teams on their configured sides."));
        _sink.Enqueue(new ServerReady());
        SaveState();
    }

    // Called instead of Start after a plugin reload when the saved state belongs to this match.
    // server_ready is not sent again and warmup is not restarted.
    public void Restore(MatchState st)
    {
        if (_started) return;
        _started = true;
        ApplyServerSetup();
        Phase = Enum.TryParse<MatchPhase>(st.Phase, out var ph) ? ph : MatchPhase.Warmup;
        _round = Math.Max(0, st.Round);
        foreach (var t in _teamScore.Keys.ToList())
            _teamScore[t] = st.Score.TryGetValue(t, out var v) ? v : 0;
        _firstTo?.Restore(_teamScore);
        if (_rush is not null)
        {
            Side? decided = st.RushDecided switch { "T" => Side.T, "CT" => Side.CT, _ => null };
            _rush.Restore(st.RushFrontSlot ?? RushScoreTracker.StartSlot, st.RushTWins ?? 0, st.RushCtWins ?? 0,
                st.RushRoundsPlayed ?? _round, decided);
        }
        _stats.Restore(st.Players);
        _recording = st.Recording;
        _currentArena = st.Arena;

        switch (Phase)
        {
            case MatchPhase.Warmup:
                if (ManagesMatch) _game.ExecuteCommand("mp_warmup_pausetimer 1");
                else HoldRushWarmup();
                break;
            case MatchPhase.Live:
                _ready?.Close();
                var decidedNow = _firstTo?.DecidedWinner is not null || _rush?.DecidedWinner is not null;
                if (decidedNow || _round >= _cfg.ParsedWinCondition.MaxRounds)
                    _endDeadline = _clock.UtcNow + _settings.MatchEndWait;
                break;
            case MatchPhase.Ended:
            case MatchPhase.Abandoned:
                _ready?.Close();
                ScheduleDemoStop();
                break;
        }
        _game.Log($"restored match {_cfg.MatchId} after a plugin reload. phase {Phase} round {_round} " +
                  $"score {string.Join(" ", _teamScore.Select(kv => kv.Key + "=" + kv.Value))}.");
        if (Phase == MatchPhase.Warmup && ManagesMatch)
            _game.PrintToAll($"{ChatPrefix} The match plugin reloaded. Type !ready again.");
        SaveState();
    }

    private void HoldRushWarmup()
    {
        if (!_settings.HoldRushWarmup) return;
        _game.ExecuteCommand("mp_warmup_pausetimer 1");
        _warmupHeld = true;
    }

    public void OnMapStart()
    {
        if (_started) ApplyServerSetup();
    }

    private void ApplyServerSetup()
    {
        VerifyPassword();
        if (_settings.KickBots)
        {
            _game.ExecuteCommand("bot_quota 0");
            _game.ExecuteCommand("bot_kick");
        }
        if (ManagesMatch)
        {
            _game.ExecuteCommand("mp_autoteambalance 0");
            _game.ExecuteCommand("mp_limitteams 0");
        }
    }

    // gamemode_rush.cfg sets bot_quota 2 in fill mode and can run after the agent's cfg.
    // Bots are server fill, not a game rule, so this is enforced in every mode.
    private void EnforceNoBots()
    {
        if (!_settings.KickBots) return;
        var quota = _game.GetConVar("bot_quota");
        if (quota is null || quota == "0") return;
        _game.Log($"bot_quota is {quota}. Setting it to 0.");
        _game.ExecuteCommand("bot_quota 0");
        _game.ExecuteCommand("bot_kick");
    }

    public bool VerifyPassword()
    {
        var current = _game.GetConVar("sv_password") ?? "";
        if (current == _cfg.Password) return true;
        _game.Log("sv_password does not match match.json. Setting it from match.json.");
        _game.ExecuteCommand($"sv_password \"{_cfg.Password.Replace("\"", "")}\"");
        return false;
    }

    // Steam confirmed the player's id. Returns false when the player was kicked.
    // A player who already finished connecting is counted as connected now.
    public bool OnClientAuthorized(string steamId, int userId)
    {
        if (!CheckWhitelist(steamId, userId))
        {
            _awaitingAuth.Remove(userId);
            return false;
        }
        if (_awaitingAuth.Remove(userId))
        {
            _game.Log($"{steamId} authorized after connecting. Counting them as connected.");
            OnPlayerConnected(steamId, userId);
        }
        return true;
    }

    // player_connect_full. authorizedSteamId is null when Steam has not confirmed the player yet.
    public void OnPlayerConnectFull(int userId, string? authorizedSteamId, string? claimedSteamId)
    {
        if (authorizedSteamId is not null)
        {
            _awaitingAuth.Remove(userId);
            OnPlayerConnected(authorizedSteamId, userId);
            return;
        }
        _awaitingAuth[userId] = claimedSteamId;
        _game.Log($"user {userId} ({claimedSteamId ?? "unknown"}) is in but not authorized by Steam yet.");
    }

    private bool CheckWhitelist(string steamId, int userId)
    {
        if (_cfg.IsAllowed(steamId)) return true;
        _game.Log($"kicking {steamId}. Not on the match whitelist.");
        _game.Kick(userId, "You are not a player in this match");
        return false;
    }

    // Call only with a Steam authorized id.
    public void OnPlayerConnected(string steamId, int userId)
    {
        if (!CheckWhitelist(steamId, userId)) return;
        if (!_presence.Connect(steamId)) return;
        _sink.Enqueue(new PlayerConnected(steamId));

        if (_presence.AllConnected)
        {
            _allConnectedSince = _clock.UtcNow;
            // Rush records from the moment everyone is in so nothing Valve's script does is missed.
            if (IsRush && Phase == MatchPhase.Warmup) StartRecording();
            if (_pausedForDisconnect && Phase == MatchPhase.Live)
            {
                _pausedForDisconnect = false;
                _game.ExecuteCommand("mp_unpause_match");
                _game.PrintToAll($"{ChatPrefix} All players are back. Unpausing.");
            }
        }

        if (ManagesMatch && Phase == MatchPhase.Warmup)
        {
            var required = _sides.RequiredSide(steamId);
            if (required is not null && _settings.TryChangeTeam) _game.TryMovePlayer(steamId, required.Value);
            _game.PrintToPlayer(steamId, $"{ChatPrefix} Join your team's side then type !ready.");
        }
        if (IsRush && Phase == MatchPhase.Warmup)
            _game.PrintToPlayer(steamId, $"{ChatPrefix} Your team plays {SideName(RequiredRushSide(steamId))}.");
    }

    public void OnPlayerDisconnected(string steamId, int? userId = null)
    {
        if (userId is int uid) _awaitingAuth.Remove(uid);
        foreach (var k in _awaitingAuth.Where(kv => kv.Value == steamId).Select(kv => kv.Key).ToList()) _awaitingAuth.Remove(k);
        _sides.RemovePlayer(steamId);
        if (!_presence.Disconnect(steamId, _clock.UtcNow)) return;
        _allConnectedSince = null;
        _ready?.Drop(steamId);
        if (Phase is MatchPhase.Warmup or MatchPhase.Live) _sink.Enqueue(new PlayerDisconnected(steamId));

        if (ManagesMatch && Phase == MatchPhase.Live && _settings.PauseOnDisconnect && !_pausedForDisconnect)
        {
            _pausedForDisconnect = true;
            _game.ExecuteCommand("mp_pause_match");
            _game.PrintToAll($"{ChatPrefix} A player disconnected. The match pauses at the next freeze time.");
        }
    }

    public void OnPlayerTeam(string steamId, Side side)
    {
        if (!_cfg.IsAllowed(steamId)) return;
        var before = _sides.SideOfPlayer(steamId);
        _sides.SetPlayerSide(steamId, side);
        if (_ready is not null && Phase == MatchPhase.Warmup && before != side && _ready.Ready.Contains(steamId))
        {
            _ready.Drop(steamId);
            _game.PrintToPlayer(steamId, $"{ChatPrefix} You changed side so you are no longer ready.");
        }
        // The game can place a player without a jointeam, for example auto assign. Send them to their side.
        if (IsRush && EnforcesRushTeams && side.IsPlaying() && !_sides.IsOnRequiredSide(steamId))
            RedirectToRequiredSide(steamId, "placed on the wrong side");
    }

    private bool EnforcesRushTeams => Phase is MatchPhase.Warmup or MatchPhase.Live;

    private Side RequiredRushSide(string steamId) => _sides.RequiredSide(steamId) ?? Side.None;

    private void RedirectToRequiredSide(string steamId, string why)
    {
        var required = RequiredRushSide(steamId);
        if (!required.IsPlaying()) return;
        var moves = _forcedMoves.GetValueOrDefault(steamId);
        if (moves >= MaxForcedMovesPerPlayer)
        {
            if (moves == MaxForcedMovesPerPlayer)
                _game.Log($"{steamId} keeps landing off {required} ({why}). Stopped moving them. Something else is assigning teams.");
            _forcedMoves[steamId] = moves + 1;
            return;
        }
        _forcedMoves[steamId] = moves + 1;
        _game.Log($"{steamId} {why}. Sending them to {required}.");
        _game.ForceJoinTeam(steamId, required);
        if (_settings.TryChangeTeam) _game.TryMovePlayer(steamId, required);
    }

    // Returns false to block the jointeam.
    // Aim modes block joins to the wrong side. Rush allows only the configured side of the player's team,
    // re-issues the right jointeam for them, and kicks after repeated wrong picks.
    public bool OnJoinTeamRequest(string steamId, Side requested)
    {
        if (!_cfg.IsAllowed(steamId)) return true;
        if (IsRush) return OnRushJoinTeam(steamId, requested);
        if (Phase != MatchPhase.Warmup)
        {
            // Mid match a player may only return to the side the team is playing.
            var teamSide = _sides.SideOfTeam(_cfg.TeamOf(steamId)!);
            return !requested.IsPlaying() || !teamSide.IsPlaying() || requested == teamSide;
        }
        if (_sides.IsJoinAllowed(steamId, requested)) return true;
        _game.PrintToPlayer(steamId, $"{ChatPrefix} That side belongs to the other team. Join {_sides.RequiredSide(steamId)}.");
        return false;
    }

    private bool OnRushJoinTeam(string steamId, Side requested)
    {
        if (!EnforcesRushTeams) return true;
        var required = RequiredRushSide(steamId);
        if (!required.IsPlaying()) return true;
        if (requested == required)
        {
            if (!SideHasRoom(required, steamId))
            {
                _game.PrintToPlayer(steamId, $"{ChatPrefix} {SideName(required)} is full.");
                return false;
            }
            return true;
        }

        // jointeam 0 is auto select. Not the player's fault, so it is not counted.
        if (requested != Side.None)
        {
            var refusals = _joinRefusals.GetValueOrDefault(steamId) + 1;
            _joinRefusals[steamId] = refusals;
            if (refusals >= _settings.TeamJoinRefusalsBeforeKick)
            {
                _game.Log($"kicking {steamId} after {refusals} joins to the wrong side.");
                _joinRefusals[steamId] = 0;
                _game.KickPlayer(steamId,
                    $"Your team plays {SideName(required)} in this match. Reconnect and join {SideName(required)}.");
                return false;
            }
            _game.PrintToPlayer(steamId,
                $"{ChatPrefix} Your team plays {SideName(required)} in this match. Moving you there.");
        }
        _game.ForceJoinTeam(steamId, required);
        if (_settings.TryChangeTeam) _game.TryMovePlayer(steamId, required);
        return false;
    }

    // Only the team's own players may stand on its side, and never more than the team size.
    private bool SideHasRoom(Side side, string joiner)
    {
        var team = _cfg.TeamOf(joiner);
        var size = _cfg.Teams.First(t => t.Name == team).SteamIds.Count;
        // Players of the other team on this side are being sent back, so they do not take a slot.
        var others = _game.GetPlayerSides().Count(p =>
            p.Side == side && p.SteamId != joiner && (_cfg.TeamOf(p.SteamId) is null || _cfg.TeamOf(p.SteamId) == team));
        return others < size;
    }

    private static string SideName(Side s) => s == Side.CT ? "CT" : s == Side.T ? "T" : s.ToString();

    // Rush. Players who are not in or not on their side. They count as not ready.
    public IReadOnlyList<string> RushNotReady() =>
        _cfg.AllowedSteamIds.Where(id => !_presence.IsConnected(id) || !_sides.IsOnRequiredSide(id)).ToList();

    // Rush. Connected players standing anywhere but their configured side.
    public IReadOnlyList<string> WrongSidePlayers() =>
        _cfg.AllowedSteamIds.Where(id => _presence.IsConnected(id) && !_sides.IsOnRequiredSide(id)).ToList();

    public string OnReady(string steamId)
    {
        if (_ready is null) return $"{ChatPrefix} Ready-up is not used in Rush. Valve's warmup starts the match.";
        var side = _sides.SideOfPlayer(steamId);
        var required = _sides.RequiredSide(steamId);
        var valid = side.IsPlaying() && (required is null || required == side);
        var result = _ready.SetReady(steamId, valid);
        var msg = result switch
        {
            ReadyResult.Ok => $"{ChatPrefix} You are ready.",
            ReadyResult.AlreadyReady => $"{ChatPrefix} You are already ready.",
            ReadyResult.WrongSide => $"{ChatPrefix} Join your team's side before readying up.",
            ReadyResult.NotInWarmup => $"{ChatPrefix} The match has already started.",
            _ => $"{ChatPrefix} You are not a player in this match.",
        };
        if (result == ReadyResult.Ok)
        {
            _game.PrintToAll($"{ChatPrefix} {_ready.Ready.Count}/{_cfg.AllowedSteamIds.Count} ready.");
            TryStartWhenReady();
        }
        return msg;
    }

    public string OnUnready(string steamId)
    {
        if (_ready is null) return $"{ChatPrefix} Ready-up is not used in Rush.";
        return _ready.SetUnready(steamId) switch
        {
            ReadyResult.Ok => $"{ChatPrefix} You are no longer ready.",
            ReadyResult.NotReady => $"{ChatPrefix} You were not ready.",
            ReadyResult.NotInWarmup => $"{ChatPrefix} The match has already started.",
            _ => $"{ChatPrefix} You are not a player in this match.",
        };
    }

    private void TryStartWhenReady()
    {
        if (_ready is null || Phase != MatchPhase.Warmup) return;
        if (_presence.AllConnected && _ready.AllReady && _sides.TeamsAreValid(_cfg.AllowedSteamIds))
            StartAimMatch("all players ready");
    }

    // Admin override from the server console. Aim modes only.
    public bool ForceStart()
    {
        if (!ManagesMatch || Phase != MatchPhase.Warmup) return false;
        StartAimMatch("forced from console");
        return true;
    }

    private void StartAimMatch(string why)
    {
        var wc = _cfg.ParsedWinCondition;
        _ready!.Close();
        _game.Log($"starting match. {why}.");
        // Runs first. The cfg sets pausetimer 1 and its startmoney only applies on the warmup end restart.
        _game.ExecuteCommand($"exec rushsite/matches/{_cfg.MatchId}/mode.cfg");
        _game.ExecuteCommand($"mp_maxrounds {wc.MaxRounds}");
        _game.ExecuteCommand("mp_match_can_clinch 1");
        _game.ExecuteCommand("mp_overtime_enable 0");
        _game.ExecuteCommand($"mp_halftime {(_settings.AimHalftime ? 1 : 0)}");
        _game.ExecuteCommand("mp_warmup_pausetimer 0");
        StartRecording();
        _game.ExecuteCommand("mp_warmup_end");
        GoLive();
        _game.PrintToAll($"{ChatPrefix} Match is live. First to {wc.RoundsToWin}.");
    }

    // Rush only. Called on round_announce_match_start, begin_new_match or the first
    // round after warmup, whichever comes first.
    public void OnRushMatchLive()
    {
        if (!IsRush || Phase != MatchPhase.Warmup) return;
        RefreshAllSides();
        var notReady = RushNotReady();
        if (notReady.Count > 0)
            _game.Log($"Rush went live with players missing or off their side: {string.Join(",", notReady)}.");
        _warmupHeld = false;
        StartRecording();
        GoLive();
    }

    private void GoLive()
    {
        Phase = MatchPhase.Live;
        _stats.Reset();
        _round = 0;
        _betweenRounds = false;
        _sink.Enqueue(new MatchStarted());
        SaveState();
    }

    private void StartRecording()
    {
        if (_recording) return;
        if (_game.GetConVar("tv_enable") != "1")
            _game.Log("tv_enable is not 1. tv_record will fail. Start the server with +tv_enable 1.");
        _game.ExecuteCommand($"tv_record \"{DemoName}\"");
        _recording = true;
    }

    public void OnRoundStart()
    {
        _betweenRounds = false;
    }

    public void OnRoundFreezeEnd(bool isWarmup)
    {
        _betweenRounds = false;
        if (IsRush)
        {
            if (!isWarmup) OnRushMatchLive();
            if (Phase == MatchPhase.Live) _currentArena = _game.DetectRushArena() ?? _currentArena;
        }
    }

    public void OnRoundEnd(Side winner, bool gameCommencing, bool isWarmup)
    {
        if (Phase != MatchPhase.Live || gameCommencing || isWarmup) return;
        RefreshSides();
        _round++;
        _betweenRounds = true;

        var winnerTeam = _sides.TeamOnSide(winner);
        if (winnerTeam is not null) _teamScore[winnerTeam]++;

        string? decided = null;
        if (_firstTo is not null)
        {
            decided = _firstTo.RecordRound(winnerTeam);
        }
        else if (_rush is not null)
        {
            var side = _rush.RecordRound(winner);
            if (side is not null) decided = _sides.TeamOnSide(side.Value) ?? LeadingTeam();
        }

        if (IsRush)
        {
            var wrong = WrongSidePlayers();
            if (wrong.Count > 0)
                _game.Log($"round {_round}: players off their configured side: {string.Join(",", wrong)}. Score follows the config sides.");
        }

        var label = winnerTeam ?? (winner.IsPlaying() ? "unknown_" + winner : MatchEventJson.Draw);
        _sink.Enqueue(new RoundEnd(_round, label, new Dictionary<string, int>(_teamScore))
        {
            Arena = IsRush ? _currentArena : null,
        });

        var maxed = _round >= _cfg.ParsedWinCondition.MaxRounds;
        if ((decided is not null || maxed) && _endDeadline is null)
        {
            // Give cs_win_panel_match a chance to arrive first. It is the preferred end signal.
            _endDeadline = _clock.UtcNow + _settings.MatchEndWait;
        }
        SaveState();
    }

    public void OnWinPanelMatch()
    {
        if (Phase != MatchPhase.Live) return;
        FinishMatch("cs_win_panel_match");
    }

    public void OnPlayerDeath(DeathInfo d)
    {
        if (Phase != MatchPhase.Live || d.Victim is null) return;
        _stats.RecordDeath(d.Attacker, d.Victim, d.Headshot);
        EmitKill(d);
    }

    // Only frags between two match players are sent. Suicides and world deaths are left out.
    // Team kills are sent. The API can tell them apart by team.
    private void EmitKill(DeathInfo d)
    {
        var attacker = d.Attacker;
        var victim = d.Victim!;
        if (attacker is null || attacker == victim) return;
        if (!_cfg.IsAllowed(attacker) || !_cfg.IsAllowed(victim)) return;
        var assister = d.Assister;
        if (assister is not null && (assister == attacker || assister == victim || !_cfg.IsAllowed(assister))) assister = null;
        var round = _betweenRounds ? _round : _round + 1;
        var weapon = string.IsNullOrWhiteSpace(d.Weapon) ? "unknown" : d.Weapon.Trim();
        _sink.Enqueue(new Kill(round, Math.Max(0, d.Tick), attacker, victim, weapon, d.Headshot, d.Penetrated > 0)
        {
            Assister = assister,
        });
    }

    public void OnPlayerHurt(string? attacker, string? victim, int healthDamage)
    {
        if (Phase != MatchPhase.Live) return;
        _stats.RecordDamage(attacker, victim, healthDamage);
    }

    public void Tick()
    {
        var now = _clock.UtcNow;
        EnforceNoBots();
        switch (Phase)
        {
            case MatchPhase.Warmup:
            case MatchPhase.Live:
                SyncConnectedPlayers();
                if (CheckAbandon(now)) return;
                if (Phase == MatchPhase.Warmup && IsRush) TickRushWarmup(now);
                if (Phase == MatchPhase.Warmup) TickWarmup(now);
                if (Phase == MatchPhase.Live && _endDeadline is not null && now >= _endDeadline)
                    FinishMatch("score tracking");
                break;
        }
        if (_stopDemoAt is not null && now >= _stopDemoAt) StopDemoAndUpload();
    }

    private void TickWarmup(DateTimeOffset now)
    {
        if (_ready is null) return;
        TryStartWhenReady();
        if (Phase != MatchPhase.Warmup || _allConnectedSince is null) return;
        if (now - _allConnectedSince < _settings.ReadyTimeout) return;
        if (_sides.TeamsAreValid(_cfg.AllowedSteamIds))
        {
            StartAimMatch("ready timeout");
        }
        else if (now - _lastReminder >= TimeSpan.FromSeconds(15))
        {
            _lastReminder = now;
            _game.PrintToAll($"{ChatPrefix} Ready timeout passed. The match starts as soon as each team is on its own side.");
        }
    }

    // Catches authorized players whose connect or authorize event was missed or arrived out of order.
    private void SyncConnectedPlayers()
    {
        foreach (var p in _game.ConnectedPlayers())
        {
            if (!p.Authorized || _presence.IsConnected(p.SteamId)) continue;
            _awaitingAuth.Remove(p.UserId);
            OnPlayerConnected(p.SteamId, p.UserId);
        }
    }

    // Match players who are on the server but not counted yet, usually because Steam has not authorized them.
    // They are never treated as missing.
    private HashSet<string> OnServerNotCounted()
    {
        var ids = new HashSet<string>();
        foreach (var claimed in _awaitingAuth.Values)
            if (claimed is not null) ids.Add(claimed);
        foreach (var p in _game.ConnectedPlayers()) ids.Add(p.SteamId);
        ids.RemoveWhere(id => !_cfg.IsAllowed(id) || _presence.IsConnected(id));
        return ids;
    }

    private void TickRushWarmup(DateTimeOffset now)
    {
        RefreshAllSides();
        var notReady = RushNotReady();
        if (_settings.HoldRushWarmup)
        {
            if (notReady.Count > 0 && (!_warmupHeld || _game.GetConVar("mp_warmup_pausetimer") == "0"))
            {
                HoldRushWarmup();
            }
            else if (notReady.Count == 0 && _warmupHeld)
            {
                _warmupHeld = false;
                _game.ExecuteCommand("mp_warmup_pausetimer 0");
                _game.PrintToAll($"{ChatPrefix} All players are in and on their side. Warmup continues.");
            }
        }
        var wrong = WrongSidePlayers();
        if (wrong.Count > 0 && now - _lastLineupReminder >= TimeSpan.FromSeconds(15))
        {
            _lastLineupReminder = now;
            foreach (var id in wrong)
            {
                _game.PrintToPlayer(id, $"{ChatPrefix} You are not ready. Your team plays {SideName(RequiredRushSide(id))}.");
                RedirectToRequiredSide(id, "is off their side in warmup");
            }
        }
    }

    private bool CheckAbandon(DateTimeOffset now)
    {
        var onServer = OnServerNotCounted();
        var noShows = _presence.NoShows(now, _settings.ConnectGrace).Where(id => !onServer.Contains(id)).ToList();
        var departed = _presence.Departed(now, _settings.DisconnectGrace).Where(id => !onServer.Contains(id)).ToList();
        foreach (var id in onServer)
            if (_loggedOnServer.Add(id))
                _game.Log($"{id} is on the server but not authorized yet. Not counted as missing.");
        if (noShows.Count == 0 && departed.Count == 0) return false;

        var reason = noShows.Count > 0 ? "no_show" : "disconnected";
        var missing = _presence.Missing.Where(id => !onServer.Contains(id)).ToList();
        _game.Log($"abandoning match. {reason}: {string.Join(",", missing)}");
        _game.PrintToAll($"{ChatPrefix} Match abandoned. A player did not connect or return in time.");
        Phase = MatchPhase.Abandoned;
        if (ManagesMatch) _game.ExecuteCommand("mp_pause_match");
        _sink.Enqueue(new MatchAbandoned(reason, missing));
        SaveState();

        // Keep the partial demo for review. demo_uploaded reports it.
        ScheduleDemoStop();
        return true;
    }

    private void FinishMatch(string source)
    {
        RefreshSides();
        var winner = _firstTo?.DecidedWinner
                     ?? (_rush?.DecidedWinner is Side s ? _sides.TeamOnSide(s) : null)
                     ?? LeadingTeam()
                     ?? MatchEventJson.Draw;
        _game.Log($"match over via {source}. Winner {winner}. Score {string.Join(" ", _teamScore.Select(kv => kv.Key + "=" + kv.Value))}.");
        Phase = MatchPhase.Ended;
        // Results go out now. The demo follows in its own demo_uploaded event.
        _sink.Enqueue(new MatchEnd(winner, new Dictionary<string, int>(_teamScore), _stats.Snapshot(), false));
        ScheduleDemoStop();
        SaveState();
    }

    // tv_record writes the delayed GOTV stream so keep recording through tv_delay before stopping.
    private void ScheduleDemoStop()
    {
        if (!_recording || _stopDemoAt is not null) return;
        var delay = double.TryParse(_game.GetConVar("tv_delay"), System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;
        _stopDemoAt = _clock.UtcNow + TimeSpan.FromSeconds(Math.Max(0, delay)) + _settings.DemoStopExtra;
    }

    private void StopDemoAndUpload()
    {
        _stopDemoAt = null;
        _game.ExecuteCommand("tv_stoprecord");
        _recording = false;
        SaveState();
        UploadTask = UploadAndReportAsync();
    }

    private async Task UploadAndReportAsync()
    {
        DemoUploadResult result;
        var url = _cfg.DemoUpload?.PresignedPutUrl;
        if (string.IsNullOrEmpty(url))
        {
            result = DemoUploadResult.Failed("no presignedPutUrl in match.json");
        }
        else
        {
            try
            {
                result = await _uploader.UploadAsync(DemoPath, url, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception e)
            {
                result = DemoUploadResult.Failed(e.Message);
            }
        }
        if (!result.Ok) _game.Log($"demo upload failed: {result.Error}");
        _sink.Enqueue(new DemoUploaded(result.Ok) { Bytes = result.Bytes, Error = result.Error });
    }

    private void RefreshSides()
    {
        foreach (var (id, side) in _game.GetPlayerSides())
            if (_cfg.IsAllowed(id) && side.IsPlaying()) _sides.SetPlayerSide(id, side);
    }

    // Rush lineup checks need every player's side, including spectators and unassigned.
    private void RefreshAllSides()
    {
        foreach (var (id, side) in _game.GetPlayerSides())
            if (_cfg.IsAllowed(id)) _sides.SetPlayerSide(id, side);
    }

    public MatchState Snapshot() => new()
    {
        MatchId = _cfg.MatchId,
        Phase = Phase.ToString(),
        Round = _round,
        Score = new Dictionary<string, int>(_teamScore),
        Recording = _recording,
        Arena = _currentArena,
        RushFrontSlot = _rush?.FrontSlot,
        RushTWins = _rush?.Wins[Side.T],
        RushCtWins = _rush?.Wins[Side.CT],
        RushRoundsPlayed = _rush?.RoundsPlayed,
        RushDecided = _rush?.DecidedWinner?.ToString(),
        Players = _stats.Snapshot().ToList(),
        SavedAt = _clock.UtcNow,
    };

    private void SaveState() => _store?.Save(Snapshot());

    private string? LeadingTeam()
    {
        var ordered = _teamScore.OrderByDescending(kv => kv.Value).ToList();
        if (ordered.Count < 2 || ordered[0].Value == ordered[1].Value) return null;
        return ordered[0].Key;
    }

    private static string SafeName(string s) =>
        new(s.Select(c => char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_' ? c : '_').ToArray());

    public string Status()
    {
        var ready = _ready is null ? "n/a" : $"{_ready.Ready.Count}/{_cfg.AllowedSteamIds.Count}";
        return $"match {_cfg.MatchId} mode {_cfg.Mode} phase {Phase} round {_round} " +
               $"score {string.Join(" ", _teamScore.Select(kv => kv.Key + "=" + kv.Value))} " +
               $"connected {_cfg.AllowedSteamIds.Count - _presence.Missing.Count}/{_cfg.AllowedSteamIds.Count} ready {ready} " +
               $"recording {_recording}" + (IsRush ? $" arena {_currentArena ?? "?"} front {_rush!.FrontSlot} " +
               $"lineup {_cfg.AllowedSteamIds.Count - RushNotReady().Count}/{_cfg.AllowedSteamIds.Count} " +
               $"wrong side [{string.Join(",", WrongSidePlayers())}] warmup held {_warmupHeld}" : "");
    }
}
