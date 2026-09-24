using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

// The center screen countdown shown every second while a match player is missing.
public class MissingCountdownTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();

    private MatchController New(MatchConfig cfg, MatchSettings? settings = null)
    {
        var m = new MatchController(cfg, settings ?? new MatchSettings(), _game, _sink, _clock, _uploader);
        m.Start();
        return m;
    }

    private void Join(MatchController m, string id, Side side, string name, int uid)
    {
        _game.Names[id] = name;
        _game.Connected.RemoveAll(p => p.SteamId == id);
        _game.Connected.Add(new ConnectedPlayer(id, uid, true));
        m.OnPlayerConnected(id, uid);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    private void Leave(MatchController m, string id)
    {
        _game.Connected.RemoveAll(p => p.SteamId == id);
        m.OnPlayerDisconnected(id);
    }

    private void Tick(MatchController m, int seconds)
    {
        for (var i = 0; i < seconds; i++)
        {
            _clock.Advance(1);
            m.Tick();
        }
    }

    [Fact]
    public void ADisconnectCountsDownEverySecondUntilTheReturn()
    {
        var m = New(Aim1v1(), new MatchSettings { DisconnectGrace = TimeSpan.FromMinutes(3) });
        Join(m, A1, Side.CT, "Alice", 1);
        Join(m, B1, Side.T, "Bob", 2);
        m.ForceStart();
        Leave(m, B1);
        _game.Center.Clear();

        Tick(m, 3);
        Assert.Equal(new[]
        {
            "Bob left. 2:59 to return or forfeit",
            "Bob left. 2:58 to return or forfeit",
            "Bob left. 2:57 to return or forfeit",
        }, _game.Center);

        Join(m, B1, Side.T, "Bob", 2);
        _game.Center.Clear();
        Tick(m, 5);
        Assert.Empty(_game.Center);
    }

    [Fact]
    public void PlayersWhoHaveNotJoinedCountDownTheConnectGrace()
    {
        var m = New(Aim1v1(), new MatchSettings { ConnectGrace = TimeSpan.FromMinutes(5) });
        Join(m, A1, Side.CT, "Alice", 1);
        _game.Center.Clear();
        Tick(m, 60);
        // No name is known before the player has been on the server, so the team stands in
        Assert.Equal("Waiting for a player from Team bravo to join. 4:00", _game.Center[^1]);
        Assert.Equal(60, _game.Center.Count);
    }

    [Fact]
    public void SeveralMissingPlayersAreListedSoonestFirst()
    {
        var m = New(Rush(), new MatchSettings { ConnectGrace = TimeSpan.FromMinutes(5), DisconnectGrace = TimeSpan.FromMinutes(3) });
        Join(m, A1, Side.CT, "Ann", 1);
        Join(m, A2, Side.CT, "Al", 2);
        Join(m, A3, Side.CT, "Ash", 3);
        Join(m, B1, Side.T, "Bea", 4);
        Tick(m, 10);
        Leave(m, A2);
        Tick(m, 1);
        // The two bravo players who never joined share one clock, so it shows once
        Assert.Equal("Waiting for Al 2:59, 2 players from Team bravo 4:49", _game.Center[^1]);

        Leave(m, A3);
        Tick(m, 1);
        Assert.Equal("Waiting for Al 2:58, Ash 2:59, 2 players from Team bravo 4:48", _game.Center[^1]);
    }

    [Fact]
    public void PlayersOnTheSameClockShareOneEntry()
    {
        var m = New(Rush(), new MatchSettings { ConnectGrace = TimeSpan.FromMinutes(5) });
        Join(m, A1, Side.CT, "Ann", 1);
        _game.Center.Clear();
        Tick(m, 60);
        Assert.Equal("Waiting for 2 players from Team alpha and 3 players from Team bravo to join. 4:00", _game.Center[^1]);
    }

    [Fact]
    public void ForfeitRemindersForPlayersWhoLeftTogetherAreOneLine()
    {
        var m = New(Rush(), new MatchSettings { DisconnectGrace = TimeSpan.FromMinutes(3), StartCountdown = TimeSpan.Zero });
        Join(m, A1, Side.CT, "Ann", 1);
        Join(m, A2, Side.CT, "Al", 2);
        Join(m, A3, Side.CT, "Ash", 3);
        Join(m, B1, Side.T, "Bea", 4);
        Join(m, B2, Side.T, "Ben", 5);
        Join(m, B3, Side.T, "Bo", 6);
        m.ForceStart();
        Leave(m, B2);
        Leave(m, B3);
        Tick(m, 61);
        var reminders = _game.Chat.Where(c => c.Contains("left to return")).ToList();
        Assert.Equal(new[] { " [DuelRush] Ben and Bo have 2:00 left to return or they forfeit." }, reminders);
    }

    [Fact]
    public void PlayersWaitingForSteamAreNotCountedDown()
    {
        var m = New(Aim1v1());
        Join(m, A1, Side.CT, "Alice", 1);
        m.OnPlayerConnectFull(2, null, B1);
        _game.Center.Clear();
        Tick(m, 3);
        Assert.Empty(_game.Center);
    }

    [Fact]
    public void TheSettingTurnsItOff()
    {
        var m = New(Aim1v1(), new MatchSettings { MissingCountdown = false });
        Join(m, A1, Side.CT, "Alice", 1);
        _game.Center.Clear();
        Tick(m, 5);
        Assert.Empty(_game.Center);
    }

    [Fact]
    public void NothingShowsWhileTheNextSeriesMapLoads()
    {
        var m = New(AimBo3(), new MatchSettings { SeriesMapBreak = TimeSpan.Zero });
        Join(m, A1, Side.CT, "Alice", 1);
        Join(m, B1, Side.T, "Bob", 2);
        m.ForceStart();
        for (var i = 0; i < 13; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();
        Tick(m, 10);
        Assert.Contains(_game.Commands, c => c.StartsWith("host_workshop_map") || c.StartsWith("changelevel"));
        _game.Center.Clear();
        Tick(m, 5);
        Assert.Empty(_game.Center);

        // Players reload with the map. Once it is up they count down the disconnect grace, as they were in before
        _game.Connected.Clear();
        m.OnMapStart();
        Tick(m, 1);
        Assert.Equal("Alice and Bob left. 2:59 to return or forfeit", _game.Center[^1]);
    }
}
