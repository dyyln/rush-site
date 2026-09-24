using RushsiteMatch.Core.Match;
using RushsiteMatch.Core.Stats;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class StatsAggregatorTests
{
    private static StatsAggregator New()
    {
        var cfg = Aim2v2();
        return new StatsAggregator(cfg.AllowedSteamIds, cfg.TeamOf);
    }

    [Fact]
    public void CountsKillsDeathsHeadshotsDamage()
    {
        var s = New();
        s.RecordDamage(A1, B1, 60);
        s.RecordDamage(A1, B1, 40);
        s.RecordDeath(A1, B1, headshot: true);
        s.RecordDeath(B2, A1, headshot: false);
        var a1 = s.Snapshot().Single(p => p.SteamId == A1);
        var b1 = s.Snapshot().Single(p => p.SteamId == B1);
        Assert.Equal((1, 1, 1, 100), (a1.Kills, a1.Deaths, a1.Headshots, a1.Damage));
        Assert.Equal((0, 1, 0, 0), (b1.Kills, b1.Deaths, b1.Headshots, b1.Damage));
    }

    [Fact]
    public void IgnoresTeamKillsSuicidesAndTeamDamage()
    {
        var s = New();
        s.RecordDeath(A1, A2, headshot: true);
        s.RecordDeath(A1, A1, headshot: false);
        s.RecordDeath(null, B1, headshot: false);
        s.RecordDamage(A1, A2, 50);
        s.RecordDamage(A1, A1, 20);
        var a1 = s.Snapshot().Single(p => p.SteamId == A1);
        Assert.Equal((0, 1, 0, 0), (a1.Kills, a1.Deaths, a1.Headshots, a1.Damage));
        Assert.Equal(1, s.Snapshot().Single(p => p.SteamId == A2).Deaths);
        Assert.Equal(1, s.Snapshot().Single(p => p.SteamId == B1).Deaths);
    }

    [Fact]
    public void IgnoresNonPlayersAndKeepsOrder()
    {
        var s = New();
        s.RecordDeath(Outsider, A1, true);
        s.RecordDamage(Outsider, A1, 99);
        s.RecordDamage(A1, null, 30);
        Assert.Equal(new[] { A1, A2, B1, B2 }, s.Snapshot().Select(p => p.SteamId));
        Assert.Equal(30, s.Snapshot()[0].Damage);
        s.Reset();
        Assert.All(s.Snapshot(), p => Assert.Equal(0, p.Kills + p.Deaths + p.Damage));
    }
}

public class PresenceTrackerTests
{
    [Fact]
    public void TracksNoShowsAndDepartures()
    {
        var t0 = DateTimeOffset.UnixEpoch;
        var p = new PresenceTracker(new[] { A1, B1 }, t0);
        Assert.True(p.Connect(A1));
        Assert.False(p.Connect(A1));
        Assert.False(p.Connect(Outsider));
        Assert.Empty(p.NoShows(t0.AddSeconds(59), TimeSpan.FromSeconds(60)));
        Assert.Equal(new[] { B1 }, p.NoShows(t0.AddSeconds(60), TimeSpan.FromSeconds(60)));

        p.Connect(B1);
        Assert.True(p.AllConnected);
        Assert.True(p.Disconnect(B1, t0.AddSeconds(100)));
        Assert.Empty(p.NoShows(t0.AddSeconds(500), TimeSpan.FromSeconds(60)));
        Assert.Empty(p.Departed(t0.AddSeconds(129), TimeSpan.FromSeconds(30)));
        Assert.Equal(new[] { B1 }, p.Departed(t0.AddSeconds(130), TimeSpan.FromSeconds(30)));
        p.Connect(B1);
        Assert.Empty(p.Departed(t0.AddSeconds(999), TimeSpan.FromSeconds(30)));
    }
}

public class SideMapTests
{
    [Fact]
    public void DefaultsAndClaims()
    {
        var m = new SideMap(Aim2v2());
        Assert.Equal(Side.CT, m.RequiredSide(A1));
        Assert.Equal(Side.T, m.RequiredSide(B1));

        m.SetPlayerSide(B1, Side.CT);
        Assert.Equal(Side.CT, m.RequiredSide(B2));
        Assert.Equal(Side.T, m.RequiredSide(A1));
        Assert.False(m.IsJoinAllowed(A1, Side.CT));
        Assert.True(m.IsJoinAllowed(A1, Side.T));
        Assert.True(m.IsJoinAllowed(A1, Side.Spectator));
        Assert.Equal("bravo", m.TeamOnSide(Side.CT));
        Assert.Equal("alpha", m.TeamOnSide(Side.T));
    }

    [Fact]
    public void TeamsValid()
    {
        var m = new SideMap(Aim2v2());
        var all = new[] { A1, A2, B1, B2 };
        m.SetPlayerSide(A1, Side.CT);
        m.SetPlayerSide(A2, Side.CT);
        m.SetPlayerSide(B1, Side.T);
        Assert.False(m.TeamsAreValid(all));
        m.SetPlayerSide(B2, Side.CT);
        Assert.False(m.TeamsAreValid(all));
        m.SetPlayerSide(B2, Side.T);
        Assert.True(m.TeamsAreValid(all));
    }

    [Fact]
    public void FollowsHalftimeSwap()
    {
        var m = new SideMap(Aim1v1());
        m.SetPlayerSide(A1, Side.CT);
        m.SetPlayerSide(B1, Side.T);
        Assert.Equal("alpha", m.TeamOnSide(Side.CT));
        m.SetPlayerSide(A1, Side.T);
        m.SetPlayerSide(B1, Side.CT);
        Assert.Equal("alpha", m.TeamOnSide(Side.T));
    }

    [Fact]
    public void OnePlayerOnTheWrongSideDoesNotFlipTheTeam()
    {
        var m = new SideMap(Aim2v2());
        m.SetPlayerSide(A1, Side.CT);
        m.SetPlayerSide(A2, Side.CT);
        m.SetPlayerSide(B1, Side.T);
        m.SetPlayerSide(A2, Side.T);
        Assert.Equal("alpha", m.TeamOnSide(Side.CT));
        Assert.Equal("bravo", m.TeamOnSide(Side.T));
    }

    [Fact]
    public void FixedModeIgnoresWherePlayersStand()
    {
        var m = new SideMap(Rush(), fixedFromConfig: true);
        Assert.Equal("alpha", m.TeamOnSide(Side.CT));
        foreach (var id in new[] { A1, A2, A3 }) m.SetPlayerSide(id, Side.T);
        foreach (var id in new[] { B1, B2, B3 }) m.SetPlayerSide(id, Side.CT);
        Assert.Equal("alpha", m.TeamOnSide(Side.CT));
        Assert.Equal("bravo", m.TeamOnSide(Side.T));
        Assert.Equal(Side.CT, m.RequiredSide(A1));
        Assert.False(m.IsOnRequiredSide(A1));
        Assert.False(m.TeamsAreValid(Rush().AllowedSteamIds));
        foreach (var id in new[] { A1, A2, A3 }) m.SetPlayerSide(id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) m.SetPlayerSide(id, Side.T);
        Assert.True(m.TeamsAreValid(Rush().AllowedSteamIds));
    }
}

public class ScoreTrackerTests
{
    [Fact]
    public void FirstTo16()
    {
        var t = new FirstToScoreTracker(16, new[] { "alpha", "bravo" });
        for (var i = 0; i < 15; i++)
        {
            Assert.Null(t.RecordRound("alpha"));
            Assert.Null(t.RecordRound("bravo"));
        }
        Assert.Equal("bravo", t.RecordRound("bravo"));
        Assert.Null(t.RecordRound("alpha"));
        Assert.Equal(16, t.Wins["bravo"]);
        Assert.Equal(15, t.Wins["alpha"]);
    }

    [Fact]
    public void DrawRoundsCountTowardTheRoundCapAndTheLeaderWins()
    {
        var t = new FirstToScoreTracker(2, new[] { "alpha", "bravo" });
        Assert.Null(t.RecordRound("alpha"));
        Assert.Null(t.RecordRound(null));
        Assert.Equal("alpha", t.RecordRound(null));
        Assert.True(t.IsOver);
    }

    [Fact]
    public void TiedRegulationWithoutOvertimeEndsTied()
    {
        var t = new FirstToScoreTracker(2, new[] { "alpha", "bravo" });
        t.RecordRound("alpha");
        t.RecordRound("bravo");
        Assert.Null(t.RecordRound(null));
        Assert.True(t.EndedTied);
        Assert.True(t.IsOver);
        Assert.Null(t.RecordRound("alpha"));
        Assert.Equal(3, t.RoundsPlayed);
    }

    [Fact]
    public void OvertimeClinchesAtHalfPlusOne()
    {
        var t = new FirstToScoreTracker(13, new[] { "alpha", "bravo" }, overtimeMaxRounds: 6);
        for (var i = 0; i < 12; i++)
        {
            t.RecordRound("alpha");
            t.RecordRound("bravo");
        }
        Assert.Null(t.RecordRound(null));
        Assert.True(t.InOvertime);
        Assert.Equal(12, t.OvertimeBase);
        Assert.False(t.IsOver);
        for (var i = 0; i < 3; i++) Assert.Null(t.RecordRound("alpha"));
        Assert.Equal("alpha", t.RecordRound("alpha"));
        Assert.Equal(16, t.Wins["alpha"]);
    }

    [Fact]
    public void TiedOvertimePeriodStartsAnother()
    {
        var t = new FirstToScoreTracker(2, new[] { "alpha", "bravo" }, overtimeMaxRounds: 2);
        t.RecordRound("alpha");
        t.RecordRound("bravo");
        t.RecordRound(null);
        Assert.Equal(1, t.OvertimeBase);
        t.RecordRound("alpha");
        Assert.Null(t.RecordRound("bravo"));
        Assert.Equal(2, t.OvertimeBase);
        Assert.Equal(5, t.OvertimePeriodStart);
        t.RecordRound("bravo");
        Assert.Equal("bravo", t.RecordRound(null));
    }

    [Fact]
    public void OvertimeStateSurvivesRestore()
    {
        var t = new FirstToScoreTracker(2, new[] { "alpha", "bravo" }, overtimeMaxRounds: 4);
        t.RecordRound("alpha");
        t.RecordRound("bravo");
        t.RecordRound(null);
        t.RecordRound("alpha");
        var r = new FirstToScoreTracker(2, new[] { "alpha", "bravo" }, overtimeMaxRounds: 4);
        r.Restore(t.Wins, t.RoundsPlayed, t.OvertimeBase, t.OvertimePeriodStart);
        Assert.True(r.InOvertime);
        Assert.Null(r.RecordRound("bravo"));
        Assert.Null(r.RecordRound("alpha"));
        Assert.Equal("alpha", r.RecordRound("alpha"));
    }

    [Fact]
    public void RushCastleWinAfterFourStraight()
    {
        var t = new RushScoreTracker();
        Assert.Equal(3, t.FrontSlot);
        Assert.Null(t.RecordRound(Side.T));
        Assert.Null(t.RecordRound(Side.T));
        Assert.Null(t.RecordRound(Side.T));
        Assert.Equal(6, t.FrontSlot);
        Assert.Equal(Side.T, t.RecordRound(Side.T));
        Assert.Equal(4, t.Wins[Side.T]);
    }

    [Fact]
    public void RushCtCastleWin()
    {
        var t = new RushScoreTracker();
        Side?[] results = { t.RecordRound(Side.CT), t.RecordRound(Side.T), t.RecordRound(Side.CT), t.RecordRound(Side.CT), t.RecordRound(Side.CT) };
        Assert.All(results, r => Assert.Null(r));
        Assert.Equal(0, t.FrontSlot);
        Assert.Equal(Side.CT, t.RecordRound(Side.CT));
    }

    [Fact]
    public void RushEightWinsViaDecider()
    {
        var t = new RushScoreTracker();
        for (var i = 0; i < 7; i++)
        {
            Assert.Null(t.RecordRound(Side.T));
            Assert.Null(t.RecordRound(Side.CT));
        }
        Assert.True(t.NextIsDecider);
        Assert.Equal(3, t.FrontSlot);
        Assert.Equal(Side.CT, t.RecordRound(Side.CT));
        Assert.Equal(15, t.RoundsPlayed);
    }

    [Fact]
    public void RushIgnoresRoundsAfterDecision()
    {
        var t = new RushScoreTracker();
        for (var i = 0; i < 4; i++) t.RecordRound(Side.T);
        Assert.Null(t.RecordRound(Side.CT));
        Assert.Equal(0, t.Wins[Side.CT]);
    }
}

public class RushArenaTests
{
    [Theory]
    [InlineData("t1room.101", "101")]
    [InlineData("t1room.convoy", "convoy")]
    [InlineData("t1room.", null)]
    [InlineData("ant.base.101", null)]
    [InlineData(null, null)]
    public void ParsesRoomTarget(string? name, string? expected) =>
        Assert.Equal(expected, RushArena.RoomIdFromTargetName(name));

    [Fact]
    public void PicksNearestRoomByMajority()
    {
        var rooms = new List<(string, Vec3)> { ("101", new Vec3(0, 0, 0)), ("203", new Vec3(1000, 0, 0)), ("401", new Vec3(0, 2000, 0)) };
        var ts = new List<Vec3> { new(900, 50, 0), new(1100, -30, 0), new(10, 10, 0) };
        Assert.Equal("203", RushArena.Detect(ts, rooms));
        Assert.Null(RushArena.Detect(new List<Vec3>(), rooms));
        Assert.Null(RushArena.Detect(ts, new List<(string, Vec3)>()));
    }
}
