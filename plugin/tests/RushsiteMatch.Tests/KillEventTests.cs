using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class KillEventTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();

    private MatchController LiveRush()
    {
        var m = new MatchController(Rush(), new MatchSettings(), _game, _sink, _clock, _uploader);
        m.Start();
        foreach (var id in new[] { A1, A2, A3 })
        {
            m.OnPlayerConnected(id, 1);
            _game.Sides[id] = Side.CT;
            m.OnPlayerTeam(id, Side.CT);
        }
        foreach (var id in new[] { B1, B2, B3 })
        {
            m.OnPlayerConnected(id, 2);
            _game.Sides[id] = Side.T;
            m.OnPlayerTeam(id, Side.T);
        }
        m.OnRoundFreezeEnd(isWarmup: false);
        return m;
    }

    private static DeathInfo Death(string? attacker, string? victim, string? assister = null, string weapon = "ak47", bool hs = false, int pen = 0, int tick = 1000) =>
        new(attacker, victim, assister, weapon, hs, pen, tick);

    [Fact]
    public void KillJsonShape()
    {
        var body = MatchEventJson.SerializeBody(new Kill(2, 6400, A1, B1, "ak47", true, false) { Assister = A2 });
        Assert.Equal(
            "{\"event\":{\"type\":\"kill\",\"round\":2,\"tick\":6400,\"attacker\":\"76561198000000001\",\"victim\":\"76561198000000011\",\"weapon\":\"ak47\",\"headshot\":true,\"wallbang\":false,\"assister\":\"76561198000000002\"}}",
            body);
        var noAssist = MatchEventJson.SerializeBody(new Kill(1, 10, A1, B1, "awp", false, true));
        Assert.DoesNotContain("assister", noAssist);
        Assert.Contains("\"wallbang\":true", noAssist);
    }

    [Fact]
    public void KillsCarryTheirRoundAndStayInOrderWithRoundEnd()
    {
        var m = LiveRush();
        m.OnPlayerDeath(Death(A1, B1, assister: A2, hs: true, tick: 100));
        m.OnRoundEnd(Side.T, false, false);
        // Exit frag after the round ended still belongs to round 1
        m.OnPlayerDeath(Death(B2, A3, tick: 150));
        m.OnRoundStart();
        m.OnPlayerDeath(Death(B1, A1, weapon: "awp", pen: 1, tick: 300));
        m.OnRoundEnd(Side.CT, false, false);

        var types = _sink.Types.SkipWhile(t => t != "match_started").Skip(1).ToList();
        Assert.Equal(new[] { "kill", "round_end", "kill", "kill", "round_end" }, types);

        var kills = _sink.Events.OfType<Kill>().ToList();
        Assert.Equal(new[] { 1, 1, 2 }, kills.Select(k => k.Round));
        Assert.Equal(new[] { 100, 150, 300 }, kills.Select(k => k.Tick));
        Assert.Equal((A1, B1, A2, true, false), (kills[0].Attacker, kills[0].Victim, kills[0].Assister, kills[0].Headshot, kills[0].Wallbang));
        Assert.Equal(("awp", true), (kills[2].Weapon, kills[2].Wallbang));
        Assert.Null(kills[1].Assister);
    }

    [Fact]
    public void FreezeEndAlsoOpensTheNextRound()
    {
        var m = LiveRush();
        m.OnRoundEnd(Side.T, false, false);
        m.OnRoundFreezeEnd(isWarmup: false);
        m.OnPlayerDeath(Death(A1, B1));
        Assert.Equal(2, _sink.Last<Kill>().Round);
    }

    [Fact]
    public void SkipsSuicidesWorldDeathsOutsidersAndWarmup()
    {
        var m = new MatchController(Rush(), new MatchSettings(), _game, _sink, _clock, _uploader);
        m.Start();
        m.OnPlayerDeath(Death(A1, B1));
        Assert.Empty(_sink.Events.OfType<Kill>());

        m = LiveRush();
        m.OnPlayerDeath(Death(A1, A1));
        m.OnPlayerDeath(Death(null, B1));
        m.OnPlayerDeath(Death(Outsider, B1));
        m.OnPlayerDeath(Death(A1, null));
        Assert.Empty(_sink.Events.OfType<Kill>());
    }

    [Fact]
    public void KeepsTeamKillsAndCleansAssister()
    {
        var m = LiveRush();
        m.OnPlayerDeath(Death(A1, A2, assister: A1));
        m.OnPlayerDeath(Death(A1, B1, assister: Outsider, weapon: " "));
        var kills = _sink.Events.OfType<Kill>().ToList();
        Assert.Equal(2, kills.Count);
        Assert.Equal((A1, A2), (kills[0].Attacker, kills[0].Victim));
        Assert.All(kills, k => Assert.Null(k.Assister));
        Assert.Equal("unknown", kills[1].Weapon);
        // Team kill still gives no stat kill
        m.OnWinPanelMatch();
        Assert.Equal(1, _sink.Last<MatchEnd>().Players.Single(p => p.SteamId == A1).Kills);
    }

    [Fact]
    public void NoKillsAfterMatchEnd()
    {
        var m = LiveRush();
        m.OnWinPanelMatch();
        m.OnPlayerDeath(Death(A1, B1));
        Assert.Empty(_sink.Events.OfType<Kill>());
    }
}
