using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using RushsiteMatch.Core.State;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class ChatTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();
    private readonly MemoryStateStore _store = new();

    private const string Brand = """
      "brand": { "name": "AimRift", "siteUrl": "https://aimrift.example/" },
      "slug": "brave-amber-falcon",
    """;

    private static MatchConfig Branded(string json) => MatchConfigLoader.Parse(json.Replace("\"winCondition\"", Brand + "\"winCondition\""));

    private MatchController New(MatchConfig cfg, MatchSettings? settings = null)
    {
        var m = new MatchController(cfg, settings ?? new MatchSettings(), _game, _sink, _clock, _uploader, _store);
        m.Start();
        return m;
    }

    private void Join(MatchController m, string id, Side side, string? name = null)
    {
        if (name is not null) _game.Names[id] = name;
        _game.Connected.RemoveAll(p => p.SteamId == id);
        _game.Connected.Add(new ConnectedPlayer(id, 1, true));
        m.OnPlayerConnected(id, 1);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    private void Tick(MatchController m, double seconds)
    {
        for (var i = 0; i < seconds; i++)
        {
            _clock.Advance(1);
            m.Tick();
        }
    }

    [Fact]
    public void PrefixFallsBackToTheBrand()
    {
        var msg = new MatchMessages(Aim1v1());
        Assert.Equal("DuelRush", msg.BrandName);
        Assert.Equal(" \x0E[DuelRush]\x01", msg.Prefix);
        Assert.Null(msg.MatchUrl);
        Assert.Null(msg.LinkLine());
    }

    [Fact]
    public void BrandAndSlugComeFromMatchJson()
    {
        var cfg = Branded(Json("aim1v1", "first_to_13", 1));
        Assert.Equal("brave-amber-falcon", cfg.Slug);
        var msg = new MatchMessages(cfg);
        Assert.Equal("AimRift", msg.BrandName);
        Assert.StartsWith(" \x0E[AimRift]\x01 ", msg.Line("hi"));
        Assert.Equal("https://aimrift.example/matches/brave-amber-falcon", msg.MatchUrl);
    }

    [Theory]
    [InlineData("""{ "name": "X", "siteUrl": "https://site.example" }""", null, "https://site.example/matches/5f0c7a3e-1b2c-4d5e-8f90-1234567890ab")]
    [InlineData("""{ "name": "X", "siteUrl": "ftp://site.example" }""", "a-b", null)]
    [InlineData("""{ "name": "X", "siteUrl": "not a url" }""", "a-b", null)]
    [InlineData("""{ "name": "X" }""", "a-b", null)]
    [InlineData("""{ "siteUrl": "http://localhost:3000" }""", "a b", "http://localhost:3000/matches/a%20b")]
    public void MatchUrlUsesSlugOrMatchIdAndNeedsAnHttpSite(string brand, string? slug, string? expected)
    {
        var extra = $"\"brand\": {brand}," + (slug is null ? "" : $"\"slug\": \"{slug}\",");
        var cfg = MatchConfigLoader.Parse(Json().Replace("\"winCondition\"", extra + "\"winCondition\""));
        Assert.Equal(expected, MatchMessages.BuildMatchUrl(cfg));
    }

    [Fact]
    public void NamesAndBrandLoseControlCharacters()
    {
        Assert.Equal("evil", MatchMessages.CleanText("\u0002ev\u0007il\n", 32));
        Assert.Equal("abc", MatchMessages.CleanText("abcdef", 3));
        var cfg = MatchConfigLoader.Parse(Json().Replace("\"winCondition\"", "\"brand\": { \"name\": \"  \" },\"winCondition\""));
        Assert.Equal("DuelRush", new MatchMessages(cfg).BrandName);
    }

    [Theory]
    [InlineData(180, "3:00")]
    [InlineData(65.2, "1:06")]
    [InlineData(9, "0:09")]
    [InlineData(-3, "0:00")]
    public void ClockFormat(double seconds, string expected) =>
        Assert.Equal(expected, MatchMessages.Clock(TimeSpan.FromSeconds(seconds)));

    private static List<int> Announced(int from, Func<int, bool> isMark, int step = 1)
    {
        var said = new List<int>();
        var last = from;
        for (var left = from - step; left > 0; left -= step)
        {
            if (!CountdownMarks.Due(left, last, isMark)) continue;
            said.Add(left);
            last = left;
        }
        return said;
    }

    [Fact]
    public void StartCountdownMarks()
    {
        Assert.Equal(new[] { 5, 4, 3, 2, 1 }, Announced(10, CountdownMarks.IsStartMark));
        Assert.Equal(new[] { 20, 10, 5, 4, 3, 2, 1 }, Announced(30, CountdownMarks.IsStartMark));
    }

    [Fact]
    public void GraceMarksEveryMinuteThenThirtyAndTen()
    {
        Assert.Equal(new[] { 120, 60, 30, 10 }, Announced(180, CountdownMarks.IsGraceMark));
        Assert.Equal(new[] { 240, 180, 120, 60, 30, 10 }, Announced(300, CountdownMarks.IsGraceMark));
        // A skipped tick still announces the mark it passed.
        Assert.Equal(new[] { 117, 54, 26, 5 }, Announced(180, CountdownMarks.IsGraceMark, step: 7));
    }

    [Fact]
    public void CountdownIsAnnouncedInChatAndCenter()
    {
        var m = New(Aim1v1(), new MatchSettings { StartCountdown = TimeSpan.FromSeconds(10) });
        Join(m, A1, Side.CT, "Alice");
        Join(m, B1, Side.T, "Bob");
        Assert.Contains(" [DuelRush] All players are in. The match starts in 10 seconds.", _game.Chat);
        Tick(m, 9);
        var ticks = _game.Chat.Where(c => c.Contains("The match starts in ") && !c.Contains("seconds")).ToList();
        Assert.Equal(new[] { 5, 4, 3, 2, 1 }.Select(n => $" [DuelRush] The match starts in {n}."), ticks);
        Assert.Equal(Enumerable.Range(1, 10).Reverse().Select(n => $"The match starts in {n}"), _game.Center);
        Tick(m, 1);
        Assert.Equal(MatchPhase.Live, m.Phase);
    }

    [Fact]
    public void CancelledCountdownNamesWhoSwitchedOrLeft()
    {
        var m = New(Aim2v2(), new MatchSettings { StartCountdown = TimeSpan.FromSeconds(10) });
        Join(m, A1, Side.CT, "Alice");
        Join(m, A2, Side.CT, "Ann");
        Join(m, B1, Side.T, "Bob");
        Join(m, B2, Side.T, "Ben");
        Assert.True(m.CountdownRunning);

        _game.Sides[B2] = Side.Spectator;
        m.OnPlayerTeam(B2, Side.Spectator);
        Assert.Contains(_game.Chat, c => c.Contains("Countdown stopped. Ben switched side. It starts again once everyone is in and on their side."));

        _game.Sides[B2] = Side.T;
        m.OnPlayerTeam(B2, Side.T);
        Assert.True(m.CountdownRunning);
        _game.Names.Remove(A2);
        m.OnPlayerDisconnected(A2);
        Assert.Contains(_game.Chat, c => c.Contains("Countdown stopped. Ann left the server."));
    }

    [Fact]
    public void DisconnectAnnouncesTheForfeitTimerAndTheReturn()
    {
        var m = New(Aim1v1(), new MatchSettings { DisconnectGrace = TimeSpan.FromMinutes(3) });
        Join(m, A1, Side.CT, "Alice");
        Join(m, B1, Side.T, "Bob");
        m.ForceStart();

        _game.Names.Remove(B1);
        m.OnPlayerDisconnected(B1, 1, "Bob\x07");
        Assert.Contains("mp_pause_match", _game.Commands);
        Assert.Contains(" [DuelRush] Bob disconnected. 3:00 to return or they forfeit. The match pauses at the next freeze time.", _game.Chat);
        Assert.Contains("Bob disconnected. 3:00 to return", _game.Center);
        Assert.Contains(_game.RawChat, c => c.Contains("\x0F" + "Bob disconnected.\x01"));

        _game.Connected.RemoveAll(p => p.SteamId == B1);
        Tick(m, 175);
        var away = _game.Chat.Where(c => c.Contains("has ")).ToList();
        Assert.Equal(new[] { "2:00", "1:00", "0:30", "0:10" }.Select(t => $" [DuelRush] Bob has {t} left to return or they forfeit."), away);
        Assert.Equal(MatchPhase.Live, m.Phase);

        Join(m, B1, Side.T);
        Assert.Contains(" [DuelRush] Bob is back. All players are in. Unpausing.", _game.Chat);
        Assert.Contains("mp_unpause_match", _game.Commands);
        var count = _game.Chat.Count;
        Tick(m, 30);
        Assert.Equal(count, _game.Chat.Count);
    }

    [Fact]
    public void DisconnectUsesTheConfiguredGrace()
    {
        var m = New(Rush(), new MatchSettings { DisconnectGrace = TimeSpan.FromSeconds(90) });
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
        m.OnRushMatchLive();
        _game.Names[B3] = "Cara";
        m.OnPlayerDisconnected(B3);
        // Rush never pauses. The forfeit timer still applies.
        Assert.Contains(" [DuelRush] Cara disconnected. 1:30 to return or they forfeit.", _game.Chat);
        Assert.DoesNotContain("mp_pause_match", _game.Commands);
    }

    [Fact]
    public void MatchEndPrintsScoreAndLinkThenKicksAfterTheDelay()
    {
        var m = New(Branded(Json("aim1v1", "first_to_13", 1)), new MatchSettings { StartCountdown = TimeSpan.Zero });
        Join(m, A1, Side.CT, "Alice");
        Join(m, B1, Side.T, "Bob");
        Assert.Equal(MatchPhase.Live, m.Phase);
        for (var i = 0; i < 7; i++) m.OnRoundEnd(Side.T, false, false);
        for (var i = 0; i < 13; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();

        Assert.Equal(MatchPhase.Ended, m.Phase);
        Assert.Contains(" [AimRift] Match over. Team alpha 13 - 7 Team bravo. Winner: Team alpha.", _game.Chat);
        Assert.Contains(" [AimRift] Match page: https://aimrift.example/matches/brave-amber-falcon", _game.Chat);
        Assert.Contains(" [AimRift] The server closes in 10 seconds.", _game.Chat);
        Assert.Empty(_game.SteamKicks);

        Tick(m, 9);
        Assert.Empty(_game.SteamKicks);
        Tick(m, 1);
        Assert.Equal(2, _game.SteamKicks.Count);
        Assert.All(_game.SteamKicks, k => Assert.Equal("Match over. Team alpha 13-7 Team bravo. Thanks for playing.", k.Reason));

        // Anyone who comes back after the kick is sent away again.
        m.OnPlayerConnected(B1, 2);
        Assert.Equal(3, _game.SteamKicks.Count);
    }

    [Fact]
    public void SeriesPrintsEachMapAndTheFinalSeriesScore()
    {
        var m = New(MatchConfigLoader.Parse(WithSeries(Json("aim1v1", "first_to_13", 1)).Replace("\"winCondition\"", Brand + "\"winCondition\"")),
            new MatchSettings { StartCountdown = TimeSpan.Zero, SeriesMapBreak = TimeSpan.FromSeconds(30) });
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        for (var i = 0; i < 3; i++) m.OnRoundEnd(Side.T, false, false);
        for (var i = 0; i < 13; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();
        Assert.Contains(" [AimRift] Map 1 (Aim Map) over. Team alpha 13 - 3 Team bravo. Winner: Team alpha. " +
                        "Series Team alpha 1 - 0 Team bravo. Next map USP in 30 seconds.", _game.Chat);
        Assert.DoesNotContain(_game.Chat, c => c.Contains("Match page"));
        Assert.Empty(_game.SteamKicks);

        Tick(m, 35);
        m.OnMapStart();
        _game.Sides.Clear();
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        for (var i = 0; i < 13; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();

        Assert.Equal(MatchPhase.Ended, m.Phase);
        Assert.Contains(" [AimRift] Series over. Team alpha 2 - 0 Team bravo. Winner: Team alpha.", _game.Chat);
        Assert.Contains(" [AimRift] Map 1 Aim Map: Team alpha 13 - 3 Team bravo", _game.Chat);
        Assert.Contains(" [AimRift] Map 2 USP: Team alpha 13 - 0 Team bravo", _game.Chat);
        Assert.Contains(" [AimRift] Match page: https://aimrift.example/matches/brave-amber-falcon", _game.Chat);
        Tick(m, 10);
        Assert.All(_game.SteamKicks, k => Assert.Equal("Series over. Team alpha 2-0 Team bravo. Thanks for playing.", k.Reason));
        Assert.NotEmpty(_game.SteamKicks);
    }

    [Fact]
    public void TeamDisplayNameIsUsedInChat()
    {
        var json = Json("aim1v1", "first_to_13", 1).Replace("{ \"name\": \"alpha\",", "{ \"name\": \"alpha\", \"displayName\": \"Night Owls\",");
        var msg = new MatchMessages(MatchConfigLoader.Parse(json));
        Assert.Equal("Night Owls", msg.TeamLabel("alpha"));
        Assert.Equal("Team bravo", msg.TeamLabel("bravo"));
        Assert.Equal("Night Owls 1-2 Team bravo", msg.ScoreLine(new Dictionary<string, int> { ["alpha"] = 1, ["bravo"] = 2 }, plain: true));
    }

    [Fact]
    public void RestoredEndedMatchStillKicksAfterTheDelay()
    {
        var first = New(Aim1v1(), new MatchSettings { StartCountdown = TimeSpan.Zero });
        Join(first, A1, Side.CT);
        Join(first, B1, Side.T);
        for (var i = 0; i < 13; i++) first.OnRoundEnd(Side.CT, false, false);
        first.OnWinPanelMatch();
        var saved = _store.State!;
        Assert.Equal("Ended", saved.Phase);

        var m = new MatchController(Aim1v1(), new MatchSettings(), _game, _sink, _clock, _uploader, _store);
        m.Restore(saved);
        _game.SteamKicks.Clear();
        Tick(m, 10);
        Assert.Equal(2, _game.SteamKicks.Count);
        Assert.All(_game.SteamKicks, k => Assert.Equal("Match over. Team alpha 13-0 Team bravo. Thanks for playing.", k.Reason));
    }
}
