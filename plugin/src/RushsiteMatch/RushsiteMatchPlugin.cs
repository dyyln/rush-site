using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Entities;
using CounterStrikeSharp.API.Modules.Entities.Constants;
using CounterStrikeSharp.API.Modules.Timers;
using Microsoft.Extensions.Logging;
using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Demo;
using RushsiteMatch.Core.Match;
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
    public FakeConVar<int> ReadyTimeout = new("rushsite_ready_timeout", "Aim modes. Seconds after everyone connects before the match starts without all ready.", 180);
    public FakeConVar<bool> AimHalftime = new("rushsite_aim_halftime", "Aim modes. Swap sides at halftime.", false);
    public FakeConVar<bool> PauseOnDisconnect = new("rushsite_pause_on_disconnect", "Aim modes. Pause at the next freeze time when a player disconnects.", true);
    public FakeConVar<int> MatchEndWait = new("rushsite_match_end_wait", "Seconds to wait for cs_win_panel_match after the score decides the match.", 10);
    public FakeConVar<int> DemoStopExtra = new("rushsite_demo_stop_extra", "Seconds added to tv_delay before tv_stoprecord.", 5);
    public FakeConVar<bool> KickBots = new("rushsite_kick_bots", "Hold bot_quota at 0 and kick bots.", true);
    public FakeConVar<bool> TryChangeTeam = new("rushsite_try_changeteam", "Also try ChangeTeam to put players on their side. Broken on CS2 1.41.8.2.", false);
    public FakeConVar<int> TeamJoinRefusals = new("rushsite_team_refusals", "Rush. Wrong side joins before the player is kicked.", 3);
    public FakeConVar<bool> HoldRushWarmup = new("rushsite_rush_hold_warmup", "Rush. Hold warmup until every player is in and on their side.", true);
    public FakeConVar<int> WebhookMaxAttempts = new("rushsite_webhook_max_attempts", "Delivery attempts per webhook event before it is dropped.", 10);

    private MatchController? _match;
    private WebhookDispatcher? _webhooks;
    private HttpClientTransport? _transport;
    private CssGameServer? _game;
    private string? _loadError;
    private bool _hotReload;

    public override void Load(bool hotReload)
    {
        _hotReload = hotReload;
        _game = new CssGameServer(Logger, () => TryChangeTeam.Value);
        WarnIfHotReloadEnabled();

        RegisterListener<Listeners.OnMapStart>(_ => AddTimer(1.0f, EnsureMatch, TimerFlags.STOP_ON_MAPCHANGE));
        RegisterListener<Listeners.OnClientAuthorized>(OnClientAuthorized);

        RegisterEventHandler<EventPlayerConnectFull>(OnPlayerConnectFull);
        RegisterEventHandler<EventPlayerDisconnect>(OnPlayerDisconnect);
        RegisterEventHandler<EventPlayerTeam>(OnPlayerTeam);
        RegisterEventHandler<EventRoundStart>(OnRoundStart);
        RegisterEventHandler<EventRoundFreezeEnd>(OnRoundFreezeEnd);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        RegisterEventHandler<EventPlayerDeath>(OnPlayerDeath);
        RegisterEventHandler<EventPlayerHurt>(OnPlayerHurt);
        RegisterEventHandler<EventCsWinPanelMatch>(OnWinPanelMatch);
        RegisterEventHandler<EventRoundAnnounceMatchStart>(OnMatchStartSignal);
        RegisterEventHandler<EventBeginNewMatch>(OnBeginNewMatch);

        AddCommandListener("jointeam", OnJoinTeam, HookMode.Pre);
        AddCommand("css_ready", "Mark yourself ready", (p, info) => Reply(p, info, id => _match!.OnReady(id)));
        AddCommand("css_unready", "Mark yourself not ready", (p, info) => Reply(p, info, id => _match!.OnUnready(id)));
        AddCommand("rushsite_status", "Print match status", OnStatusCommand);
        AddCommand("rushsite_force_start", "Start an aim match now", OnForceStartCommand);
        AddCommand("rushsite_reload", "Reload match.json if no match is running", OnReloadCommand);

        AddTimer(1.0f, () =>
        {
            if (_match is null) EnsureMatch();
            _match?.Tick();
        }, TimerFlags.REPEAT);

        if (hotReload) EnsureMatch();
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
            ReadyTimeout = TimeSpan.FromSeconds(ReadyTimeout.Value),
            MatchEndWait = TimeSpan.FromSeconds(MatchEndWait.Value),
            DemoStopExtra = TimeSpan.FromSeconds(DemoStopExtra.Value),
            AimHalftime = AimHalftime.Value,
            PauseOnDisconnect = PauseOnDisconnect.Value,
            KickBots = KickBots.Value,
            TryChangeTeam = TryChangeTeam.Value,
            TeamJoinRefusalsBeforeKick = Math.Max(1, TeamJoinRefusals.Value),
            HoldRushWarmup = HoldRushWarmup.Value,
        };
        var uploader = new HttpDemoUploader(msg => Logger.LogInformation("{Message}", msg));
        var store = new FileMatchStateStore(FileMatchStateStore.PathNextTo(path), msg => Logger.LogWarning("{Message}", msg));
        var saved = store.Load();
        _match = new MatchController(cfg, settings, _game!, _webhooks, new SystemClock(), uploader, store);
        if (FileMatchStateStore.ShouldRestore(saved, cfg, _hotReload))
        {
            Logger.LogWarning("plugin reloaded during match {MatchId}. Restoring state from {Path}.", cfg.MatchId, store.Path);
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
        if (id is not null) _match.OnPlayerDisconnected(id, ev.Userid?.UserId);
        return HookResult.Continue;
    }

    private HookResult OnPlayerTeam(EventPlayerTeam ev, GameEventInfo info)
    {
        if (_match is null || ev.Disconnect || ev.Isbot) return HookResult.Continue;
        var id = Sid(ev.Userid);
        if (id is not null) _match.OnPlayerTeam(id, SideExtensions.FromTeamNum(ev.Team));
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
        Server.NextFrame(() => _match?.OnRoundFreezeEnd(CssGameServer.IsWarmup()));
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
