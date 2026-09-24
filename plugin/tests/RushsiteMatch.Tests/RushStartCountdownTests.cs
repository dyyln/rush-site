using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

// Valve's Rush warmup waits for the mode's 6 players. The plugin ends it with the aim start countdown.
public class RushStartCountdownTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();

    private const string Applied = "401,203,207,102,211,205,301";

    private static MatchConfig WithRooms(string mode, int teamSize) =>
        MatchConfigLoader.Parse(Json(mode, "valve_rush", teamSize).Replace("\"winCondition\"", "\"rushRooms\": [203, 207, 102, 211, 205],\"winCondition\""));

    private MatchController New(MatchConfig cfg)
    {
        var m = new MatchController(cfg, new MatchSettings { StartCountdown = TimeSpan.FromSeconds(10) }, _game, _sink, _clock, _uploader);
        m.Start();
        return m;
    }

    private void Join(MatchController m, string id, Side side, int uid)
    {
        m.OnPlayerConnected(id, uid);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    private void JoinAll(MatchController m, int teamSize)
    {
        var uid = 1;
        foreach (var id in new[] { A1, A2, A3 }.Take(teamSize)) Join(m, id, Side.CT, uid++);
        foreach (var id in new[] { B1, B2, B3 }.Take(teamSize)) Join(m, id, Side.T, uid++);
    }

    private void Wait(MatchController m, double seconds)
    {
        _clock.Advance(seconds);
        m.Tick();
    }

    private int WarmupEnds => _game.Commands.Count(c => c == "mp_warmup_end");

    [Theory]
    [InlineData("rush1v1", 1)]
    [InlineData("rush2v2", 2)]
    [InlineData("rush3v3", 3)]
    public void CompleteLineupRunsTheCountdownThenEndsWarmup(string mode, int teamSize)
    {
        var m = New(MatchConfigLoader.Parse(Json(mode, "valve_rush", teamSize)));
        Assert.Contains("mp_warmup_pausetimer 1", _game.Commands);
        JoinAll(m, teamSize);
        Assert.True(m.CountdownRunning);
        Assert.Contains(_game.Chat, c => c.Contains("All players are in. The match starts in 10 seconds"));
        Assert.Contains("The match starts in 10", _game.Center);

        Wait(m, 5);
        Assert.Contains(_game.Chat, c => c.Contains("The match starts in 5"));
        Assert.Contains("The match starts in 5", _game.Center);
        Wait(m, 4);
        Assert.Equal(0, WarmupEnds);
        Assert.DoesNotContain("mp_warmup_pausetimer 0", _game.Commands);

        Wait(m, 1);
        Assert.False(m.CountdownRunning);
        var i = _game.Commands.IndexOf("mp_warmup_pausetimer 0");
        Assert.True(i >= 0);
        Assert.True(_game.Commands.IndexOf("mp_warmup_end") > i);
        Assert.Contains(_game.Commands, c => c.StartsWith("tv_record"));
        // Valve's start signal still moves the match to live.
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        Assert.DoesNotContain("match_started", _sink.Types);

        // No second end and no new hold in the gap before Valve starts the match.
        _game.Commands.Clear();
        Wait(m, 3);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("mp_warmup"));

        m.OnRushMatchLive();
        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.Equal("match_started", _sink.Types.Last());
        Wait(m, 30);
        Assert.Equal(0, WarmupEnds);
    }

    [Theory]
    [InlineData("rush1v1", 1)]
    [InlineData("rush2v2", 2)]
    [InlineData("rush3v3", 3)]
    public void LeavingOrSwitchingSideCancelsTheCountdown(string mode, int teamSize)
    {
        var m = New(MatchConfigLoader.Parse(Json(mode, "valve_rush", teamSize)));
        JoinAll(m, teamSize);
        Assert.True(m.CountdownRunning);

        Wait(m, 6);
        m.OnPlayerDisconnected(B1);
        Assert.False(m.CountdownRunning);
        Assert.Contains(_game.Chat, c => c.Contains("Countdown stopped"));
        Wait(m, 30);
        Assert.Equal(0, WarmupEnds);
        Assert.Equal(MatchPhase.Warmup, m.Phase);

        Join(m, B1, Side.T, 20);
        Assert.True(m.CountdownRunning);
        Wait(m, 6);
        _game.Sides[A1] = Side.Spectator;
        m.OnPlayerTeam(A1, Side.Spectator);
        Assert.False(m.CountdownRunning);
        Wait(m, 30);
        Assert.Equal(0, WarmupEnds);

        _game.Sides[A1] = Side.CT;
        m.OnPlayerTeam(A1, Side.CT);
        Assert.True(m.CountdownRunning);
        Wait(m, 10);
        Assert.Equal(1, WarmupEnds);
    }

    [Theory]
    [InlineData("rush1v1", 1)]
    [InlineData("rush2v2", 2)]
    [InlineData("rush3v3", 3)]
    public void RoomsAreSentAndConfirmedBeforeWarmupEnds(string mode, int teamSize)
    {
        var m = New(WithRooms(mode, teamSize));
        var sent = _game.Commands.FindIndex(c => c.StartsWith("say rushsite_rooms"));
        Assert.True(sent >= 0);
        JoinAll(m, teamSize);
        Assert.True(m.CountdownRunning);

        // The script has not answered yet, so the countdown waits at zero.
        _clock.Advance(4.5);
        m.Tick();
        _clock.Advance(0.5);
        m.OnRushRoomsApplied(Applied);
        Wait(m, 5);
        var end = _game.Commands.IndexOf("mp_warmup_end");
        Assert.True(end > sent);
        Assert.Equal(1, _game.Commands.Count(c => c.StartsWith("say rushsite_rooms")));
        m.OnRushMatchLive();
        Assert.True(_sink.Last<MatchStarted>().RushRoomsConfirmed);
    }

    [Fact]
    public void CountdownWaitsForTheRoomReplyThenEnds()
    {
        var m = New(WithRooms("rush1v1", 1));
        JoinAll(m, 1);
        Wait(m, 3);
        Wait(m, 7);
        // Countdown is done but the script has not answered.
        Assert.Equal(0, WarmupEnds);
        Assert.Contains(_game.Chat, c => c.Contains("Loading the rooms"));

        m.OnRushRoomsApplied(Applied);
        Assert.Equal(1, WarmupEnds);
        Assert.True(_game.Commands.FindLastIndex(c => c.StartsWith("say rushsite_rooms")) < _game.Commands.IndexOf("mp_warmup_end"));
    }

    [Fact]
    public void FailedRoomsDoNotBlockTheStart()
    {
        var m = New(WithRooms("rush1v1", 1));
        JoinAll(m, 1);
        Wait(m, 5);
        Wait(m, 4.9);
        Assert.Equal(0, WarmupEnds);
        // The resend went out at 5 s. No reply by 10 s reports no_reply and the match goes ahead on Valve's draw.
        Wait(m, 0.1);
        Assert.Equal("no_reply", _sink.Events.OfType<RushRoomsFailed>().Single().Reason);
        Assert.Equal(1, WarmupEnds);
    }

    [Fact]
    public void ValvesOwnWarmupEndStillGoesLiveAndClosesTheCountdown()
    {
        var m = New(MatchConfigLoader.Parse(Json("rush1v1", "valve_rush", 1)));
        JoinAll(m, 1);
        Assert.True(m.CountdownRunning);
        m.OnRoundFreezeEnd(isWarmup: false);
        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.False(m.CountdownRunning);
        Wait(m, 30);
        Assert.Equal(0, WarmupEnds);
    }
}
