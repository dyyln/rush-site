using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class RushTeamTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();

    private MatchController New(MatchConfig? cfg = null, MatchSettings? settings = null)
    {
        var m = new MatchController(cfg ?? Rush(), settings ?? new MatchSettings(), _game, _sink, _clock, _uploader);
        m.Start();
        return m;
    }

    private void Join(MatchController m, string id, Side side, int uid = 1)
    {
        m.OnPlayerConnected(id, uid);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    private void JoinAll(MatchController m)
    {
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
    }

    [Fact]
    public void FirstTeamIsCtAndSecondIsTByDefault()
    {
        var m = New();
        Assert.True(m.OnJoinTeamRequest(A1, Side.CT));
        Assert.True(m.OnJoinTeamRequest(B1, Side.T));
        Assert.False(m.OnJoinTeamRequest(A1, Side.T));
        Assert.False(m.OnJoinTeamRequest(B1, Side.CT));
        Assert.Equal(new[] { (A1, Side.CT), (B1, Side.T) }, _game.ForcedJoins);
        Assert.Contains(_game.Chat, c => c.StartsWith(A1) && c.Contains("plays CT"));
    }

    [Fact]
    public void TeamSideFieldOverridesTheDefault()
    {
        var json = Json().Replace("{ \"name\": \"alpha\",", "{ \"name\": \"alpha\", \"side\": \"t\",");
        var m = New(MatchConfigLoader.Parse(json));
        Assert.True(m.OnJoinTeamRequest(A1, Side.T));
        Assert.True(m.OnJoinTeamRequest(B1, Side.CT));
        Assert.False(m.OnJoinTeamRequest(A1, Side.CT));
        Assert.Equal((A1, Side.T), Assert.Single(_game.ForcedJoins));
    }

    [Fact]
    public void WrongJoinsAreRedirectedThenKickedAfterTheLimit()
    {
        var m = New(settings: new MatchSettings { TeamJoinRefusalsBeforeKick = 3 });
        Assert.False(m.OnJoinTeamRequest(A1, Side.T));
        Assert.False(m.OnJoinTeamRequest(A1, Side.Spectator));
        Assert.Empty(_game.SteamKicks);
        Assert.Equal(2, _game.ForcedJoins.Count);
        Assert.False(m.OnJoinTeamRequest(A1, Side.T));
        var kick = Assert.Single(_game.SteamKicks);
        Assert.Equal(A1, kick.SteamId);
        Assert.Contains("Your team plays CT", kick.Reason);
        // A kick is not followed by another forced join.
        Assert.Equal(2, _game.ForcedJoins.Count);
    }

    [Fact]
    public void AutoSelectIsRedirectedAndNeverCountsTowardAKick()
    {
        var m = New(settings: new MatchSettings { TeamJoinRefusalsBeforeKick = 2 });
        for (var i = 0; i < 5; i++) Assert.False(m.OnJoinTeamRequest(B2, Side.None));
        Assert.Empty(_game.SteamKicks);
        Assert.All(_game.ForcedJoins, f => Assert.Equal((B2, Side.T), f));
    }

    [Fact]
    public void OnlyTeamSizePlayersFitOnASide()
    {
        var m = New();
        _game.Sides[A1] = Side.CT;
        _game.Sides[A2] = Side.CT;
        _game.Sides[Outsider] = Side.CT;
        Assert.False(m.OnJoinTeamRequest(A3, Side.CT));
        Assert.Contains(_game.Chat, c => c.Contains("CT is full"));
        // An opponent standing on the side is being sent back and does not take a slot.
        _game.Sides.Remove(Outsider);
        _game.Sides[B1] = Side.CT;
        Assert.True(m.OnJoinTeamRequest(A3, Side.CT));
    }

    [Fact]
    public void GameAssignmentToTheWrongSideIsSentBackAndCapped()
    {
        var m = New();
        m.OnPlayerConnected(B1, 4);
        for (var i = 0; i < MatchController.MaxForcedMovesPerPlayer + 3; i++) m.OnPlayerTeam(B1, Side.CT);
        Assert.Equal(MatchController.MaxForcedMovesPerPlayer, _game.ForcedJoins.Count);
        Assert.All(_game.ForcedJoins, f => Assert.Equal((B1, Side.T), f));
        Assert.Contains(_game.Logs, l => l.Contains("Something else is assigning teams"));
    }

    [Fact]
    public void WrongSidePlayerIsNotReadyAndWarmupHoldsUntilLineupIsComplete()
    {
        var m = New();
        Assert.Contains("mp_warmup_pausetimer 1", _game.Commands);
        foreach (var id in new[] { A1, A2 }) Join(m, id, Side.CT);
        Join(m, A3, Side.T);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);

        Assert.Equal(new[] { A3 }, m.RushNotReady());
        Assert.Equal(new[] { A3 }, m.WrongSidePlayers());
        m.Tick();
        Assert.DoesNotContain("mp_warmup_pausetimer 0", _game.Commands);
        Assert.Contains("lineup 5/6", m.Status());
        Assert.Contains(A3, m.Status());
        Assert.Contains(_game.Chat, c => c.StartsWith(A3) && c.Contains("not ready"));

        _game.Sides[A3] = Side.CT;
        m.Tick();
        Assert.Empty(m.RushNotReady());
        Assert.Contains("mp_warmup_pausetimer 0", _game.Commands);
        Assert.Contains(_game.Chat, c => c.Contains("All players are in and on their side"));

        m.OnRushMatchLive();
        Assert.Equal(MatchPhase.Live, m.Phase);
    }

    [Fact]
    public void MissingPlayerIsNotReadyAndHoldIsReassertedWhenACfgClearsIt()
    {
        var m = New();
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2 }) Join(m, id, Side.T);
        Assert.Equal(new[] { B3 }, m.RushNotReady());
        Assert.Empty(m.WrongSidePlayers());

        _game.Commands.Clear();
        _game.ConVars["mp_warmup_pausetimer"] = "0";
        m.Tick();
        Assert.Equal(new[] { "mp_warmup_pausetimer 1" }, _game.Commands);
    }

    [Fact]
    public void WarmupHoldCanBeTurnedOff()
    {
        var m = New(settings: new MatchSettings { HoldRushWarmup = false });
        JoinAll(m);
        m.Tick();
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("mp_warmup"));
    }

    [Fact]
    public void ScoreFollowsConfigSidesNeverWhereOnePlayerStands()
    {
        var m = New();
        JoinAll(m);
        m.OnRoundFreezeEnd(isWarmup: false);

        // One alpha player shows up on T. The old last-writer rule would have flipped alpha to T.
        _game.Sides[A1] = Side.T;
        m.OnPlayerTeam(A1, Side.T);
        m.OnRoundEnd(Side.CT, false, false);
        Assert.Equal("alpha", _sink.Last<RoundEnd>().WinnerTeam);
        Assert.Contains(_game.Logs, l => l.Contains("off their configured side"));
    }

    [Fact]
    public void MappingStaysFixedAcrossAHalftimeLikeSwap()
    {
        // Rush runs mp_halftime 0. Even if every player were swapped the config mapping holds.
        var m = New();
        JoinAll(m);
        m.OnRoundFreezeEnd(isWarmup: false);
        m.OnRoundEnd(Side.CT, false, false);
        foreach (var id in new[] { A1, A2, A3 }) _game.Sides[id] = Side.T;
        foreach (var id in new[] { B1, B2, B3 }) _game.Sides[id] = Side.CT;
        m.OnRoundEnd(Side.CT, false, false);
        m.OnRoundEnd(Side.T, false, false);
        var rounds = _sink.Events.OfType<RoundEnd>().Select(r => r.WinnerTeam).ToList();
        Assert.Equal(new[] { "alpha", "alpha", "bravo" }, rounds);
        Assert.Equal(2, m.Score["alpha"]);
        Assert.Equal(1, m.Score["bravo"]);
    }

    [Fact]
    public void LiveSpectatorRequestIsRedirected()
    {
        var m = New();
        JoinAll(m);
        m.OnRushMatchLive();
        Assert.False(m.OnJoinTeamRequest(B2, Side.Spectator));
        Assert.Equal((B2, Side.T), _game.ForcedJoins.Last());
    }

    [Fact]
    public void NoEnforcementAfterTheMatchEnds()
    {
        var m = New();
        JoinAll(m);
        m.OnRushMatchLive();
        m.OnWinPanelMatch();
        _game.ForcedJoins.Clear();
        Assert.True(m.OnJoinTeamRequest(A1, Side.T));
        m.OnPlayerTeam(A1, Side.T);
        Assert.Empty(_game.ForcedJoins);
    }

    [Fact]
    public void OutsidersAreLeftToTheWhitelistKick()
    {
        var m = New();
        Assert.True(m.OnJoinTeamRequest(Outsider, Side.CT));
        Assert.Empty(_game.ForcedJoins);
    }
}
