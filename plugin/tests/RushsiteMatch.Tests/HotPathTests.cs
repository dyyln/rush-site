using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using RushsiteMatch.Core.Runtime;
using RushsiteMatch.Core.State;
using RushsiteMatch.Core.Webhooks;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

// Work that must not run inside a client's message processing on the game thread.
public class DeferredLineupTests
{
    private readonly FakeGame _game = new() { DeferFrames = true };
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();

    private MatchController New(MatchConfig cfg)
    {
        var m = new MatchController(cfg, new MatchSettings(), _game, _sink, _clock, new FakeUploader());
        m.Start();
        return m;
    }

    private void Join(MatchController m, string id, Side side, int uid)
    {
        m.OnPlayerConnected(id, uid);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    [Fact]
    public void AimCountdownStartsOnTheNextFrameNotInsideThePlayerTeamEvent()
    {
        var m = New(Aim1v1());
        Join(m, A1, Side.CT, 1);
        _game.RunFrame();
        Join(m, B1, Side.T, 2);

        Assert.False(m.CountdownRunning);
        Assert.True(m.LineupCheckQueued);
        Assert.DoesNotContain(_game.Chat, c => c.Contains("All players are in"));
        Assert.Empty(_game.Center);
        // The connect and the team change share one queued check.
        Assert.Equal("lineup_check", Assert.Single(_game.Frames).Name);

        _game.RunFrame();
        Assert.True(m.CountdownRunning);
        Assert.False(m.LineupCheckQueued);
        Assert.Contains(_game.Chat, c => c.Contains("All players are in"));
        Assert.Single(_game.Center);
    }

    [Fact]
    public void RushCountdownStartIsDeferredToo()
    {
        var m = New(Rush1v1());
        Join(m, A1, Side.CT, 1);
        Join(m, B1, Side.T, 2);
        Assert.False(m.CountdownRunning);
        _game.RunFrame();
        Assert.True(m.CountdownRunning);
    }

    [Fact]
    public void CancelNamesTheOnePlayerWhoLeft()
    {
        _game.Names[A1] = "Yama";
        var m = New(Aim1v1());
        Join(m, A1, Side.CT, 1);
        Join(m, B1, Side.T, 2);
        _game.RunFrame();
        Assert.True(m.CountdownRunning);

        m.OnPlayerDisconnected(A1, 1, "Yama");
        Assert.True(m.CountdownRunning);
        _game.RunFrame();
        Assert.False(m.CountdownRunning);
        Assert.Contains(_game.Logs, l => l.Contains("left [Yama] switched []"));
    }

    [Fact]
    public void TwoPlayersLeavingInOneFrameAreBothNamed()
    {
        _game.Names[A1] = "Yama";
        _game.Names[B1] = "Kilo";
        var m = New(Aim1v1());
        Join(m, A1, Side.CT, 1);
        Join(m, B1, Side.T, 2);
        _game.RunFrame();

        m.OnPlayerDisconnected(A1, 1, "Yama");
        m.OnPlayerDisconnected(B1, 2, "Kilo");
        Assert.Single(_game.Frames);
        _game.RunFrame();
        Assert.Contains(_game.Logs, l => l.Contains("left [Yama,Kilo]"));
    }

    [Fact]
    public void QueuedCheckDoesNothingOnceTheMatchIsLive()
    {
        var m = New(Aim1v1());
        Join(m, A1, Side.CT, 1);
        Join(m, B1, Side.T, 2);
        Assert.True(m.ForceStart());
        _game.RunFrame();
        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.DoesNotContain(_game.Chat, c => c.Contains("All players are in"));
    }
}

public class BackgroundStateStoreTests
{
    private sealed class BlockingStore : IMatchStateStore
    {
        public readonly ManualResetEventSlim Gate = new(false);
        public readonly List<(string Phase, int Thread)> Written = new();
        public MatchState? Load() => null;
        public void Save(MatchState state)
        {
            Gate.Wait(TimeSpan.FromSeconds(10));
            lock (Written) Written.Add((state.Phase, Environment.CurrentManagedThreadId));
        }
    }

    [Fact]
    public void SaveReturnsWhileTheWriteIsBlockedAndTheLastStateWins()
    {
        var inner = new BlockingStore();
        var store = new BackgroundMatchStateStore(inner);
        store.Save(new MatchState { Phase = "Warmup" });
        store.Save(new MatchState { Phase = "Live" });
        store.Save(new MatchState { Phase = "Ended" });
        lock (inner.Written) Assert.Empty(inner.Written);
        Assert.False(store.Flush(TimeSpan.FromMilliseconds(50)));

        inner.Gate.Set();
        Assert.True(store.Flush(TimeSpan.FromSeconds(10)));
        lock (inner.Written)
        {
            Assert.Equal("Ended", inner.Written[^1].Phase);
            Assert.InRange(inner.Written.Count, 1, 2);
            Assert.DoesNotContain(inner.Written, w => w.Thread == Environment.CurrentManagedThreadId);
        }
    }

    [Fact]
    public void WritesTheFileOffTheCallerThread()
    {
        var dir = Path.Combine(Path.GetTempPath(), "rushsite-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var file = new FileMatchStateStore(Path.Combine(dir, FileMatchStateStore.FileName));
            var store = new BackgroundMatchStateStore(file);
            for (var i = 1; i <= 20; i++) store.Save(new MatchState { MatchId = "m", Phase = "Live", Round = i });
            Assert.True(store.Flush(TimeSpan.FromSeconds(10)));
            Assert.Equal(20, store.Load()!.Round);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void InnerErrorsAreLoggedNotThrown()
    {
        var logs = new List<string>();
        var store = new BackgroundMatchStateStore(new ThrowingStore(), m => { lock (logs) logs.Add(m); });
        store.Save(new MatchState());
        Assert.True(store.Flush(TimeSpan.FromSeconds(10)));
        lock (logs) Assert.Contains(logs, l => l.Contains("disk full"));
    }

    private sealed class ThrowingStore : IMatchStateStore
    {
        public MatchState? Load() => null;
        public void Save(MatchState state) => throw new IOException("disk full");
    }
}

public class WebhookOffThreadTests
{
    private sealed class HangingTransport : IHttpTransport
    {
        public readonly TaskCompletionSource<int> Response = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls;
        public int CallerThread;
        public Task<int> PostJsonAsync(string url, string body, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
        {
            CallerThread = Environment.CurrentManagedThreadId;
            Interlocked.Increment(ref Calls);
            return Response.Task;
        }
    }

    [Fact]
    public async Task EnqueueReturnsWhileTheApiHangs()
    {
        var transport = new HangingTransport();
        await using var hooks = new WebhookDispatcher("https://api.example/h", "s", transport, new WebhookOptions(), _ => { });
        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (var i = 0; i < 50; i++) hooks.Enqueue(new PlayerConnected(A1));
        Assert.True(sw.ElapsedMilliseconds < 500);
        for (var i = 0; i < 100 && Volatile.Read(ref transport.Calls) == 0; i++) await Task.Delay(20);
        Assert.Equal(1, Volatile.Read(ref transport.Calls));
        Assert.NotEqual(Environment.CurrentManagedThreadId, transport.CallerThread);
        Assert.Equal(50, hooks.Pending);
        transport.Response.SetResult(200);
        Assert.True(await hooks.FlushAsync(TimeSpan.FromSeconds(10)));
    }
}

public class HandlerTimingTests
{
    private long _now;
    private readonly List<string> _warnings = new();

    private HandlerTiming New(double thresholdMs = 20) =>
        new(TimeSpan.FromMilliseconds(thresholdMs), _warnings.Add, () => _now, 1000);

    [Fact]
    public void WarnsOncePerHandlerPerMap()
    {
        var t = New();
        t.Run("player_team", () => _now += 223);
        t.Run("player_team", () => _now += 300);
        t.Run("tick", () => _now += 5);
        Assert.Equal(HookResultLike.Continue, t.Run("jointeam", () => { _now += 40; return HookResultLike.Continue; }));

        Assert.Equal(2, _warnings.Count);
        Assert.Contains("slow handler player_team took 223 ms", _warnings[0]);
        Assert.Contains("slow handler jointeam took 40 ms", _warnings[1]);

        t.NewMap();
        t.Run("player_team", () => _now += 25);
        Assert.Equal(3, _warnings.Count);
    }

    [Fact]
    public void MeasuresHandlersThatThrow()
    {
        var t = New();
        Assert.Throws<InvalidOperationException>(() => t.Run("round_end", () =>
        {
            _now += 50;
            throw new InvalidOperationException();
        }));
        Assert.Single(_warnings);
    }

    [Fact]
    public void ZeroThresholdTurnsItOff()
    {
        var t = New(0);
        t.Run("player_team", () => _now += 1000);
        Assert.Empty(_warnings);
    }

    private enum HookResultLike { Continue }
}

public class WarmupTests
{
    public static IEnumerable<object[]> Configs() => new[]
    {
        new object[] { "aim1v1" },
        new object[] { "aim2v2" },
        new object[] { "rush" },
        new object[] { "rush1v1" },
        new object[] { "rush2v2" },
        new object[] { "aimBo3" },
        new object[] { "rushBo3" },
    };

    private static MatchConfig Config(string name) => name switch
    {
        "aim1v1" => Aim1v1(),
        "aim2v2" => Aim2v2(),
        "rush" => Rush(),
        "rush1v1" => Rush1v1(),
        "rush2v2" => Rush2v2(),
        "aimBo3" => AimBo3(),
        _ => RushBo3(),
    };

    [Theory]
    [MemberData(nameof(Configs))]
    public void SimulatedMatchRunsWithoutSideEffects(string name)
    {
        var events = Warmup.SimulateMatch(Config(name), new MatchSettings());
        // The simulation must get through the countdown and the live match to reach the hot paths.
        Assert.Equal("server_ready", events[0]);
        Assert.Contains("match_started", events);
        Assert.Contains("round_end", events);
        Assert.Contains(events, e => e is "match_end" or "map_end");
    }

    [Fact]
    public void PreparesCoreMethods()
    {
        Assert.True(Warmup.PrepareAssembly(typeof(MatchController).Assembly) > 100);
    }
}
