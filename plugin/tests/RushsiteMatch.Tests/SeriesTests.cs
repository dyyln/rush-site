using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class SeriesTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();
    private readonly MemoryStateStore _store = new();

    private static readonly MatchSettings Fast = new()
    {
        StartCountdown = TimeSpan.Zero,
        SeriesMapBreak = TimeSpan.FromSeconds(30),
        MatchEndWait = TimeSpan.FromSeconds(10),
    };

    private MatchController New(MatchConfig cfg, MatchSettings? s = null)
    {
        var m = new MatchController(cfg, s ?? Fast, _game, _sink, _clock, _uploader, _store);
        m.Start();
        return m;
    }

    private void Join(MatchController m, string id, Side side)
    {
        _game.Connected.RemoveAll(p => p.SteamId == id);
        _game.Connected.Add(new ConnectedPlayer(id, 1, true));
        m.OnPlayerConnected(id, 1);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    private void WinAimMap(MatchController m, Side winner)
    {
        for (var i = 0; i < 13; i++) m.OnRoundEnd(winner, false, false);
        m.OnWinPanelMatch();
    }

    // Ends the map, waits out the demo stop and the break, and brings the next map up.
    private void NextMap(MatchController m)
    {
        _clock.Advance(5);
        m.Tick();
        _clock.Advance(30);
        m.Tick();
        m.OnMapStart();
    }

    [Fact]
    public void AimBo3PlaysEachMapOnTheSameServerAndEndsAtTwoWins()
    {
        var m = New(AimBo3());
        Assert.Equal(1, m.MapNumber);
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.Equal(1, _sink.Last<MatchStarted>().MapNumber);
        Assert.Contains("tv_record \"rushsite_5f0c7a3e-1b2c-4d5e-8f90-1234567890ab_m1\"", _game.Commands);

        m.OnPlayerHurt(A1, B1, 100);
        m.OnPlayerDeath(new DeathInfo(A1, B1, null, "ak47", true, 0, 10));
        Assert.Equal(1, _sink.Last<Kill>().MapNumber);
        WinAimMap(m, Side.CT);
        Assert.Equal(1, _sink.Last<RoundEnd>().MapNumber);

        Assert.Equal(MatchPhase.BetweenMaps, m.Phase);
        var map1 = _sink.Last<MapEnd>();
        Assert.Equal((1, "aim_map", "alpha", 13), (map1.MapNumber, map1.MapId, map1.WinnerTeam, map1.Score["alpha"]));
        Assert.Equal(1, map1.Players.Single(p => p.SteamId == A1).Kills);
        Assert.DoesNotContain("match_end", _sink.Types);
        Assert.Empty(_game.SteamKicks);

        _clock.Advance(5);
        m.Tick();
        Assert.Contains("tv_stoprecord", _game.Commands);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("host_workshop_map"));
        _clock.Advance(30);
        m.Tick();
        Assert.Contains("host_workshop_map 3299812021", _game.Commands);
        Assert.Equal(2, m.MapNumber);
        Assert.Equal(new[] { A1, B1 }, _sink.Events.OfType<PlayerDisconnected>().Select(e => e.SteamId));

        // Connects before the new map is up are ignored and counted once it is.
        m.OnPlayerConnected(A1, 1);
        Assert.Equal(1, _sink.Events.OfType<PlayerConnected>().Count(e => e.SteamId == A1));
        _game.Commands.Clear();
        m.OnMapStart();
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        Assert.Equal("exec rushsite/matches/5f0c7a3e-1b2c-4d5e-8f90-1234567890ab/mode.cfg", _game.Commands.First(c => c.StartsWith("exec")));
        Assert.Contains("mp_ct_default_secondary \"weapon_usp_silencer\"", _game.Commands);
        Assert.Equal(0, m.Round);

        _game.Sides.Clear();
        Join(m, A1, Side.T);
        Join(m, B1, Side.CT);
        Assert.Equal(2, _sink.Events.OfType<PlayerConnected>().Count(e => e.SteamId == A1));
        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.Equal(2, _sink.Last<MatchStarted>().MapNumber);
        WinAimMap(m, Side.T);
        // Rounds restart at 1 on each map.
        Assert.Equal(13, _sink.Last<RoundEnd>().Round);
        Assert.Equal(2, _sink.Last<RoundEnd>().MapNumber);

        Assert.Equal(MatchPhase.Ended, m.Phase);
        var ends = _sink.Events.OfType<MapEnd>().ToList();
        Assert.Equal(new[] { 1, 2 }, ends.Select(e => e.MapNumber));
        var end = _sink.Last<MatchEnd>();
        Assert.Equal("alpha", end.WinnerTeam);
        Assert.Equal(2, end.Score["alpha"]);
        Assert.Equal(0, end.Score["bravo"]);
        Assert.Equal(new[] { "aim_map", "aim_usp" }, end.Maps!.Select(x => x.MapId));
        Assert.Equal(1, end.Players.Single(p => p.SteamId == A1).Kills);
        Assert.Equal("match_end", _sink.Types.Last());
        Assert.NotEmpty(_game.SteamKicks);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("changelevel"));
    }

    [Fact]
    public async Task EachMapUploadsItsOwnDemo()
    {
        var m = New(AimBo3());
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.CT);
        _clock.Advance(5);
        m.Tick();
        await m.UploadTask!;
        var d1 = _sink.Last<DemoUploaded>();
        Assert.Equal(1, d1.MapNumber);
        Assert.Equal(("/srv/cs2/game/csgo/rushsite_5f0c7a3e-1b2c-4d5e-8f90-1234567890ab_m1.dem", "https://s3.example/m1"), _uploader.Calls[0]);

        _clock.Advance(30);
        m.Tick();
        m.OnMapStart();
        _game.Sides.Clear();
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.T);
        _clock.Advance(5);
        m.Tick();
        await m.UploadTask!;
        Assert.Equal(2, _sink.Last<DemoUploaded>().MapNumber);
        Assert.Equal(("/srv/cs2/game/csgo/rushsite_5f0c7a3e-1b2c-4d5e-8f90-1234567890ab_m2.dem", "https://s3.example/m2"), _uploader.Calls[1]);
        Assert.Equal(MatchPhase.BetweenMaps, m.Phase);
    }

    [Fact]
    public void ThirdMapDecidesAOneAllSeries()
    {
        var m = New(AimBo3());
        foreach (var winner in new[] { Side.CT, Side.T })
        {
            _game.Sides.Clear();
            Join(m, A1, Side.CT);
            Join(m, B1, Side.T);
            WinAimMap(m, winner);
            NextMap(m);
        }
        Assert.Contains("changelevel awp_india", _game.Commands);
        Assert.Equal(3, m.MapNumber);
        _game.Sides.Clear();
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.T);
        Assert.Equal(3, _sink.Events.OfType<MapEnd>().Count());
        var end = _sink.Last<MatchEnd>();
        Assert.Equal("bravo", end.WinnerTeam);
        Assert.Equal((1, 2), (end.Score["alpha"], end.Score["bravo"]));
    }

    [Fact]
    public void ResumedSeriesStartsOnItsMapWithPriorWins()
    {
        var json = WithSeries(Json("aim1v1", "first_to_13", 1), SeriesJson.Replace("\"startMapNumber\": 1", "\"startMapNumber\": 2")
            .Replace("\"alpha\": 0", "\"alpha\": 1"));
        var m = New(MatchConfigLoader.Parse(json));
        Assert.Equal(2, m.MapNumber);
        Assert.Equal("aim_usp", m.CurrentMapId);
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.CT);
        Assert.Equal(MatchPhase.Ended, m.Phase);
        Assert.Equal(2, _sink.Last<MapEnd>().MapNumber);
        Assert.Equal(2, _sink.Last<MatchEnd>().Score["alpha"]);
    }

    [Fact]
    public void AbandonBetweenMapsEndsTheSeries()
    {
        var m = New(AimBo3(), new MatchSettings { StartCountdown = TimeSpan.Zero, DisconnectGrace = TimeSpan.FromSeconds(60) });
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.CT);
        _clock.Advance(40);
        m.Tick();
        m.OnMapStart();
        _game.Connected.RemoveAll(p => p.SteamId == B1);
        Join(m, A1, Side.CT);
        _clock.Advance(60);
        m.Tick();
        Assert.Equal(MatchPhase.Abandoned, m.Phase);
        Assert.Equal(new[] { B1 }, _sink.Last<MatchAbandoned>().MissingSteamIds);
        Assert.DoesNotContain("match_end", _sink.Types);
    }

    [Fact]
    public void MapThatNeverLoadsAbandons()
    {
        var m = New(AimBo3(), new MatchSettings { StartCountdown = TimeSpan.Zero, MapLoadTimeout = TimeSpan.FromSeconds(120) });
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.CT);
        _clock.Advance(40);
        m.Tick();
        _clock.Advance(119);
        m.Tick();
        Assert.Equal(MatchPhase.BetweenMaps, m.Phase);
        _clock.Advance(1);
        m.Tick();
        Assert.Equal("map_load_failed", _sink.Last<MatchAbandoned>().Reason);
    }

    [Fact]
    public void RushBo3KeepsValveRulesAndReloadsRush()
    {
        var m = New(RushBo3());
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
        Assert.Contains("tv_record \"rushsite_5f0c7a3e-1b2c-4d5e-8f90-1234567890ab_m1\"", _game.Commands);
        m.OnRoundFreezeEnd(isWarmup: false);
        for (var i = 0; i < 4; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();
        Assert.Equal("alpha", _sink.Last<MapEnd>().WinnerTeam);
        NextMap(m);
        Assert.Contains("changelevel rush_001", _game.Commands);
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("mp_maxrounds") || c.StartsWith("mp_overtime") || c.StartsWith("mp_respawn_immunitytime"));
        Assert.Contains("mp_warmup_pausetimer 1", _game.Commands);
    }

    [Fact]
    public void DrawnRushMapCreditsNobodyAndIsReportedAsDraw()
    {
        var m = New(RushBo3());
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
        m.OnRoundFreezeEnd(isWarmup: false);
        for (var i = 0; i < 7; i++)
        {
            m.OnRoundEnd(Side.CT, false, false);
            m.OnRoundEnd(Side.T, false, false);
        }
        m.OnRoundEnd(Side.None, false, false);
        _clock.Advance(10);
        m.Tick();
        Assert.Equal("draw", _sink.Last<MapEnd>().WinnerTeam);
        Assert.Equal(MatchPhase.BetweenMaps, m.Phase);
        Assert.Equal(0, m.SeriesWins!["alpha"] + m.SeriesWins["bravo"]);
    }

    [Fact]
    public void RestoreBetweenMapsLoadsTheNextMap()
    {
        var m = New(AimBo3());
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.CT);
        var saved = _store.State!;
        Assert.Equal("BetweenMaps", saved.Phase);
        Assert.Equal(1, saved.SeriesWins!["alpha"]);

        _game.Commands.Clear();
        var r = new MatchController(AimBo3(), Fast, _game, _sink, _clock, _uploader, _store);
        r.Restore(saved);
        _clock.Advance(5);
        r.Tick();
        Assert.Contains("tv_stoprecord", _game.Commands);
        r.Tick();
        Assert.Contains("host_workshop_map 3299812021", _game.Commands);
        Assert.Equal(1, r.SeriesWins!["alpha"]);
    }

    [Fact]
    public void BoOneKeepsTheOldShape()
    {
        var m = New(Aim1v1(), Fast);
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        WinAimMap(m, Side.CT);
        Assert.DoesNotContain("map_end", _sink.Types);
        var end = _sink.Last<MatchEnd>();
        Assert.Null(end.Maps);
        Assert.Equal(13, end.Score["alpha"]);
        Assert.Null(_sink.Last<RoundEnd>().MapNumber);
        var json = MatchEventJson.SerializeBody(_sink.Last<RoundEnd>());
        Assert.DoesNotContain("mapNumber", json);
        Assert.Equal("rushsite_5f0c7a3e-1b2c-4d5e-8f90-1234567890ab", m.DemoName);
    }

    [Fact]
    public void MapEndSerializesToTheContractShape()
    {
        var json = MatchEventJson.SerializeBody(new MapEnd(2, "aim_usp", "alpha", new Dictionary<string, int> { ["alpha"] = 13, ["bravo"] = 4 },
            new[] { new PlayerStats(A1, 1, 2, 0, 50) }, false));
        Assert.Equal("{\"event\":{\"type\":\"map_end\",\"mapNumber\":2,\"mapId\":\"aim_usp\",\"winnerTeam\":\"alpha\",\"score\":{\"alpha\":13,\"bravo\":4}," +
                     "\"players\":[{\"steamId\":\"" + A1 + "\",\"kills\":1,\"deaths\":2,\"headshots\":0,\"damage\":50}],\"demoUploaded\":false}}", json);
    }
}

public class SeriesTrackerTests
{
    [Fact]
    public void CountsMapWinsAndTotals()
    {
        var s = new SeriesTracker(3, new[] { "alpha", "bravo" }, new[] { A1, B1 });
        Assert.Equal(2, s.WinsNeeded);
        Assert.False(s.RecordMap("aim_map", "alpha", new Dictionary<string, int>(), new[] { new PlayerStats(A1, 3, 1, 1, 200) }));
        Assert.True(s.Advance());
        Assert.False(s.RecordMap("aim_usp", "draw", new Dictionary<string, int>(), new[] { new PlayerStats(A1, 2, 0, 0, 100) }));
        Assert.True(s.Advance());
        Assert.True(s.RecordMap("awp_india", "bravo", new Dictionary<string, int>(), Array.Empty<PlayerStats>()));
        Assert.False(s.Advance());
        Assert.Equal("draw", s.FinalWinner);
        Assert.Equal((5, 300), (s.Totals()[0].Kills, s.Totals()[0].Damage));
        Assert.Equal(new[] { 1, 2, 3 }, s.Results.Select(r => r.MapNumber));
    }

    [Fact]
    public void EndsEarlyOnMajority()
    {
        var s = new SeriesTracker(3, new[] { "alpha", "bravo" }, new[] { A1 }, 2, new Dictionary<string, int> { ["bravo"] = 1 });
        Assert.Equal(2, s.MapNumber);
        Assert.True(s.RecordMap("aim_usp", "bravo", new Dictionary<string, int>(), Array.Empty<PlayerStats>()));
        Assert.Equal("bravo", s.FinalWinner);
    }
}

public class CountdownTests
{
    private static readonly DateTimeOffset T0 = DateTimeOffset.UnixEpoch;

    [Fact]
    public void StartsCancelsAndFires()
    {
        var c = new StartCountdown(TimeSpan.FromSeconds(10));
        Assert.Equal(CountdownChange.None, c.Update(false, T0));
        Assert.Equal(CountdownChange.Started, c.Update(true, T0));
        Assert.Equal(10, c.SecondsLeft(T0));
        Assert.Equal(CountdownChange.None, c.Update(true, T0.AddSeconds(9)));
        Assert.Equal(CountdownChange.Cancelled, c.Update(false, T0.AddSeconds(9)));
        Assert.False(c.Running);
        Assert.Equal(CountdownChange.Started, c.Update(true, T0.AddSeconds(20)));
        Assert.Equal(CountdownChange.Fired, c.Update(true, T0.AddSeconds(30)));
        Assert.Equal(CountdownChange.None, c.Update(false, T0.AddSeconds(31)));
        c.Reset();
        Assert.Equal(CountdownChange.Started, c.Update(true, T0.AddSeconds(40)));
    }

    [Fact]
    public void ZeroLengthFiresAtOnce()
    {
        var c = new StartCountdown(TimeSpan.Zero);
        Assert.Equal(CountdownChange.Fired, c.Update(true, T0));
    }
}

public class LoadoutTests
{
    [Theory]
    [InlineData("aim_usp", null, null, "weapon_usp_silencer")]
    [InlineData("aim_deagle7k", null, null, "weapon_deagle")]
    [InlineData("awp_india", "weapon_awp", "weapon_awp", null)]
    [InlineData("aim_map", "weapon_m4a1", "weapon_ak47", "weapon_usp_silencer")]
    [InlineData("aim_something_new", "weapon_m4a1", "weapon_ak47", "weapon_usp_silencer")]
    public void DefaultTableByMapId(string id, string? ctPrimary, string? tPrimary, string? ctSecondary)
    {
        var l = AimLoadouts.Resolve(new MapConfig { Id = id }, null);
        Assert.Equal((ctPrimary, tPrimary, ctSecondary), (l.CtPrimary, l.TPrimary, l.CtSecondary));
        Assert.Equal(ArmorKind.KevlarHelmet, l.Armor);
    }

    [Fact]
    public void FallsBackToServerMapNameWithSuffix()
    {
        Assert.Equal(AimLoadouts.DeagleOnly, AimLoadouts.Resolve(null, "aim_deagle"));
        Assert.Equal(AimLoadouts.AwpOnly, AimLoadouts.Resolve(null, "awp_india_night"));
    }

    [Fact]
    public void ConfigLoadoutWins()
    {
        var map = new MapConfig
        {
            Id = "aim_map",
            Loadout = new LoadoutConfig { Secondary = new SideWeaponsConfig { Ct = "weapon_deagle", T = "weapon_deagle" }, Armor = "kevlar" },
        };
        var l = AimLoadouts.Resolve(map, null);
        Assert.Null(l.CtPrimary);
        Assert.Equal(new[] { "weapon_deagle" }, l.For(Side.T).Weapons);
        Assert.Equal(ArmorKind.Kevlar, l.Armor);
        Assert.Contains("mp_free_armor 1", l.ConVarCommands());
    }

    [Fact]
    public void PerSideWeaponsAndMatching()
    {
        Assert.Equal(new[] { "weapon_ak47", "weapon_glock" }, AimLoadouts.Rifles.For(Side.T).Weapons);
        Assert.Equal(new[] { "weapon_m4a1", "weapon_usp_silencer" }, AimLoadouts.Rifles.For(Side.CT).Weapons);
        // The USP-S reports weapon_hkp2000 as its designer name.
        Assert.True(WeaponItems.Matches("weapon_usp_silencer", "weapon_hkp2000", 61));
        Assert.False(WeaponItems.Matches("weapon_usp_silencer", "weapon_hkp2000", 32));
        Assert.True(WeaponItems.Matches("weapon_unknown_gun", "weapon_unknown_gun", 999));
        Assert.True(WeaponItems.IsKnife("weapon_knife_t"));
        Assert.True(WeaponItems.IsKnife("weapon_bayonet"));
        Assert.False(WeaponItems.IsKnife("weapon_awp"));
    }
}
