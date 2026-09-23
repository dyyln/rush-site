using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using RushsiteMatch.Core.State;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class StateTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();
    private readonly MemoryStateStore _store = new();

    private MatchController Make(MatchConfig cfg, MatchSettings? s = null) =>
        new(cfg, s ?? new MatchSettings(), _game, _sink, _clock, _uploader, _store);

    private void Join(MatchController m, string id, Side side)
    {
        m.OnPlayerConnected(id, 1);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    private MatchController LiveRush()
    {
        var m = Make(Rush());
        m.Start();
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
        _game.Arena = "104";
        m.OnRoundFreezeEnd(isWarmup: false);
        return m;
    }

    [Fact]
    public void SavesOnStartPhaseChangesAndEveryRound()
    {
        var m = LiveRush();
        Assert.Equal("Live", _store.State!.Phase);
        m.OnPlayerDeath(new DeathInfo(A1, B1, null, "ak47", true, 0, 1));
        m.OnRoundEnd(Side.CT, false, false);
        m.OnRoundEnd(Side.T, false, false);
        var st = _store.State!;
        Assert.Equal(Rush().MatchId, st.MatchId);
        Assert.Equal(2, st.Round);
        Assert.Equal(1, st.Score["alpha"]);
        Assert.Equal(1, st.Score["bravo"]);
        Assert.Equal(RushScoreTracker.StartSlot, st.RushFrontSlot);
        Assert.True(st.Recording);
        Assert.Equal("104", st.Arena);
        Assert.Equal(1, st.Players.Single(p => p.SteamId == A1).Kills);

        m.OnWinPanelMatch();
        Assert.Equal("Ended", _store.State!.Phase);
    }

    [Fact]
    public void RestoreAfterReloadContinuesTheRushMatch()
    {
        var first = LiveRush();
        first.OnPlayerHurt(A1, B1, 90);
        first.OnPlayerDeath(new DeathInfo(A1, B1, null, "ak47", false, 0, 1));
        first.OnRoundEnd(Side.CT, false, false);
        first.OnRoundEnd(Side.CT, false, false);
        first.OnRoundEnd(Side.CT, false, false);
        var saved = _store.State!;
        Assert.Equal(0, saved.RushFrontSlot);

        _sink.Events.Clear();
        _game.Commands.Clear();
        Assert.True(FileMatchStateStore.ShouldRestore(saved, Rush(), hotReload: true));
        var m = Make(Rush());
        m.Restore(saved);
        foreach (var id in new[] { A1, A2, A3, B1, B2, B3 }) m.OnPlayerConnectFull(1, id, id);

        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.Equal(3, m.Round);
        Assert.DoesNotContain("server_ready", _sink.Types);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("mp_warmup") || c.StartsWith("tv_record"));
        m.OnRushMatchLive();
        Assert.DoesNotContain("match_started", _sink.Types);

        // A fourth CT win is in the T castle and ends the match.
        m.OnRoundEnd(Side.CT, false, false);
        var r = _sink.Last<RoundEnd>();
        Assert.Equal(4, r.Round);
        Assert.Equal(4, r.Score["alpha"]);
        m.OnWinPanelMatch();
        var end = _sink.Last<MatchEnd>();
        Assert.Equal("alpha", end.WinnerTeam);
        var a1 = end.Players.Single(p => p.SteamId == A1);
        Assert.Equal((1, 90), (a1.Kills, a1.Damage));
    }

    [Fact]
    public void RestoredDecidedMatchEndsOnTheScoreTimer()
    {
        var first = LiveRush();
        for (var i = 0; i < 4; i++) first.OnRoundEnd(Side.T, false, false);
        var saved = _store.State!;
        Assert.Equal("T", saved.RushDecided);
        Assert.Equal("Live", saved.Phase);

        _sink.Events.Clear();
        var m = Make(Rush(), new MatchSettings { MatchEndWait = TimeSpan.FromSeconds(10) });
        m.Restore(saved);
        _clock.Advance(10);
        m.Tick();
        Assert.Equal(MatchPhase.Ended, m.Phase);
        Assert.Equal("bravo", _sink.Last<MatchEnd>().WinnerTeam);
    }

    [Fact]
    public void RestoredAimMatchKeepsCountingToSixteen()
    {
        var cfg = Aim1v1();
        var first = Make(cfg);
        first.Start();
        Join(first, A1, Side.CT);
        Join(first, B1, Side.T);
        first.ForceStart();
        for (var i = 0; i < 10; i++) first.OnRoundEnd(Side.CT, false, false);
        var saved = _store.State!;

        _sink.Events.Clear();
        var m = Make(cfg);
        m.Restore(saved);
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        Assert.Contains("already started", m.OnReady(A1));
        for (var i = 0; i < 5; i++) m.OnRoundEnd(Side.CT, false, false);
        Assert.Null(_sink.Events.OfType<MatchEnd>().FirstOrDefault());
        m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();
        Assert.Equal(16, _sink.Last<MatchEnd>().Score["alpha"]);
        Assert.Equal(16, _sink.Last<RoundEnd>().Round);
    }

    [Fact]
    public async Task RestoredEndedMatchStillUploadsTheDemo()
    {
        var first = LiveRush();
        for (var i = 0; i < 4; i++) first.OnRoundEnd(Side.CT, false, false);
        first.OnWinPanelMatch();
        var saved = _store.State!;
        Assert.True(saved.Recording);

        _sink.Events.Clear();
        var m = Make(Rush());
        m.Restore(saved);
        _clock.Advance(5);
        m.Tick();
        Assert.Contains("tv_stoprecord", _game.Commands);
        await m.UploadTask!;
        Assert.Equal(new[] { "demo_uploaded" }, _sink.Types);
        Assert.False(_store.State!.Recording);
    }

    [Fact]
    public void RestoredWarmupHoldsAgainAndSendsNothing()
    {
        var first = Make(Rush());
        first.Start();
        var saved = _store.State!;
        _sink.Events.Clear();
        _game.Commands.Clear();
        var m = Make(Rush());
        m.Restore(saved);
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        Assert.Empty(_sink.Types);
        Assert.Contains("mp_warmup_pausetimer 1", _game.Commands);
    }

    [Fact]
    public void RestoreOnlyAfterAHotReloadOfTheSameMatch()
    {
        var saved = new MatchState { MatchId = Rush().MatchId, Phase = "Live", Round = 3 };
        Assert.True(FileMatchStateStore.ShouldRestore(saved, Rush(), true));
        Assert.False(FileMatchStateStore.ShouldRestore(saved, Rush(), false));
        Assert.False(FileMatchStateStore.ShouldRestore(null, Rush(), true));
        var other = new MatchState { MatchId = "another-match", Phase = "Live" };
        Assert.False(FileMatchStateStore.ShouldRestore(other, Rush(), true));
    }

    [Fact]
    public void FileStoreRoundTripsNextToMatchJson()
    {
        var dir = Path.Combine(Path.GetTempPath(), "rushsite-state-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var path = FileMatchStateStore.PathNextTo(Path.Combine(dir, "match.json"));
            Assert.Equal(Path.Combine(dir, "match_state.json"), path);
            var store = new FileMatchStateStore(path);
            Assert.Null(store.Load());
            store.Save(new MatchState
            {
                MatchId = "m1",
                Phase = "Live",
                Round = 7,
                Score = new() { ["alpha"] = 4, ["bravo"] = 3 },
                RushFrontSlot = 4,
                RushDecided = null,
                Players = new() { new PlayerStats(A1, 5, 2, 1, 640) },
            });
            var back = store.Load()!;
            Assert.Equal(("m1", "Live", 7, 4, 4), (back.MatchId, back.Phase, back.Round, back.Score["alpha"], back.RushFrontSlot!.Value));
            Assert.Equal(640, back.Players.Single().Damage);
            Assert.False(File.Exists(path + ".tmp"));

            File.WriteAllText(path, "{ not json");
            var logs = new List<string>();
            Assert.Null(new FileMatchStateStore(path, logs.Add).Load());
            Assert.Single(logs);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }
}
