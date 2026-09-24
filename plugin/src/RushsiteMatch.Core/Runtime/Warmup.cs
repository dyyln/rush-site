using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using RushsiteMatch.Core.State;
using RushsiteMatch.Core.Webhooks;

namespace RushsiteMatch.Core.Runtime;

// First use of a .NET code path pays for JIT and serializer setup. On the game thread that
// cost can land inside a client's message processing. The warm-up pays it early, off the game
// thread and before players join. Nothing here touches the game or the network.
public static class Warmup
{
    // Compiles every non generic method and constructor of the assembly. Returns how many compiled.
    public static int PrepareAssembly(Assembly asm)
    {
        var count = 0;
        Type[] types;
        try
        {
            types = asm.GetTypes();
        }
        catch (ReflectionTypeLoadException e)
        {
            types = e.Types.OfType<Type>().ToArray();
        }
        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance |
                                 BindingFlags.Static | BindingFlags.DeclaredOnly;
        foreach (var t in types)
        {
            if (t.ContainsGenericParameters || t.IsInterface) continue;
            var methods = t.GetMethods(all).Cast<MethodBase>().Concat(t.GetConstructors(all));
            foreach (var m in methods)
            {
                if (m.IsAbstract || m.ContainsGenericParameters) continue;
                if ((m.MethodImplementationFlags & (MethodImplAttributes.InternalCall | MethodImplAttributes.Runtime)) != 0) continue;
                if ((m.Attributes & MethodAttributes.PinvokeImpl) != 0) continue;
                try
                {
                    RuntimeHelpers.PrepareMethod(m.MethodHandle);
                    count++;
                }
                catch
                {
                    // Some methods cannot be prepared ahead. They compile on first call as usual.
                }
            }
        }
        return count;
    }

    // Plays a whole match against a game server that does nothing. That runs the lineup check,
    // countdown, chat lines, round and match end paths once. Every event and state it produces
    // is serialized with the real options, so the webhook and state writers start warm.
    // Returns the types of the events the simulated match sent, in order.
    public static IReadOnlyList<string> SimulateMatch(MatchConfig cfg, MatchSettings real)
    {
        var settings = new MatchSettings
        {
            ConnectGrace = TimeSpan.FromHours(1),
            DisconnectGrace = TimeSpan.FromHours(1),
            MissingCountdown = real.MissingCountdown,
            StartCountdown = TimeSpan.FromSeconds(3),
            AimSpawnImmunity = real.AimSpawnImmunity,
            AimLoadout = real.AimLoadout,
            OvertimeMaxRounds = real.OvertimeMaxRounds,
            OvertimeStartMoney = real.OvertimeStartMoney,
            SeriesMapBreak = TimeSpan.Zero,
            MatchEndWait = TimeSpan.FromSeconds(1),
            MatchEndKickDelay = TimeSpan.FromSeconds(1),
            DemoStopExtra = TimeSpan.Zero,
            AimHalftime = real.AimHalftime,
            PauseOnDisconnect = real.PauseOnDisconnect,
            KickBots = real.KickBots,
            TryChangeTeam = false,
            TeamJoinRefusalsBeforeKick = real.TeamJoinRefusalsBeforeKick,
            HoldRushWarmup = real.HoldRushWarmup,
            RushRooms = real.RushRooms,
            RushRoomsReplyTimeout = TimeSpan.FromSeconds(1),
        };
        var game = new NullGame(cfg.Password);
        var sink = new SerializingSink(cfg.WebhookSecret);
        var clock = new StepClock();
        var store = new SerializingStore();
        var m = new MatchController(cfg, settings, game, sink, clock, new NullUploader(), store);
        m.Start();

        var mapNumber = cfg.Series?.StartMapNumber ?? 1;
        var userId = 1;
        foreach (var team in cfg.Teams)
        {
            var side = cfg.ConfiguredSide(team.Name, mapNumber) == TeamConfig.SideT ? Side.T : Side.CT;
            foreach (var id in team.SteamIds)
            {
                game.Sides[id] = side;
                m.OnClientAuthorized(id, userId);
                m.OnPlayerConnectFull(userId, id, id);
                m.OnJoinTeamRequest(id, side);
                m.OnPlayerTeam(id, side);
                userId++;
            }
        }
        // The countdown runs, the rooms time out for Rush, and the match goes live.
        for (var i = 0; i < 10 && m.Phase == MatchPhase.Warmup; i++)
        {
            clock.Advance(1);
            m.Tick();
        }
        if (m.Phase == MatchPhase.Warmup) m.OnRushMatchLive();
        m.OnRoundStart();
        m.OnRoundFreezeEnd(false);
        foreach (var (id, side) in game.Sides) m.OnPlayerSpawn(id, side);
        var ids = cfg.AllowedSteamIds;
        if (ids.Count >= 2)
        {
            m.OnPlayerHurt(ids[0], ids[^1], 100);
            m.OnPlayerDeath(new DeathInfo(ids[0], ids[^1], null, "weapon_ak47", true, 0, 1));
        }
        m.OnRoundEnd(Side.CT, false, false);
        m.Status();
        m.OnPlayerDisconnected(ids[0], 1, "warmup");
        m.OnPlayerConnected(ids[0], 1);
        m.OnWinPanelMatch();
        for (var i = 0; i < 5; i++)
        {
            clock.Advance(1);
            m.Tick();
        }

        // Paths the short match above does not reach.
        var msg = m.Messages;
        var score = cfg.Teams.ToDictionary(t => t.Name, _ => 0);
        msg.CountdownCancelled(new[] { "a" }, new[] { "b", "c" });
        msg.CountdownTick("The match", 5);
        msg.StillAway("a", TimeSpan.FromSeconds(30));
        msg.Returned("a", true);
        msg.MapOver(1, "map", MatchEventJson.Draw, score, score, "next", 30);
        msg.SeriesOver(cfg.Teams[0].Name, score);
        MatchMessages.MissingCenter(new[]
        {
            new MatchMessages.Missing("a", TimeSpan.FromSeconds(30), true),
            new MatchMessages.Missing("b", TimeSpan.FromSeconds(60), false),
        });
        Loadout.IsWeaponName("weapon_ak47");
        var sent = sink.Types.ToList();
        foreach (var evt in SampleEvents(cfg)) sink.Enqueue(evt);
        JsonSerializer.Deserialize<MatchState>(store.LastJson ?? "{}", MatchConfigLoader.JsonOptions);
        return sent;
    }

    private static IEnumerable<MatchEvent> SampleEvents(MatchConfig cfg)
    {
        var id = cfg.AllowedSteamIds.FirstOrDefault() ?? "0";
        var score = cfg.Teams.ToDictionary(t => t.Name, _ => 0);
        var players = new[] { new PlayerStats(id, 1, 1, 1, 100) };
        var rooms = new[] { 1, 2, 3, 4, 5, 6, 7 };
        yield return new ServerReady();
        yield return new PlayerConnected(id);
        yield return new PlayerDisconnected(id);
        yield return new MatchStarted { MapNumber = 1, RushRooms = rooms, RushRoomsConfirmed = true };
        yield return new RushRoomsFailed("no_reply", rooms) { Detail = "x", MapNumber = 1 };
        yield return new RushRoomsMismatch(1, "101", "102", rooms) { MapNumber = 1 };
        yield return new RoundEnd(1, MatchEventJson.Draw, score) { Arena = "101", MapNumber = 1 };
        yield return new Kill(1, 1, id, id, "weapon_ak47", true, false) { Assister = id, MapNumber = 1 };
        yield return new MapEnd(1, "map", MatchEventJson.Draw, score, players, false);
        yield return new MatchEnd(MatchEventJson.Draw, score, players, false)
        {
            Maps = new[] { new MapSummary(1, "map", MatchEventJson.Draw, score) },
        };
        yield return new MatchAbandoned("no_show", new[] { id });
        yield return new DemoUploaded(true) { Bytes = 1, Error = "x", MapNumber = 1 };
    }

    private sealed class SerializingSink : IEventSink
    {
        private readonly string _secret;
        public SerializingSink(string secret) => _secret = secret;
        public readonly List<string> Types = new();

        public void Enqueue(MatchEvent evt)
        {
            WebhookSigner.Sign(MatchEventJson.SerializeBody(evt), _secret);
            Types.Add(evt.Type);
        }
    }

    private sealed class SerializingStore : IMatchStateStore
    {
        public string? LastJson;
        public void Save(MatchState state) => LastJson = JsonSerializer.Serialize(state, MatchConfigLoader.JsonOptions);
        public MatchState? Load() => null;
    }

    private sealed class StepClock : IClock
    {
        public DateTimeOffset UtcNow { get; private set; } = DateTimeOffset.UnixEpoch;
        public void Advance(double seconds) => UtcNow = UtcNow.AddSeconds(seconds);
    }

    private sealed class NullUploader : IDemoUploader
    {
        public Task<DemoUploadResult> UploadAsync(string path, string presignedPutUrl, CancellationToken ct) =>
            Task.FromResult(DemoUploadResult.Success(1));
    }

    private sealed class NullGame : IGameServer
    {
        private readonly string _password;
        public readonly Dictionary<string, Side> Sides = new();
        public NullGame(string password) => _password = password;

        public void ExecuteCommand(string command) { }
        public string? GetConVar(string name) => name switch
        {
            "sv_password" => _password,
            "tv_enable" => "1",
            "tv_delay" => "0",
            "bot_quota" => "0",
            "mp_warmup_pausetimer" => "1",
            _ => null,
        };
        public void Kick(int userId, string reason) { }
        public void PrintToAll(string message) => ChatColor.Strip(message);
        public void PrintToPlayer(string steamId, string message) => ChatColor.Strip(message);
        public void PrintCenterToAll(string message) { }
        public string? PlayerName(string steamId) => "player";
        public void Log(string message) { }
        public string CsgoDirectory => "";
        public IReadOnlyList<(string SteamId, Side Side)> GetPlayerSides() => Sides.Select(kv => (kv.Key, kv.Value)).ToList();
        public void TryMovePlayer(string steamId, Side side) { }
        public void ForceJoinTeam(string steamId, Side side) { }
        public void KickPlayer(string steamId, string reason) { }
        public IReadOnlyList<ConnectedPlayer> ConnectedPlayers() =>
            Sides.Keys.Select((id, i) => new ConnectedPlayer(id, i + 1, true)).ToList();
        public string? DetectRushArena() => null;
        public string? CurrentMapName => null;
        public void ApplyLoadout(string steamId, PlayerLoadout loadout) { }
        public void NextFrame(string name, Action action) => action();
    }
}
