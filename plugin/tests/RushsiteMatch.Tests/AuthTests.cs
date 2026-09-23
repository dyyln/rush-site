using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class AuthTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();

    private MatchController New()
    {
        var m = new MatchController(Rush(), new MatchSettings { ConnectGrace = TimeSpan.FromSeconds(60) }, _game, _sink, _clock, _uploader);
        m.Start();
        return m;
    }

    private IEnumerable<string> Connected() => _sink.Events.OfType<PlayerConnected>().Select(e => e.SteamId);

    [Fact]
    public void AuthorizationAfterConnectFullCountsThePlayer()
    {
        var m = New();
        m.OnPlayerConnectFull(5, null, A1);
        Assert.Empty(Connected());
        Assert.True(m.OnClientAuthorized(A1, 5));
        Assert.Equal(new[] { A1 }, Connected());
        Assert.True(m.OnClientAuthorized(A1, 5));
        Assert.Equal(new[] { A1 }, Connected());
    }

    [Fact]
    public void AuthorizationBeforeConnectFullCountsAtConnectFull()
    {
        var m = New();
        Assert.True(m.OnClientAuthorized(A1, 5));
        Assert.Empty(Connected());
        m.OnPlayerConnectFull(5, A1, A1);
        Assert.Equal(new[] { A1 }, Connected());
    }

    [Fact]
    public void LateAuthorizedOutsiderIsKickedAndNotCounted()
    {
        var m = New();
        m.OnPlayerConnectFull(9, null, A1);
        Assert.False(m.OnClientAuthorized(Outsider, 9));
        Assert.Equal(9, Assert.Single(_game.Kicks).UserId);
        Assert.Empty(Connected());
    }

    [Fact]
    public void UnauthorizedPlayerOnTheServerIsNeverAbandoned()
    {
        var m = New();
        foreach (var id in new[] { A2, A3, B1, B2, B3 }) m.OnPlayerConnectFull(1, id, id);
        m.OnPlayerConnectFull(5, null, A1);
        _clock.Advance(600);
        m.Tick();
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        Assert.DoesNotContain("match_abandoned", _sink.Types);
        Assert.Contains(_game.Logs, l => l.Contains(A1) && l.Contains("not authorized yet"));

        m.OnClientAuthorized(A1, 5);
        Assert.Contains(A1, Connected());
    }

    [Fact]
    public void PlayerSeenOnTheServerIsLeftOutOfTheMissingList()
    {
        var m = New();
        foreach (var id in new[] { A2, A3, B1, B2 }) m.OnPlayerConnectFull(1, id, id);
        m.OnPlayerConnectFull(5, null, A1);
        _clock.Advance(60);
        m.Tick();
        var ab = _sink.Last<MatchAbandoned>();
        Assert.Equal("no_show", ab.Reason);
        Assert.Equal(new[] { B3 }, ab.MissingSteamIds);
    }

    [Fact]
    public void AuthorizedPlayerWhoseEventsWereMissedIsCountedOnTick()
    {
        var m = New();
        _game.Connected.Add(new ConnectedPlayer(A1, 5, Authorized: true));
        _game.Connected.Add(new ConnectedPlayer(B1, 6, Authorized: false));
        m.Tick();
        Assert.Equal(new[] { A1 }, Connected());
        Assert.Contains("connected 1/6", m.Status());
    }

    [Fact]
    public void UnauthorizedPlayerWhoLeavesCountsAsMissingAgain()
    {
        var m = New();
        foreach (var id in new[] { A2, A3, B1, B2, B3 }) m.OnPlayerConnectFull(1, id, id);
        m.OnPlayerConnectFull(5, null, A1);
        m.OnPlayerDisconnected(A1, 5);
        _clock.Advance(60);
        m.Tick();
        Assert.Equal(new[] { A1 }, _sink.Last<MatchAbandoned>().MissingSteamIds);
    }
}
