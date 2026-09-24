using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Entities;
using CounterStrikeSharp.API.Modules.Entities.Constants;
using CounterStrikeSharp.API.Modules.Events;
using CounterStrikeSharp.API.Modules.Timers;
using Microsoft.Extensions.Logging;
using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Demo;
using RushsiteMatch.Core.Match;
using RushsiteMatch.Core.Runtime;
using RushsiteMatch.Core.State;
using RushsiteMatch.Core.Webhooks;

namespace RushsiteMatch;

// Thin adapter. Game events and commands go straight to MatchController, which holds the logic.
public sealed class RushsiteMatchPlugin : BasePlugin
{
    public override string ModuleName => "RushsiteMatch";
    public override string ModuleVersion => "0.1.0";
    public override string ModuleAuthor => "rushsite";
    public override string ModuleDescription => "Match control and reporting for rushsite servers";

    public FakeConVar<string> MatchConfigPath = new(MatchConfigLoader.ConVarName, "Path to match.json. Relative paths resolve against game/csgo.", "");
    public FakeConVar<int> ConnectGrace = new("rushsite_connect_grace", "Seconds a player may take to first connect before the match is abandoned.", 300);
    public FakeConVar<int> DisconnectGrace = new("rushsite_disconnect_grace", "Seconds a player may stay disconnected before the match is abandoned.", 180);
    public FakeConVar<bool> MissingCountdown = new("rushsite_missing_countdown", "Show a center screen countdown every second while a match player is missing.", true);
    public FakeConVar<int> StartCountdown = new("rushsite_start_countdown", "Seconds of countdown once every player is in and on their side. Then warmup ends.", 10);
    public FakeConVar<float> AimSpawnImmunity = new("rushsite_aim_spawn_immunity", "Aim modes. Seconds of spawn immunity, sets mp_respawn_immunitytime.", 2f);
    public FakeConVar<bool> AimLoadout = new("rushsite_aim_loadout", "Aim modes. Give the map loadout into empty weapon slots on spawn.", true);
    public FakeConVar<int> OvertimeMaxRounds = new("rushsite_overtime_maxrounds", "Aim modes. Rounds per overtime period for a tied map. 0 turns overtime off.", 6);
    public FakeConVar<int> OvertimeStartMoney = new("rushsite_overtime_startmoney", "Aim modes. mp_overtime_startmoney.", 16000);
    public FakeConVar<int> SeriesMapBreak = new("rushsite_series_map_break", "Series. Minimum seconds between one map ending and the next loading.", 10);
    public FakeConVar<int> TvDelay = new("rushsite_tv_delay", "tv_delay set when the demo starts. The next map waits for it, so keep it short. -1 keeps the mode cfg's value.", 0);
    public FakeConVar<bool> AimHalftime = new("rushsite_aim_halftime", "Aim modes. Swap sides at halftime.", false);
    public FakeConVar<bool> PauseOnDisconnect = new("rushsite_pause_on_disconnect", "Aim modes. Pause at the next freeze time when a player disconnects.", true);
    public FakeConVar<int> MatchEndWait = new("rushsite_match_end_wait", "Seconds to wait for cs_win_panel_match after the score decides the match.", 10);
    public FakeConVar<int> MatchEndKickDelay = new("rushsite_match_end_kick_delay", "Seconds the final score stays up before players are kicked.", 10);
    public FakeConVar<int> DemoStopExtra = new("rushsite_demo_stop_extra", "Seconds added to tv_delay before tv_stoprecord.", 5);
    public FakeConVar<bool> KickBots = new("rushsite_kick_bots", "Hold bot_quota at 0 and kick bots.", true);
    public FakeConVar<bool> TryChangeTeam = new("rushsite_try_changeteam", "Also try ChangeTeam to put players on their side. Broken on CS2 1.41.8.2.", false);
    public FakeConVar<int> TeamJoinRefusals = new("rushsite_team_refusals", "Rush. Wrong side joins before the player is kicked.", 3);
    public FakeConVar<bool> HoldRushWarmup = new("rushsite_rush_hold_warmup", "Rush. Hold Valve's warmup timer until the start countdown ends warmup.", true);
    public FakeConVar<bool> RushRooms = new("rushsite_rush_rooms", "Rush. Send the veto's rushRooms to the modified rush_001 script.", true);
    public FakeConVar<int> WebhookMaxAttempts = new("rushsite_webhook_max_attempts", "Delivery attempts per webhook event before it is dropped.", 10);
    public FakeConVar<int> SlowHandlerMs = new("rushsite_slow_handler_ms", "Warn once per map when a plugin handler runs longer than this on the game thread. 0 turns it off.", 20);

    private MatchController? _match;
    private WebhookDispatcher? _webhooks;
    private HttpClientTransport? _transport;
    private CssGameServer? _game;
    private HandlerTiming _timing = null!;
    private BackgroundMatchStateStore? _store;
    private bool _warmedUp;
    private string? _loadError;
    private bool _hotReload;

    public override void Load(bool hotReload)
    {
        _hotReload = hotReload;
        _timing = new HandlerTiming(TimeSpan.FromMilliseconds(Math.Max(0, SlowHandlerMs.Value)), msg => Logger.LogWarning("{Message}", msg));
        _game = new CssGameServer(Logger, () => TryChangeTeam.Value, _timing);
        WarnIfHotReloadEnabled();
        PrepareCode();

        RegisterListener<Listeners.OnMapStart>(_ =>
        {
            _timing.Threshold = TimeSpan.FromMilliseconds(Math.Max(0, SlowHandlerMs.Value));
            _timing.NewMap();
            AddTimer(1.0f, () => _timing.Run("map_start", EnsureMatch), TimerFlags.STOP_ON_MAPCHANGE);
        });
        RegisterListener<Listeners.OnClientAuthorized>((slot, id) => _timing.Run("client_authorized", () => OnClientAuthorized(slot, id)));

        On<EventPlayerConnectFull>("player_connect_full", OnPlayerConnectFull);
        On<EventPlayerDisconnect>("player_disconnect", OnPlayerDisconnect);
        On<EventPlayerTeam>("player_team", OnPlayerTeam);
        On<EventPlayerSpawn>("player_spawn", OnPlayerSpawn);
        On<EventRoundStart>("round_start", OnRoundStart);
        On<EventRoundFreezeEnd>("round_freeze_end", OnRoundFreezeEnd);
        On<EventRoundEnd>("round_end", OnRoundEnd);
        On<EventPlayerDeath>("player_death", OnPlayerDeath);
        On<EventPlayerHurt>("player_hurt", OnPlayerHurt);
        On<EventCsWinPanelMatch>("cs_win_panel_match", OnWinPanelMatch);
        On<EventRoundAnnounceMatchStart>("round_announce_match_start", OnMatchStartSignal);
        On<EventBeginNewMatch>("begin_new_match", OnBeginNewMatch);

        AddCommandListener("jointeam", (p, info) => _timing.Run("jointeam", () => OnJoinTeam(p, info)), HookMode.Pre);
        // Ready-up is automatic. The command only tells players so.
        AddCommand("css_ready", "Explains that the match starts on its own", (p, info) => Reply(p, info, _ => _match!.ReadyHint()));
        AddCommand("rushsite_status", "Print match status", OnStatusCommand);
        AddCommand("rushsite_force_start", "Start an aim match now", OnForceStartCommand);
        // Our rush_001 script answers each room set with one of these. Server console only.
        AddCommand("rushsite_rooms_applied", "Sent by the rush_001 script after it applied the rooms", (p, info) =>
        {
            if (p is null) _timing.Run("rushsite_rooms_applied", () => _match?.OnRushRoomsApplied(info.ArgString.Trim().Trim('"')));
        });
        AddCommand("rushsite_rooms_rejected", "Sent by the rush_001 script when it refused the rooms", (p, info) =>
        {
            if (p is null) _timing.Run("rushsite_rooms_rejected", () => _match?.OnRushRoomsRejected(info.ArgString.Trim().Trim('"')));
        });
        AddCommand("rushsite_rush_rooms_send", "Send this map's Rush rooms to the script again (warmup only)", OnRushRoomsSendCommand);
        AddCommand("rushsite_reload", "Reload match.json if no match is running", OnReloadCommand);

        AddTimer(1.0f, () => _timing.Run("tick", () =>
        {
            if (_match is null) EnsureMatch();
            _match?.Tick();
        }), TimerFlags.REPEAT);

        if (hotReload) EnsureMatch();
    }

    private void On<T>(string name, GameEventHandler<T> handler) where T : GameEvent =>
        RegisterEventHandler<T>((ev, info) => _timing.Run(name, () => handler(ev, info)));

    // Compiles the plugin's own methods now, on load, instead of on first use during a match.
    // Runs on the game thread because JIT can run static constructors of CounterStrikeSharp types.
    private void PrepareCode()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var n = Warmup.PrepareAssembly(typeof(RushsiteMatchPlugin).Assembly);
        Logger.LogInformation("warm-up: compiled {Count} plugin methods in {Ms} ms", n, sw.ElapsedMilliseconds);
        // Core has no game types, so it compiles on a background thread.
        Task.Run(() =>
        {
            try
            {
                var bg = System.Diagnostics.Stopwatch.StartNew();
                var count = Warmup.PrepareAssembly(typeof(MatchController).Assembly);
                Logger.LogInformation("warm-up: compiled {Count} core methods in {Ms} ms off the game thread", count, bg.ElapsedMilliseconds);
            }
            catch (Exception e)
            {
                Logger.LogWarning("warm-up of core methods failed: {Message}", e.Message);
            }
        });
    }

    // Plays one match against a do-nothing game server off the game thread, with a fresh copy of match.json.
    // The lineup, countdown, chat, serializer and state paths are then warm before any player joins.
    private void WarmMatchPaths(string path, MatchSettings settings)
    {
        if (_warmedUp) return;
        _warmedUp = true;
        Task.Run(() =>
        {
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var events = Warmup.SimulateMatch(MatchConfigLoader.LoadFile(path), settings);
                Logger.LogInformation("warm-up: simulated a match ({Events}) in {Ms} ms off the game thread", string.Join(",", events), sw.ElapsedMilliseconds);
            }
            catch (Exception e)
            {
                Logger.LogWarning("warm-up match simulation failed: {Message}", e.Message);
            }
        });
    }

    private void WarnIfHotReloadEnabled()
    {
        try
        {
            if (CoreConfig.PluginHotReloadEnabled)
                Logger.LogWarning("CounterStrikeSharp PluginHotReloadEnabled is true. Set it to false in configs/core.json on game hosts so a DLL copy cannot reload the plugin mid match.");
        }
        catch (Exception e)
        {
            Logger.LogWarning("could not read CounterStrikeSharp core config: {Message}", e.Message);
        }
    }

    public override void Unload(bool hotReload)
    {
        if (_store is not null && !_store.Flush(TimeSpan.FromSeconds(2)))
            Logger.LogWarning("match state write still running at unload");
        var hooks = _webhooks;
        _webhooks = null;
        if (hooks is null) return;
        hooks.FlushAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
        hooks.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _transport?.Dispose();
    }

    private void EnsureMatch()
    {
        if (_match is not null)
        {
            _match.OnMapStart();
            return;
        }
        string path;
        MatchConfig cfg;
        try
        {
            path = MatchConfigLoader.ResolvePath(
                Environment.GetEnvironmentVariable(MatchConfigLoader.MatchJsonEnv),
                MatchConfigPath.Value,
                ReadCommandLine(),
                Environment.GetEnvironmentVariable(MatchConfigLoader.MatchDirEnv),
                _game!.CsgoDirectory);
            cfg = MatchConfigLoader.LoadFile(path);
        }
        catch (Exception e)
        {
            if (_loadError != e.Message) Logger.LogError("match config not loaded: {Message}", e.Message);
            _loadError = e.Message;
            return;
        }

        var envId = Environment.GetEnvironmentVariable(MatchConfigLoader.MatchIdEnv);
        if (!string.IsNullOrEmpty(envId) && envId != cfg.MatchId)
        {
            Logger.LogError("match.json matchId {Cfg} does not match {Env}={EnvId}. Not starting.", cfg.MatchId, MatchConfigLoader.MatchIdEnv, envId);
            return;
        }

        Logger.LogInformation("loaded match config from {Path}", path);
        _transport = new HttpClientTransport(TimeSpan.FromSeconds(10));
        _webhooks = new WebhookDispatcher(
            cfg.WebhookUrl,
            cfg.WebhookSecret,
            _transport,
            new WebhookOptions { MaxAttempts = Math.Max(1, WebhookMaxAttempts.Value) },
            msg => Logger.LogWarning("{Message}", msg));
        var settings = new MatchSettings
        {
            ConnectGrace = TimeSpan.FromSeconds(ConnectGrace.Value),
            DisconnectGrace = TimeSpan.FromSeconds(DisconnectGrace.Value),
            MissingCountdown = MissingCountdown.Value,
            StartCountdown = TimeSpan.FromSeconds(Math.Max(0, StartCountdown.Value)),
            AimSpawnImmunity = TimeSpan.FromSeconds(Math.Max(0, AimSpawnImmunity.Value)),
            AimLoadout = AimLoadout.Value,
            OvertimeMaxRounds = Math.Max(0, OvertimeMaxRounds.Value),
            OvertimeStartMoney = Math.Max(0, OvertimeStartMoney.Value),
            SeriesMapBreak = TimeSpan.FromSeconds(Math.Max(0, SeriesMapBreak.Value)),
            TvDelay = TvDelay.Value < 0 ? null : TvDelay.Value,
            MatchEndWait = TimeSpan.FromSeconds(MatchEndWait.Value),
            MatchEndKickDelay = TimeSpan.FromSeconds(Math.Max(0, MatchEndKickDelay.Value)),
            DemoStopExtra = TimeSpan.FromSeconds(DemoStopExtra.Value),
            AimHalftime = AimHalftime.Value,
            PauseOnDisconnect = PauseOnDisconnect.Value,
            KickBots = KickBots.Value,
            TryChangeTeam = TryChangeTeam.Value,
            TeamJoinRefusalsBeforeKick = Math.Max(1, TeamJoinRefusals.Value),
            HoldRushWarmup = HoldRushWarmup.Value,
            RushRooms = RushRooms.Value,
        };
        var uploader = new HttpDemoUploader(msg => Logger.LogInformation("{Message}", msg));
        var fileStore = new FileMatchStateStore(FileMatchStateStore.PathNextTo(path), msg => Logger.LogWarning("{Message}", msg));
        var store = new BackgroundMatchStateStore(fileStore, msg => Logger.LogWarning("{Message}", msg));
        _store = store;
        var saved = store.Load();
        _match = new MatchController(cfg, settings, _game!, _webhooks, new SystemClock(), uploader, store);
        WarmMatchPaths(path, settings);
        if (FileMatchStateStore.ShouldRestore(saved, cfg, _hotReload))
        {
            Logger.LogWarning("plugin reloaded during match {MatchId}. Restoring state from {Path}.", cfg.MatchId, fileStore.Path);
            _match.Restore(saved!);
        }
        else
        {
            _match.Start();
        }

        // Players already on the server after a hot reload.
        foreach (var p in CssGameServer.HumanPlayers())
        {
            if (p.UserId is not int uid) continue;
            var authorized = p.AuthorizedSteamID?.SteamId64.ToString();
            if (authorized is not null) _match.OnPlayerTeam(authorized, SideExtensions.FromTeamNum(p.TeamNum));
            _match.OnPlayerConnectFull(uid, authorized, p.SteamID.ToString());
        }
    }

    private static IReadOnlyList<string> ReadCommandLine()
    {
        try
        {
            var raw = File.ReadAllText("/proc/self/cmdline");
            return raw.Split('\0', StringSplitOptions.RemoveEmptyEntries);
        }
        catch
        {
            return Environment.GetCommandLineArgs();
        }
    }

    private static string? Sid(CCSPlayerController? p) =>
        p is { IsValid: true, IsBot: false, IsHLTV: false } && p.SteamID != 0 ? p.SteamID.ToString() : null;

    private void OnClientAuthorized(int slot, SteamID steamId)
    {
        if (_match is null) return;
        var p = Utilities.GetPlayerFromSlot(slot);
        if (p is null || !p.IsValid || p.IsBot || p.IsHLTV || p.UserId is not int uid) return;
        // Also counts a player who finished connecting before Steam confirmed them.
        _match.OnClientAuthorized(steamId.SteamId64.ToString(), uid);
    }

    private HookResult OnPlayerConnectFull(EventPlayerConnectFull ev, GameEventInfo info)
    {
        var p = ev.Userid;
        if (_match is null || p is null || !p.IsValid || p.IsBot || p.IsHLTV || p.UserId is not int uid) return HookResult.Continue;
        // Unauthorized players are counted by OnClientAuthorized once Steam confirms them.
        _match.OnPlayerConnectFull(uid, p.AuthorizedSteamID?.SteamId64.ToString(), p.SteamID != 0 ? p.SteamID.ToString() : null);
        return HookResult.Continue;
    }

    private HookResult OnPlayerDisconnect(EventPlayerDisconnect ev, GameEventInfo info)
    {
        if (_match is null || ev.Userid is { IsBot: true }) return HookResult.Continue;
        var id = Sid(ev.Userid) ?? (ev.Xuid != 0 ? ev.Xuid.ToString() : null);
        if (id is not null) _match.OnPlayerDisconnected(id, ev.Userid?.UserId, ev.Name);
        return HookResult.Continue;
    }

    private HookResult OnPlayerTeam(EventPlayerTeam ev, GameEventInfo info)
    {
        if (_match is null || ev.Disconnect || ev.Isbot) return HookResult.Continue;
        var id = Sid(ev.Userid);
        if (id is not null) _match.OnPlayerTeam(id, SideExtensions.FromTeamNum(ev.Team));
        return HookResult.Continue;
    }

    private HookResult OnPlayerSpawn(EventPlayerSpawn ev, GameEventInfo info)
    {
        if (_match is null || !_match.ManagesMatch) return HookResult.Continue;
        var id = Sid(ev.Userid);
        if (id is null) return HookResult.Continue;
        // The map and the game hand out their items during the spawn. Apply the loadout after them.
        AddTimer(0.2f, () => _timing.Run("spawn_loadout", () =>
        {
            var p = CssGameServer.HumanPlayers().FirstOrDefault(x => x.SteamID.ToString() == id);
            if (p is null || !p.PawnIsAlive) return;
            _match?.OnPlayerSpawn(id, SideExtensions.FromTeamNum(p.TeamNum));
        }), TimerFlags.STOP_ON_MAPCHANGE);
        return HookResult.Continue;
    }

    private HookResult OnJoinTeam(CCSPlayerController? player, CommandInfo info)
    {
        var id = Sid(player);
        if (_match is null || id is null || info.ArgCount < 2) return HookResult.Continue;
        if (!int.TryParse(info.ArgByIndex(1), out var team)) return HookResult.Continue;
        return _match.OnJoinTeamRequest(id, SideExtensions.FromTeamNum(team)) ? HookResult.Continue : HookResult.Handled;
    }

    private HookResult OnRoundStart(EventRoundStart ev, GameEventInfo info)
    {
        _match?.OnRoundStart();
        return HookResult.Continue;
    }

    private HookResult OnRoundFreezeEnd(EventRoundFreezeEnd ev, GameEventInfo info)
    {
        // Rush moves spawns during the round start. Read positions on the next frame.
        _game!.NextFrame("round_freeze_end", () => _match?.OnRoundFreezeEnd(CssGameServer.IsWarmup()));
        return HookResult.Continue;
    }

    private HookResult OnRoundEnd(EventRoundEnd ev, GameEventInfo info)
    {
        _match?.OnRoundEnd(
            SideExtensions.FromTeamNum(ev.Winner),
            ev.Reason == (int)RoundEndReason.GameCommencing,
            CssGameServer.IsWarmup());
        return HookResult.Continue;
    }

    private HookResult OnPlayerDeath(EventPlayerDeath ev, GameEventInfo info)
    {
        _match?.OnPlayerDeath(new DeathInfo(
            Sid(ev.Attacker),
            Sid(ev.Userid),
            Sid(ev.Assister),
            ev.Weapon,
            ev.Headshot,
            ev.Penetrated,
            Server.TickCount));
        return HookResult.Continue;
    }

    private HookResult OnPlayerHurt(EventPlayerHurt ev, GameEventInfo info)
    {
        _match?.OnPlayerHurt(Sid(ev.Attacker), Sid(ev.Userid), ev.DmgHealth);
        return HookResult.Continue;
    }

    private HookResult OnWinPanelMatch(EventCsWinPanelMatch ev, GameEventInfo info)
    {
        _match?.OnWinPanelMatch();
        return HookResult.Continue;
    }

    private HookResult OnMatchStartSignal(EventRoundAnnounceMatchStart ev, GameEventInfo info)
    {
        _match?.OnRushMatchLive();
        return HookResult.Continue;
    }

    private HookResult OnBeginNewMatch(EventBeginNewMatch ev, GameEventInfo info)
    {
        _match?.OnRushMatchLive();
        return HookResult.Continue;
    }

    private void Reply(CCSPlayerController? player, CommandInfo info, Func<string, string> action)
    {
        var id = Sid(player);
        if (_match is null || id is null) return;
        info.ReplyToCommand(action(id));
    }

    private void OnStatusCommand(CCSPlayerController? player, CommandInfo info)
    {
        if (player is not null) return;
        info.ReplyToCommand(_match?.Status() ?? $"no match loaded. {_loadError}");
    }

    private void OnForceStartCommand(CCSPlayerController? player, CommandInfo info)
    {
        if (player is not null) return;
        info.ReplyToCommand(_match?.ForceStart() == true ? "match started" : "force start only works in aim warmup");
    }

    private void OnRushRoomsSendCommand(CCSPlayerController? player, CommandInfo info)
    {
        if (player is not null) return;
        info.ReplyToCommand(_match?.ResendRushRooms() ?? $"no match loaded. {_loadError}");
    }

    private void OnReloadCommand(CCSPlayerController? player, CommandInfo info)
    {
        if (player is not null) return;
        if (_match is not null)
        {
            info.ReplyToCommand("a match is already loaded. Restart the server to load another.");
            return;
        }
        _loadError = null;
        EnsureMatch();
        info.ReplyToCommand(_match is null ? $"load failed. {_loadError}" : "match loaded");
    }
}
