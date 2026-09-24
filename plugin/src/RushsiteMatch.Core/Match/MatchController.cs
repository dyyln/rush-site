using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.State;
using RushsiteMatch.Core.Stats;

namespace RushsiteMatch.Core.Match;

public enum MatchPhase
{
    Warmup,
    Live,
    // Series only. A map ended and the next one is about to load.
    BetweenMaps,
    Ended,
    Abandoned,
}

// Runs one match. Call every method from the game thread.
//
// Two flows share this class and the split is decided once by the win condition.
//
// Aim modes (first_to_N). The plugin manages the match. It holds warmup, validates sides, starts a
// countdown once everyone is in and on their side, sets mp_maxrounds and overtime, hands out the map
// loadout, starts the match and pauses on disconnect.
//
// Rush (valve_rush). Valve's rush_001.js runs round rules and the match end.
// The plugin never touches mp_ round convars or pauses. It does hold each config team on its
// configured side (teams[0] CT and teams[1] T by default) and holds warmup until every player
// is in and on their side. Then it runs the same start countdown as aim and ends warmup with
// mp_warmup_end. Valve's warmup did not end on its own with fewer than the mode's 6 players.
// None of this changes the game rules.
//
// Both flows enforce the whitelist and password, record and upload the demo, track rounds and stats,
// and emit round_end, match_end and match_abandoned.
//
// A series (config series, such as a Bo3) plays every map on this server. Each map ends with map_end,
// then the next map loads with the same whitelist, password and teams. match_end goes out once,
// when the series is decided or the last map ends.
public sealed class MatchController
{
    private readonly MatchConfig _cfg;
    private readonly MatchSettings _settings;
    private readonly IGameServer _game;
    private readonly IEventSink _sink;
    private readonly IClock _clock;
    private readonly IDemoUploader _uploader;
    private readonly IMatchStateStore? _store;

    private readonly PresenceTracker _presence;
    private readonly StatsAggregator _stats;
    private readonly StartCountdown _countdown;
    private readonly SeriesTracker? _series;
    private readonly Dictionary<string, int> _teamScore;
    private readonly MatchMessages _msg;

    // Per map. Rebuilt when a series moves to the next map.
    private SideMap _sides;
    private FirstToScoreTracker? _firstTo;
    private RushScoreTracker? _rush;
    private Loadout? _loadout;
    // Rush. Rooms picked in the veto for this map, null for Valve's random draw.
    private RushRoomPlan? _roomPlan;
    private bool _roomsMismatchSent;
    // Rush. Handshake with our rush_001 script. It answers every set with rushsite_rooms_applied or _rejected.
    private DateTimeOffset? _roomsSentAt;
    private int _roomsSends;
    private bool _roomsConfirmed;
    private bool _roomsFailedSent;

    private int _round;
    // True from round_end until the next round starts. Kills in that gap belong to the round that just ended.
    private bool _betweenRounds;
    private string? _currentArena;
    private bool _started;
    private bool _recording;
    private bool _pausedForDisconnect;
    private DateTimeOffset? _endDeadline;
    private DateTimeOffset? _stopDemoAt;
    private DateTimeOffset _lastLineupReminder = DateTimeOffset.MinValue;
    private bool _warmupHeld;
    private int _lastCountdownSaid;
    private bool _waitingForRoomsSaid;
    // Series. When the next map may load, and when its load was asked for.
    private DateTimeOffset? _nextMapAt;
    private DateTimeOffset? _mapLoadingSince;
    // Demo being recorded. Fixed at tv_record so a later map change cannot redirect the upload.
    private string _recordingName = "";
    private int _recordingMap = 1;

    // Fully connected players Steam has not authorized yet, by user id, with the id they claim.
    private readonly Dictionary<int, string?> _awaitingAuth = new();
    private readonly HashSet<string> _loggedOnServer = new();
    private readonly Dictionary<string, int> _joinRefusals = new();
    private readonly Dictionary<string, int> _forcedMoves = new();
    public const int MaxForcedMovesPerPlayer = 5;

    // Last known name of each match player, for chat lines about players who already left.
    private readonly Dictionary<string, string> _names = new();
    // Disconnected players with a forfeit countdown, and the seconds last announced.
    private readonly Dictionary<string, int> _away = new();
    private int _lastCenterSaid;
    // Match end. Players are kicked at this time so the final scoreboard stays up.
    private DateTimeOffset? _kickAt;
    private string _endKickReason = "Match over. Thanks for playing.";
    private bool _endKicked;

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
        _stats = new StatsAggregator(cfg.AllowedSteamIds, cfg.TeamOf);
        _teamScore = cfg.Teams.ToDictionary(t => t.Name, _ => 0);
        _msg = new MatchMessages(cfg);

        _countdown = new StartCountdown(settings.StartCountdown);
        if (ManagesMatch)
        {
            _firstTo = NewFirstTo();
        }
        else
        {
            _rush = new RushScoreTracker();
        }

        if (cfg.Series is { } s)
            _series = new SeriesTracker(s.BestOf, cfg.Teams.Select(t => t.Name), cfg.AllowedSteamIds, s.StartMapNumber, s.Wins);
        // After the series tracker. Sides can differ per map.
        _sides = NewSideMap();
    }

    private SideMap NewSideMap() => new(_cfg, fixedFromConfig: !_cfg.ParsedWinCondition.PluginManagesMatch, mapNumber: MapNumber);

    // Logs this map's sides. A ctTeam that names no team is ignored with a warning, never fails the match.
    private void LogMapSides()
    {
        if (_cfg.InvalidCtTeamFor(MapNumber) is { } bad)
            _game.Log($"warning: ignoring ctTeam '{bad}' for map {MapNumber}, it is not a team name. Using the team sides.");
        if (IsRush)
            _game.Log($"sides for {(_series is null ? "the match" : "map " + MapNumber)}: " +
                      string.Join(", ", _cfg.Teams.Select(t => $"{t.Name} {_sides.ConfiguredSide(t.Name)}")) + ".");
    }

    // Sides are per map in a series, so chat does not promise them for the whole match.
    private string SidesScope => _series is null ? "in this match" : "on this map";

    private FirstToScoreTracker NewFirstTo() =>
        new(_cfg.ParsedWinCondition.RoundsToWin, _cfg.Teams.Select(t => t.Name), _settings.OvertimeMaxRounds);

    public MatchPhase Phase { get; private set; } = MatchPhase.Warmup;
    public bool ManagesMatch => _cfg.ParsedWinCondition.PluginManagesMatch;
    public bool IsRush => !ManagesMatch;
    public int Round => _round;
    public IReadOnlyDictionary<string, int> Score => _teamScore;
    public bool IsSeries => _series is not null;
    // 1-based. Always 1 outside a series.
    public int MapNumber => _series?.MapNumber ?? 1;
    public IReadOnlyDictionary<string, int>? SeriesWins => _series?.Wins;
    private int? EventMapNumber => _series is null ? null : MapNumber;
    public MapConfig? CurrentMap => _cfg.MapAt(MapNumber);
    public string CurrentMapId => CurrentMap?.Id ?? _game.CurrentMapName ?? "unknown";
    public bool CountdownRunning => _countdown.Running;
    public MatchMessages Messages => _msg;

    public string DemoName => "rushsite_" + SafeName(_cfg.MatchId) + (_series is null ? "" : "_m" + MapNumber);
    public string DemoPath => Path.Combine(_game.CsgoDirectory, DemoName + ".dem");

    // Aim only. The loadout of the current map.
    public Loadout? CurrentLoadout => ManagesMatch ? _loadout ??= AimLoadouts.Resolve(CurrentMap, _game.CurrentMapName) : null;
    public Task? UploadTask { get; private set; }
    public bool DemoPending => _recording || UploadTask is { IsCompleted: false };

    // Called once after the config is loaded and the map is up.
    public void Start()
    {
        if (_started) return;
        _started = true;
        ApplyServerSetup();
        BeginMapWarmup();
        LoadRushRooms();
        FireRushRooms();
        LogMapSides();
        _game.Log($"match {_cfg.MatchId} mode {_cfg.Mode} win condition {_cfg.WinCondition}. " +
                  (ManagesMatch ? "Plugin manages warmup and rounds." : "Valve's Rush rules. Plugin holds teams on their configured sides.") +
                  (_series is null ? "" : $" Series Bo{_series.BestOf} starting on map {MapNumber} {CurrentMapId}."));
        _sink.Enqueue(new ServerReady());
        SaveState();
    }

    private void BeginMapWarmup()
    {
        if (ManagesMatch)
        {
            _game.ExecuteCommand("mp_warmup_start");
            _game.ExecuteCommand("mp_warmup_pausetimer 1");
            ApplyAimSetup();
        }
        else
        {
            HoldRushWarmup();
        }
    }

    // Aim only. Loadout convars and spawn immunity. Runs again after mode.cfg because it turns buying back on.
    private void ApplyAimSetup()
    {
        if (!ManagesMatch) return;
        if (_settings.AimLoadout)
            foreach (var c in CurrentLoadout!.ConVarCommands()) _game.ExecuteCommand(c);
        _game.ExecuteCommand(Loadout.SpawnImmunityCommand(_settings.AimSpawnImmunity));
    }

    private string ModeCfgExec => $"exec rushsite/matches/{_cfg.MatchId}/mode.cfg";

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
        _series?.Restore(st.MapNumber ?? MapNumber, st.SeriesWins, st.MapResults, st.SeriesPlayers, st.SeriesOver ?? false);
        // The saved map can differ from the start map, and so can its sides.
        _sides = NewSideMap();
        _firstTo?.Restore(_teamScore, _round, st.OvertimeBase, st.OvertimePeriodStart ?? 0);
        if (_rush is not null)
        {
            Side? decided = st.RushDecided switch { "T" => Side.T, "CT" => Side.CT, _ => null };
            _rush.Restore(st.RushFrontSlot ?? RushScoreTracker.StartSlot, st.RushTWins ?? 0, st.RushCtWins ?? 0,
                st.RushRoundsPlayed ?? _round, decided);
        }
        _stats.Restore(st.Players);
        LoadRushRooms();
        _roomsMismatchSent = st.RushRoomsMismatchSent ?? false;
        _roomsConfirmed = st.RushRoomsConfirmed ?? false;
        _roomsFailedSent = st.RushRoomsFailedSent ?? false;
        _recording = st.Recording;
        if (_recording) MarkRecording();
        _currentArena = st.Arena;

        switch (Phase)
        {
            case MatchPhase.Warmup:
                if (ManagesMatch) _game.ExecuteCommand("mp_warmup_pausetimer 1");
                else HoldRushWarmup();
                // Only before the match is live. Applying resets the script's game state.
                FireRushRooms();
                break;
            case MatchPhase.Live:
                _countdown.Close();
                if (MapDecided) _endDeadline = _clock.UtcNow + _settings.MatchEndWait;
                break;
            case MatchPhase.BetweenMaps:
                _countdown.Close();
                ScheduleDemoStop();
                _nextMapAt = _clock.UtcNow;
                break;
            case MatchPhase.Ended:
                _countdown.Close();
                ScheduleDemoStop();
                ScheduleEndKick();
                break;
            case MatchPhase.Abandoned:
                _countdown.Close();
                ScheduleDemoStop();
                break;
        }
        _game.Log($"restored match {_cfg.MatchId} after a plugin reload. phase {Phase} round {_round} " +
                  $"score {string.Join(" ", _teamScore.Select(kv => kv.Key + "=" + kv.Value))}.");
        if (Phase == MatchPhase.Warmup)
            _game.PrintToAll(_msg.Line($"The match plugin reloaded. The match starts once everyone is in and on their side."));
        SaveState();
    }

    private void HoldRushWarmup()
    {
        if (!_settings.HoldRushWarmup) return;
        _game.ExecuteCommand("mp_warmup_pausetimer 1");
        _warmupHeld = true;
    }

    // Rush. Reads this map's rooms from match.json. A bad list is logged and Valve's draw stands.
    private void LoadRushRooms()
    {
        _roomPlan = null;
        _roomsSentAt = null;
        _roomsSends = 0;
        _roomsConfirmed = false;
        _roomsFailedSent = false;
        if (!IsRush || !_settings.RushRooms) return;
        if (RushRoomPlan.TryParse(_cfg.RushRoomsFor(MapNumber), out var plan, out var error))
            _roomPlan = plan;
        else if (error is not null)
            _game.Log($"ignoring rushRooms for map {MapNumber}: {error}. Valve's random draw stands.");
    }

    // Rush. Hands the picked rooms to our rush_001.js. Only in warmup, because applying resets the script's game state.
    private void FireRushRooms()
    {
        if (_roomPlan is null || Phase != MatchPhase.Warmup) return;
        _game.ExecuteCommand(_roomPlan.Command());
        _roomsSentAt = _clock.UtcNow;
        _roomsSends++;
        _roomsConfirmed = false;
        _game.Log($"rush rooms sent for map {MapNumber}: {string.Join(",", _roomPlan.Path)}.");
    }

    // rushsite_rooms_applied from our script, with the 7 rooms now in play.
    public void OnRushRoomsApplied(string reported)
    {
        if (_roomPlan is null) return;
        var ids = reported.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (ids.SequenceEqual(_roomPlan.Path.Select(id => id.ToString())))
        {
            _roomsSentAt = null;
            _roomsConfirmed = true;
            _game.Log($"rush rooms confirmed by the script for map {MapNumber}.");
            SaveState();
            UpdateCountdown(_clock.UtcNow);
            return;
        }
        FailRushRooms("different", string.Join(",", ids));
    }

    // rushsite_rooms_rejected from our script, with its reason and the set it was given.
    public void OnRushRoomsRejected(string detail)
    {
        if (_roomPlan is null) return;
        FailRushRooms("rejected", detail.Trim());
    }

    // No answer within the timeout: send once more in warmup, then report the script as missing.
    private void TickRushRoomsReply(DateTimeOffset now)
    {
        if (_roomPlan is null || _roomsConfirmed || _roomsFailedSent || _roomsSentAt is null) return;
        if (now - _roomsSentAt < _settings.RushRoomsReplyTimeout) return;
        if (Phase == MatchPhase.Warmup && _roomsSends < 2)
        {
            _game.Log("no answer from the rush_001 script. Sending the rooms again.");
            FireRushRooms();
            return;
        }
        FailRushRooms("no_reply", null);
    }

    private void FailRushRooms(string reason, string? detail)
    {
        _roomsSentAt = null;
        _roomsConfirmed = false;
        if (_roomsFailedSent) return;
        _roomsFailedSent = true;
        _game.Log($"rush rooms did not take for map {MapNumber}: {reason}{(detail is null ? "" : " " + detail)}." +
                  (reason == "no_reply" ? " Is rushsite_rooms.vpk installed and named in gameinfo.gi?" : ""));
        _sink.Enqueue(new RushRoomsFailed(reason, _roomPlan!.Path) { Detail = detail, MapNumber = EventMapNumber });
        SaveState();
        UpdateCountdown(_clock.UtcNow);
    }

    // Console command. Sends the rooms again, for testing on a server.
    public string ResendRushRooms()
    {
        if (!IsRush) return "not a Rush match";
        if (_roomPlan is null) return "no rushRooms for this map";
        if (Phase != MatchPhase.Warmup) return "rooms can only be sent in warmup";
        FireRushRooms();
        return $"rooms sent: {string.Join(",", _roomPlan.Path)}";
    }

    public void OnMapStart()
    {
        if (!_started) return;
        ApplyServerSetup();
        if (_mapLoadingSince is null)
        {
            if (ManagesMatch && Phase == MatchPhase.Warmup) ApplyAimSetup();
            // The map reloaded in warmup and the script forgot the rooms.
            if (IsRush && Phase == MatchPhase.Warmup) FireRushRooms();
            return;
        }
        // The next map of the series is up. Players reconnect and are counted again as they arrive.
        _mapLoadingSince = null;
        _presence.ResetForMapChange(_clock.UtcNow);
        Phase = MatchPhase.Warmup;
        _game.ExecuteCommand(ModeCfgExec);
        BeginMapWarmup();
        LoadRushRooms();
        FireRushRooms();
        _game.Log($"map {MapNumber} of the series is up ({CurrentMapId}). Waiting for players.");
        SaveState();
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
        RememberName(steamId);
        if (_endKicked && Phase == MatchPhase.Ended)
        {
            _game.KickPlayer(steamId, _endKickReason);
            return;
        }
        // Players are counted again on the new map once it is up.
        if (_mapLoadingSince is not null) return;
        if (!_presence.Connect(steamId)) return;
        _sink.Enqueue(new PlayerConnected(steamId));
        var wasAway = _away.Remove(steamId);

        var unpausing = false;
        if (_presence.AllConnected)
        {
            // Rush records from the moment everyone is in so nothing Valve's script does is missed.
            if (IsRush && Phase == MatchPhase.Warmup) StartRecording();
            if (_pausedForDisconnect && Phase == MatchPhase.Live)
            {
                _pausedForDisconnect = false;
                _game.ExecuteCommand("mp_unpause_match");
                unpausing = true;
            }
        }
        if (wasAway) _game.PrintToAll(_msg.Returned(NameOf(steamId), unpausing));
        else if (unpausing) _game.PrintToAll(_msg.Line("All players are back. Unpausing."));

        if (ManagesMatch && Phase == MatchPhase.Warmup)
        {
            var required = _sides.RequiredSide(steamId);
            if (required is not null && _settings.TryChangeTeam) _game.TryMovePlayer(steamId, required.Value);
            _game.PrintToPlayer(steamId, _msg.Line($"Join your team's side. The match starts once everyone is in and on their side."));
            UpdateCountdown(_clock.UtcNow);
        }
        if (IsRush && Phase == MatchPhase.Warmup)
        {
            _game.PrintToPlayer(steamId, _msg.Line($"Your team plays {SideName(RequiredRushSide(steamId))}."));
            UpdateCountdown(_clock.UtcNow);
        }
    }

    // name is the name from the disconnect event when the adapter has it.
    public void OnPlayerDisconnected(string steamId, int? userId = null, string? name = null)
    {
        if (userId is int uid) _awaitingAuth.Remove(uid);
        foreach (var k in _awaitingAuth.Where(kv => kv.Value == steamId).Select(kv => kv.Key).ToList()) _awaitingAuth.Remove(k);
        if (_cfg.IsAllowed(steamId)) RememberName(steamId, name);
        _sides.RemovePlayer(steamId);
        if (!_presence.Disconnect(steamId, _clock.UtcNow)) return;
        var inPlay = Phase is MatchPhase.Warmup or MatchPhase.Live or MatchPhase.BetweenMaps;
        if (inPlay) _sink.Enqueue(new PlayerDisconnected(steamId));

        var pausing = ManagesMatch && Phase == MatchPhase.Live && _settings.PauseOnDisconnect && !_pausedForDisconnect;
        if (pausing)
        {
            _pausedForDisconnect = true;
            _game.ExecuteCommand("mp_pause_match");
        }
        // The same grace CheckAbandon uses. Announced so the others know how long they wait.
        if (inPlay && _mapLoadingSince is null)
        {
            var grace = _settings.DisconnectGrace;
            _away[steamId] = (int)Math.Ceiling(grace.TotalSeconds);
            var who = NameOf(steamId);
            _game.PrintToAll(_msg.Disconnected(who, grace, pausing));
            _game.PrintCenterToAll(MatchMessages.DisconnectedCenter(who, grace));
        }
        UpdateCountdown(_clock.UtcNow, steamId, left: true);
    }

    private void RememberName(string steamId, string? name = null)
    {
        var clean = MatchMessages.CleanText(name ?? _game.PlayerName(steamId), 32);
        if (clean.Length > 0) _names[steamId] = clean;
    }

    public string NameOf(string steamId) => _names.TryGetValue(steamId, out var n) ? n : steamId;

    // Announces the forfeit countdown of each disconnected player at set marks.
    private void AnnounceAway(DateTimeOffset now)
    {
        foreach (var (id, last) in _away.ToList())
        {
            if (_presence.IsConnected(id) || _presence.MissingSince(id) is not DateTimeOffset since)
            {
                _away.Remove(id);
                continue;
            }
            var left = _settings.DisconnectGrace - (now - since);
            var secs = (int)Math.Ceiling(left.TotalSeconds);
            if (!CountdownMarks.Due(secs, last, CountdownMarks.IsGraceMark)) continue;
            _away[id] = secs;
            _game.PrintToAll(_msg.StillAway(NameOf(id), left));
        }
    }

    // Live countdown on every screen while a match player is missing, on the same clocks CheckAbandon uses.
    // Players on the server who are waiting for Steam are not missing, so they are left out.
    private void ShowMissingCountdown(DateTimeOffset now)
    {
        if (!_settings.MissingCountdown || _mapLoadingSince is not null) return;
        var onServer = OnServerNotCounted();
        var missing = new List<MatchMessages.Missing>();
        foreach (var id in _presence.Missing)
        {
            if (onServer.Contains(id) || _presence.MissingSince(id) is not DateTimeOffset since) continue;
            var joined = _presence.HasEverConnected(id);
            var left = (joined ? _settings.DisconnectGrace : _settings.ConnectGrace) - (now - since);
            // A player who was never on the server has no name yet, so the team stands in for it.
            var name = _names.TryGetValue(id, out var n) ? n : $"a player from {_msg.TeamLabel(_cfg.TeamOf(id) ?? "")}";
            if (left > TimeSpan.Zero) missing.Add(new MatchMessages.Missing(name, left, joined));
        }
        if (missing.Count > 0) _game.PrintCenterToAll(MatchMessages.MissingCenter(missing));
    }

    public void OnPlayerTeam(string steamId, Side side)
    {
        if (!_cfg.IsAllowed(steamId)) return;
        _sides.SetPlayerSide(steamId, side);
        UpdateCountdown(_clock.UtcNow, steamId);
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
        if (Phase != MatchPhase.Warmup && Phase != MatchPhase.Live) return true;
        if (Phase == MatchPhase.Live)
        {
            // Mid match a player may only return to the side the team is playing.
            var teamSide = _sides.SideOfTeam(_cfg.TeamOf(steamId)!);
            return !requested.IsPlaying() || !teamSide.IsPlaying() || requested == teamSide;
        }
        if (_sides.IsJoinAllowed(steamId, requested)) return true;
        _game.PrintToPlayer(steamId, _msg.Line($"That side belongs to the other team. Join {_sides.RequiredSide(steamId)}."));
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
                _game.PrintToPlayer(steamId, _msg.Line($"{SideName(required)} is full."));
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
                    $"Your team plays {SideName(required)} {SidesScope}. Reconnect and join {SideName(required)}.");
                return false;
            }
            _game.PrintToPlayer(steamId,
                _msg.Line($"Your team plays {SideName(required)} {SidesScope}. Moving you there."));
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

    // Ready-up is gone. The command only explains what happens now.
    public string ReadyHint() =>
        _msg.Line($"No ready-up needed. The match starts on its own once everyone is in and on their side.");

    private bool LineupComplete => IsRush
        ? RushNotReady().Count == 0
        : _presence.AllConnected && _sides.TeamsAreValid(_cfg.AllowedSteamIds);

    // Rush. The script must have answered the room set before warmup ends.
    // Applying rooms resets the script's game state and it refuses rooms after the first round.
    // A failed set is already reported, so the match goes ahead on Valve's draw.
    private bool RushRoomsSettled => _roomPlan is null || _roomsConfirmed || _roomsFailedSent;

    // Runs the start countdown from the current lineup.
    // changedBy is the player whose leave or side change caused this update, when known.
    private void UpdateCountdown(DateTimeOffset now, string? changedBy = null, bool left = false)
    {
        if (Phase != MatchPhase.Warmup || _mapLoadingSince is not null) return;
        var mayFire = !IsRush || RushRoomsSettled;
        switch (_countdown.Update(LineupComplete, now, mayFire))
        {
            case CountdownChange.Started:
                _waitingForRoomsSaid = false;
                _lastCountdownSaid = _countdown.SecondsLeft(now);
                _lastCenterSaid = _lastCountdownSaid;
                _game.Log("all players are in and on their side. Start countdown running.");
                _game.PrintToAll(_msg.CountdownStarted(WhatStarts, _lastCountdownSaid));
                _game.PrintCenterToAll(MatchMessages.CountdownCenter(WhatStarts, _lastCountdownSaid));
                break;
            case CountdownChange.Cancelled:
                AnnounceCountdownCancelled(changedBy, left);
                break;
            case CountdownChange.Fired:
                if (IsRush) EndRushWarmup();
                else StartAimMatch("all players in and on their side");
                break;
            default:
                var secs = _countdown.SecondsLeft(now);
                if (_countdown.Running && secs <= 0 && !mayFire && !_waitingForRoomsSaid)
                {
                    _waitingForRoomsSaid = true;
                    _game.Log("start countdown done. Waiting for the rush_001 script to answer the room set.");
                    _game.PrintToAll(_msg.Line($"Loading the rooms from the veto."));
                }
                if (!_countdown.Running || secs <= 0) break;
                if (CountdownMarks.Due(secs, _lastCountdownSaid, CountdownMarks.IsStartMark))
                {
                    _lastCountdownSaid = secs;
                    _game.PrintToAll(_msg.CountdownTick(WhatStarts, secs));
                }
                if (secs < _lastCenterSaid)
                {
                    _lastCenterSaid = secs;
                    _game.PrintCenterToAll(MatchMessages.CountdownCenter(WhatStarts, secs));
                }
                break;
        }
    }

    // Names who left or switched side. Falls back to the current lineup when the cause is not known.
    private void AnnounceCountdownCancelled(string? changedBy, bool left)
    {
        var gone = new List<string>();
        var switched = new List<string>();
        if (changedBy is not null)
        {
            (left ? gone : switched).Add(NameOf(changedBy));
        }
        else
        {
            foreach (var id in _cfg.AllowedSteamIds)
            {
                if (!_presence.IsConnected(id)) gone.Add(NameOf(id));
                else if (!_sides.IsOnRequiredSide(id)) switched.Add(NameOf(id));
            }
        }
        _game.Log($"start countdown cancelled. left [{string.Join(",", gone)}] switched [{string.Join(",", switched)}].");
        _game.PrintToAll(_msg.CountdownCancelled(gone, switched));
    }

    private string WhatStarts => _series is null ? "The match" : $"Map {MapNumber}";

    // Admin override from the server console. Aim modes only.
    public bool ForceStart()
    {
        if (!ManagesMatch || Phase != MatchPhase.Warmup || _mapLoadingSince is not null) return false;
        StartAimMatch("forced from console");
        return true;
    }

    // Rush. The lineup is complete and the rooms are settled. Valve's own warmup can wait
    // for the mode's full 6 players, so end it here. The match goes live on Valve's start signal.
    private void EndRushWarmup()
    {
        _game.Log($"ending Rush warmup for {(_series is null ? "the match" : "map " + MapNumber)}. All players in and on their side. Rooms {(_roomPlan is null ? "random" : RoomsState.Trim())}.");
        _warmupHeld = false;
        _game.ExecuteCommand("mp_warmup_pausetimer 0");
        StartRecording();
        _game.ExecuteCommand("mp_warmup_end");
        SaveState();
    }

    private void StartAimMatch(string why)
    {
        var wc = _cfg.ParsedWinCondition;
        _countdown.Close();
        _game.Log($"starting {(_series is null ? "match" : "map " + MapNumber)}. {why}.");
        // Runs first. The cfg sets pausetimer 1 and its startmoney only applies on the warmup end restart.
        _game.ExecuteCommand(ModeCfgExec);
        ApplyAimSetup();
        _game.ExecuteCommand($"mp_maxrounds {wc.MaxRounds}");
        _game.ExecuteCommand("mp_match_can_clinch 1");
        if (_settings.OvertimeMaxRounds > 0)
        {
            _game.ExecuteCommand("mp_overtime_enable 1");
            _game.ExecuteCommand($"mp_overtime_maxrounds {_settings.OvertimeMaxRounds}");
            _game.ExecuteCommand($"mp_overtime_startmoney {_settings.OvertimeStartMoney}");
        }
        else
        {
            _game.ExecuteCommand("mp_overtime_enable 0");
        }
        _game.ExecuteCommand($"mp_halftime {(_settings.AimHalftime ? 1 : 0)}");
        _game.ExecuteCommand("mp_warmup_pausetimer 0");
        StartRecording();
        _game.ExecuteCommand("mp_warmup_end");
        GoLive();
        _game.PrintToAll(_msg.Line($"{(_series is null ? "Match" : $"Map {MapNumber}")} is live. First to {wc.RoundsToWin}."));
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
        _countdown.Close();
        StartRecording();
        GoLive();
    }

    private void GoLive()
    {
        Phase = MatchPhase.Live;
        _stats.Reset();
        _round = 0;
        _betweenRounds = false;
        _sink.Enqueue(new MatchStarted
        {
            MapNumber = EventMapNumber,
            RushRooms = _roomPlan?.Path,
            RushRoomsConfirmed = _roomPlan is null ? null : _roomsConfirmed,
        });
        SaveState();
    }

    private void StartRecording()
    {
        if (_recording) return;
        if (_game.GetConVar("tv_enable") != "1")
            _game.Log("tv_enable is not 1. tv_record will fail. Start the server with +tv_enable 1.");
        _game.ExecuteCommand($"tv_record \"{DemoName}\"");
        _recording = true;
        MarkRecording();
    }

    private void MarkRecording()
    {
        _recordingName = DemoName;
        _recordingMap = MapNumber;
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
            if (Phase == MatchPhase.Live)
            {
                var detected = _game.DetectRushArena();
                _currentArena = detected ?? _currentArena;
                CheckRushRoom(detected);
            }
        }
    }

    // Rush. Compares the room of the round about to be played with the veto. Reports the first difference per map.
    private void CheckRushRoom(string? detected)
    {
        if (_roomPlan is null || _roomsMismatchSent || detected is null || _rush is null) return;
        var expected = _roomPlan.ExpectedArena(_rush.FrontSlot, _rush.NextIsDecider);
        if (expected is null || expected == detected) return;
        _roomsMismatchSent = true;
        var round = _round + 1;
        _game.Log($"round {round} is in room {detected} but the veto put {expected} in slot {_rush.FrontSlot}. " +
                  "The modified rush_001 script did not take.");
        _sink.Enqueue(new RushRoomsMismatch(round, expected, detected, _roomPlan.Path) { MapNumber = EventMapNumber });
        SaveState();
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
            MapNumber = EventMapNumber,
        });

        if ((decided is not null || MapDecided) && _endDeadline is null)
        {
            // Give cs_win_panel_match a chance to arrive first. It is the preferred end signal.
            _endDeadline = _clock.UtcNow + _settings.MatchEndWait;
        }
        SaveState();
    }

    // Aim follows the first-to tracker, overtime included. Rush stops at its round cap.
    private bool MapDecided => _firstTo is not null
        ? _firstTo.IsOver
        : _rush!.DecidedWinner is not null || _round >= _cfg.ParsedWinCondition.MaxRounds;

    public void OnWinPanelMatch()
    {
        if (Phase != MatchPhase.Live) return;
        FinishMap("cs_win_panel_match");
    }

    // Aim only. Called a moment after a match player spawns.
    public void OnPlayerSpawn(string steamId, Side side)
    {
        if (!ManagesMatch || !_settings.AimLoadout) return;
        if (Phase is not (MatchPhase.Warmup or MatchPhase.Live) || _mapLoadingSince is not null) return;
        if (!_cfg.IsAllowed(steamId) || !side.IsPlaying()) return;
        _game.ApplyLoadout(steamId, CurrentLoadout!.For(side));
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
            MapNumber = EventMapNumber,
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
        if (_stopDemoAt is not null && now >= _stopDemoAt) StopDemoAndUpload();
        if (_kickAt is not null && now >= _kickAt) KickAtMatchEnd();
        EnforceNoBots();
        switch (Phase)
        {
            case MatchPhase.Warmup:
            case MatchPhase.Live:
            case MatchPhase.BetweenMaps:
                if (_mapLoadingSince is not null)
                {
                    if (now - _mapLoadingSince >= _settings.MapLoadTimeout)
                        Abandon("map_load_failed", Array.Empty<string>(), "The next map did not load.");
                    break;
                }
                SyncConnectedPlayers();
                if (CheckAbandon(now)) return;
                AnnounceAway(now);
                ShowMissingCountdown(now);
                if (Phase == MatchPhase.Warmup && IsRush) TickRushWarmup(now);
                if (IsRush && Phase is MatchPhase.Warmup or MatchPhase.Live) TickRushRoomsReply(now);
                if (Phase == MatchPhase.Warmup && ManagesMatch) TickAimWarmup(now);
                if (Phase == MatchPhase.Live && _endDeadline is not null && now >= _endDeadline)
                    FinishMap("score tracking");
                if (Phase == MatchPhase.BetweenMaps && _nextMapAt is not null && now >= _nextMapAt && _stopDemoAt is null)
                    LoadNextMap(now);
                break;
        }
    }

    private void TickAimWarmup(DateTimeOffset now)
    {
        RefreshAllSides();
        UpdateCountdown(now);
        if (Phase != MatchPhase.Warmup || _countdown.Running) return;
        if (now - _lastLineupReminder < TimeSpan.FromSeconds(15)) return;
        _lastLineupReminder = now;
        foreach (var id in _cfg.AllowedSteamIds.Where(id => _presence.IsConnected(id) && !_sides.IsOnRequiredSide(id)))
        {
            var side = _sides.RequiredSide(id);
            _game.PrintToPlayer(id, _msg.Line($"Join {(side is Side s ? SideName(s) : "your team's side")} to start the match."));
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
        // Warmup was ended. Valve's start signal moves the match to live.
        if (_countdown.Fired) return;
        // Held until the countdown ends warmup. A cfg run in between can clear the hold.
        if (_settings.HoldRushWarmup && (!_warmupHeld || _game.GetConVar("mp_warmup_pausetimer") == "0"))
            HoldRushWarmup();
        UpdateCountdown(now);
        var wrong = WrongSidePlayers();
        if (wrong.Count > 0 && now - _lastLineupReminder >= TimeSpan.FromSeconds(15))
        {
            _lastLineupReminder = now;
            foreach (var id in wrong)
            {
                _game.PrintToPlayer(id, _msg.Line($"You are not ready. Your team plays {SideName(RequiredRushSide(id))}."));
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
        Abandon(reason, missing, "A player did not connect or return in time.");
        return true;
    }

    // Ends the match, and in a series every map still to play.
    private void Abandon(string reason, IReadOnlyList<string> missing, string why)
    {
        _game.Log($"abandoning match. {reason}: {string.Join(",", missing)}");
        _game.PrintToAll(_msg.Line($"Match abandoned. {why}"));
        Phase = MatchPhase.Abandoned;
        _away.Clear();
        _mapLoadingSince = null;
        _nextMapAt = null;
        if (ManagesMatch) _game.ExecuteCommand("mp_pause_match");
        _sink.Enqueue(new MatchAbandoned(reason, missing));
        SaveState();

        // Keep the partial demo for review. demo_uploaded reports it.
        ScheduleDemoStop();
    }

    // A draw is only possible when overtime is off in aim, or in Rush when a round ends as a draw.
    private void FinishMap(string source)
    {
        RefreshSides();
        var winner = _firstTo?.DecidedWinner
                     ?? (_rush?.DecidedWinner is Side s ? _sides.TeamOnSide(s) : null)
                     ?? LeadingTeam()
                     ?? MatchEventJson.Draw;
        var score = new Dictionary<string, int>(_teamScore);
        var players = _stats.Snapshot();
        _game.Log($"{(_series is null ? "match" : "map " + MapNumber)} over via {source}. Winner {winner}. " +
                  $"Score {string.Join(" ", _teamScore.Select(kv => kv.Key + "=" + kv.Value))}.");
        _endDeadline = null;

        if (_series is null)
        {
            // Results go out now. The demo follows in its own demo_uploaded event.
            EndMatch(new MatchEnd(winner, score, players, false));
            return;
        }

        var over = _series.RecordMap(CurrentMapId, winner, score, players);
        _sink.Enqueue(new MapEnd(MapNumber, CurrentMapId, winner, score, players, false));
        if (over)
        {
            EndMatch(new MatchEnd(_series.FinalWinner, new Dictionary<string, int>(_series.Wins), _series.Totals(), false)
            {
                Maps = _series.Results.Select(r => new MapSummary(r.MapNumber, r.MapId, r.WinnerTeam, r.Score)).ToList(),
            });
            return;
        }

        Phase = MatchPhase.BetweenMaps;
        ScheduleDemoStop();
        var next = _cfg.MapAt(MapNumber + 1);
        _nextMapAt = Max(_clock.UtcNow + _settings.SeriesMapBreak, _stopDemoAt ?? _clock.UtcNow);
        var wait = (int)Math.Ceiling((_nextMapAt.Value - _clock.UtcNow).TotalSeconds);
        _game.PrintToAll(_msg.MapOver(MapNumber, MapLabel(CurrentMap, CurrentMapId), winner, score, _series.Wins,
            next is null ? null : MapLabel(next, next.Id), wait));
        SaveState();
    }

    private void EndMatch(MatchEnd end)
    {
        _game.Log($"match over. Winner {end.WinnerTeam}.");
        Phase = MatchPhase.Ended;
        _away.Clear();
        _sink.Enqueue(end);
        ScheduleDemoStop();
        SaveState();
        AnnounceMatchEnd(end);
        ScheduleEndKick();
    }

    // Final score, the map scores of a series and the match link.
    private void AnnounceMatchEnd(MatchEnd end)
    {
        if (_series is null)
        {
            _game.PrintToAll(_msg.MatchOver(end.WinnerTeam, end.Score));
        }
        else
        {
            _game.PrintToAll(_msg.SeriesOver(end.WinnerTeam, end.Score));
            foreach (var r in _series.Results)
                _game.PrintToAll(_msg.SeriesMapLine(r, MapLabel(_cfg.MapAt(r.MapNumber), r.MapId)));
        }
        if (_msg.LinkLine() is { } link) _game.PrintToAll(link);
        if (_settings.KickOnMatchEnd && _settings.MatchEndKickDelay > TimeSpan.Zero)
            _game.PrintToAll(_msg.ClosingIn((int)Math.Ceiling(_settings.MatchEndKickDelay.TotalSeconds)));
    }

    private IReadOnlyDictionary<string, int> FinalScore() =>
        _series is null ? _teamScore : _series.Wins;

    // Players stay for MatchEndKickDelay so the final scoreboard is visible, then are kicked.
    private void ScheduleEndKick()
    {
        if (!_settings.KickOnMatchEnd) return;
        _endKickReason = _msg.KickReason(FinalScore(), _series is not null);
        _kickAt = _clock.UtcNow + _settings.MatchEndKickDelay;
        if (_settings.MatchEndKickDelay <= TimeSpan.Zero) KickAtMatchEnd();
    }

    private void KickAtMatchEnd()
    {
        _kickAt = null;
        _endKicked = true;
        KickEveryone(_endKickReason);
    }

    private static string MapLabel(MapConfig? map, string fallback) =>
        !string.IsNullOrWhiteSpace(map?.DisplayName) ? map.DisplayName! : fallback;

    private string SeriesScoreText() =>
        _series is null ? "" : string.Join("-", _cfg.Teams.Select(t => _series.Wins[t.Name]));

    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;

    // Series. Loads the next map with the same whitelist, password and teams.
    private void LoadNextMap(DateTimeOffset now)
    {
        _nextMapAt = null;
        if (_series is null || !_series.Advance())
        {
            Abandon("map_load_failed", Array.Empty<string>(), "There is no next map.");
            return;
        }
        var cmd = CurrentMap?.LoadCommand();
        ResetForNextMap();
        // Everyone reloads with the map. The API sees them leave and connect again.
        foreach (var id in _presence.ResetForMapChange(now)) _sink.Enqueue(new PlayerDisconnected(id));
        if (cmd is null)
        {
            Abandon("map_load_failed", Array.Empty<string>(), "The next map has no map name.");
            return;
        }
        _mapLoadingSince = now;
        _game.Log($"loading map {MapNumber} of {_series.BestOf} ({CurrentMapId}) with {cmd}.");
        LogMapSides();
        SaveState();
        _game.ExecuteCommand(cmd);
    }

    private void ResetForNextMap()
    {
        _round = 0;
        _betweenRounds = false;
        _currentArena = null;
        _roomPlan = null;
        _roomsMismatchSent = false;
        _endDeadline = null;
        _pausedForDisconnect = false;
        _warmupHeld = false;
        _lastCountdownSaid = 0;
        _lastCenterSaid = 0;
        _waitingForRoomsSaid = false;
        _away.Clear();
        _lastLineupReminder = DateTimeOffset.MinValue;
        foreach (var t in _teamScore.Keys.ToList()) _teamScore[t] = 0;
        _sides = NewSideMap();
        _stats.Reset();
        _loadout = null;
        _countdown.Reset();
        if (ManagesMatch)
        {
            _firstTo = NewFirstTo();
        }
        else
        {
            _rush = new RushScoreTracker();
        }
        _awaitingAuth.Clear();
        _loggedOnServer.Clear();
        _joinRefusals.Clear();
        _forcedMoves.Clear();
    }

    // Nobody needs to stay for the demo wait. Kicking keeps the server idle until it is torn down.
    private void KickEveryone(string reason)
    {
        foreach (var p in _game.ConnectedPlayers())
            _game.KickPlayer(p.SteamId, reason);
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
        var path = Path.Combine(_game.CsgoDirectory, _recordingName + ".dem");
        UploadTask = UploadAndReportAsync(path, _cfg.DemoUploadFor(_recordingMap)?.PresignedPutUrl, _recordingMap);
    }

    private async Task UploadAndReportAsync(string path, string? url, int mapNumber)
    {
        DemoUploadResult result;
        if (string.IsNullOrEmpty(url))
        {
            result = DemoUploadResult.Failed(_series is null ? "no presignedPutUrl in match.json" : $"no presignedPutUrl for map {mapNumber} in match.json");
        }
        else
        {
            try
            {
                result = await _uploader.UploadAsync(path, url, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception e)
            {
                result = DemoUploadResult.Failed(e.Message);
            }
        }
        if (!result.Ok) _game.Log($"demo upload failed: {result.Error}");
        _sink.Enqueue(new DemoUploaded(result.Ok) { Bytes = result.Bytes, Error = result.Error, MapNumber = _series is null ? null : mapNumber });
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
        RushRoomsMismatchSent = _roomsMismatchSent ? true : null,
        RushRoomsConfirmed = _roomsConfirmed ? true : null,
        RushRoomsFailedSent = _roomsFailedSent ? true : null,
        RushFrontSlot = _rush?.FrontSlot,
        RushTWins = _rush?.Wins[Side.T],
        RushCtWins = _rush?.Wins[Side.CT],
        RushRoundsPlayed = _rush?.RoundsPlayed,
        RushDecided = _rush?.DecidedWinner?.ToString(),
        Players = _stats.Snapshot().ToList(),
        OvertimeBase = _firstTo?.OvertimeBase,
        OvertimePeriodStart = _firstTo?.InOvertime == true ? _firstTo.OvertimePeriodStart : null,
        MapNumber = _series?.MapNumber,
        SeriesWins = _series is null ? null : new Dictionary<string, int>(_series.Wins),
        MapResults = _series?.Results.ToList(),
        SeriesPlayers = _series?.Totals().ToList(),
        SeriesOver = _series?.IsOver,
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

    private string RoomsState => _roomsConfirmed ? " confirmed" : _roomsFailedSent ? " FAILED" : " unconfirmed";

    public string Status()
    {
        var countdown = _countdown.Running ? $"{_countdown.SecondsLeft(_clock.UtcNow)}s" : _countdown.Fired ? "done" : "waiting";
        var series = _series is null ? "" : $"map {MapNumber}/{_series.BestOf} {CurrentMapId} series {SeriesScoreText()} ";
        return $"match {_cfg.MatchId} mode {_cfg.Mode} phase {Phase} {series}round {_round} " +
               $"score {string.Join(" ", _teamScore.Select(kv => kv.Key + "=" + kv.Value))} " +
               $"connected {_cfg.AllowedSteamIds.Count - _presence.Missing.Count}/{_cfg.AllowedSteamIds.Count} countdown {countdown} " +
               $"recording {_recording}" + (IsRush ? $" arena {_currentArena ?? "?"} front {_rush!.FrontSlot} " +
               $"rooms {(_roomPlan is null ? "random" : string.Join(",", _roomPlan.Path) + RoomsState)}{(_roomsMismatchSent ? " MISMATCH" : "")} " +
               $"lineup {_cfg.AllowedSteamIds.Count - RushNotReady().Count}/{_cfg.AllowedSteamIds.Count} " +
               $"wrong side [{string.Join(",", WrongSidePlayers())}] warmup held {_warmupHeld}" : "");
    }
}
