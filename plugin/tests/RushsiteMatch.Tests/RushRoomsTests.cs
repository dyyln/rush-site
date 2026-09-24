using System.Text.Json;
using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using RushsiteMatch.Core.State;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class RushRoomPlanTests
{
    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    [Fact]
    public void ParsesFiveRoomsAndBuildsTheFullPath()
    {
        Assert.True(RushRoomPlan.TryParse(Json("[203, 207, 102, 211, 205]"), out var plan, out var error));
        Assert.Null(error);
        Assert.Equal(new[] { 401, 203, 207, 102, 211, 205, 301 }, plan!.Path);
    }

    [Fact]
    public void AcceptsTheSevenRoomPathTheApiSends()
    {
        Assert.True(RushRoomPlan.TryParse(Json("[401, 203, 207, 102, 211, 205, 301]"), out var plan, out var error));
        Assert.Null(error);
        Assert.Equal(new[] { 203, 207, 102, 211, 205 }, plan!.Slots);
    }

    [Fact]
    public void RefusesSevenRoomsWithoutTheCastles()
    {
        Assert.False(RushRoomPlan.TryParse(Json("[203, 207, 102, 211, 205, 204, 206]"), out _, out var error));
        Assert.Contains("needs 5", error);
    }

    [Fact]
    public void AcceptsIdsWrittenAsStrings()
    {
        Assert.True(RushRoomPlan.TryParse(Json("[\"203\", \"207\", \"102\", \"211\", \"205\"]"), out var plan, out _));
        Assert.Equal(102, plan!.RoomAt(3));
    }

    [Fact]
    public void AbsentOrNullIsNotAnError()
    {
        Assert.False(RushRoomPlan.TryParse((JsonElement?)null, out _, out var e1));
        Assert.Null(e1);
        Assert.False(RushRoomPlan.TryParse(Json("null"), out _, out var e2));
        Assert.Null(e2);
    }

    [Theory]
    [InlineData("[203, 207, 102, 211]", "needs 5")]
    [InlineData("[203, 203, 102, 211, 205]", "duplicates")]
    [InlineData("[203, 207, 208, 211, 205]", "slot 3")]
    [InlineData("[101, 207, 102, 211, 205]", "slot 1")]
    [InlineData("[203, 207, 102, 211, 301]", "slot 5")]
    [InlineData("[203, 207, 102, 211, \"convoy\"]", "not a room id")]
    [InlineData("{ \"1\": 203 }", "not an array")]
    public void RejectsBadLists(string raw, string why)
    {
        Assert.False(RushRoomPlan.TryParse(Json(raw), out var plan, out var error));
        Assert.Null(plan);
        Assert.Contains(why, error);
    }

    [Fact]
    public void CommandIsOneConsoleChatLine()
    {
        RushRoomPlan.TryParse(new[] { 203, 207, 102, 211, 205 }, out var plan, out _);
        Assert.Equal("say rushsite_rooms 203,207,102,211,205", plan!.Command());
    }

    [Fact]
    public void ExpectedArenaFollowsTheFrontAndSkipsTheDecider()
    {
        RushRoomPlan.TryParse(new[] { 203, 207, 102, 211, 205 }, out var plan, out _);
        Assert.Equal("102", plan!.ExpectedArena(3, false));
        Assert.Equal("401", plan.ExpectedArena(0, false));
        Assert.Equal("301", plan.ExpectedArena(6, false));
        Assert.Null(plan.ExpectedArena(4, true));
    }
}

public class RushRoomsControllerTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();
    private readonly MemoryStateStore _store = new();

    private const string Rooms = "\"rushRooms\": [203, 207, 102, 211, 205],";

    private static MatchConfig RushWithRooms(string rooms = Rooms) =>
        MatchConfigLoader.Parse(Json().Replace("\"winCondition\"", rooms + "\"winCondition\""));

    private MatchController New(MatchConfig cfg, MatchSettings? settings = null)
    {
        var m = new MatchController(cfg, settings ?? new MatchSettings(), _game, _sink, _clock, _uploader, _store);
        m.Start();
        return m;
    }

    private void JoinAll(MatchController m)
    {
        var uid = 1;
        foreach (var id in new[] { A1, A2, A3 }) { m.OnPlayerConnected(id, uid++); _game.Sides[id] = Side.CT; m.OnPlayerTeam(id, Side.CT); }
        foreach (var id in new[] { B1, B2, B3 }) { m.OnPlayerConnected(id, uid++); _game.Sides[id] = Side.T; m.OnPlayerTeam(id, Side.T); }
    }

    private IEnumerable<string> RoomCommands => _game.Commands.Where(c => c.StartsWith("say rushsite_rooms"));

    [Fact]
    public void RoomsAreSentInWarmupWhenTheMapIsUp()
    {
        New(RushWithRooms());
        Assert.Equal("say rushsite_rooms 203,207,102,211,205", Assert.Single(RoomCommands));
    }

    [Fact]
    public void RushTestModeSendsRoomsToo()
    {
        New(MatchConfigLoader.Parse(Json("rush1v1", "valve_rush", 1).Replace("\"winCondition\"", Rooms + "\"winCondition\"")));
        Assert.Equal("say rushsite_rooms 203,207,102,211,205", Assert.Single(RoomCommands));
    }

    [Fact]
    public void NoRoomsMeansValvesDraw()
    {
        New(Rush());
        Assert.Empty(RoomCommands);
    }

    [Fact]
    public void BadRoomsAreLoggedAndTheMatchStillLoads()
    {
        var m = New(RushWithRooms("\"rushRooms\": [203, 203],"));
        Assert.Empty(RoomCommands);
        Assert.Contains(_game.Logs, l => l.Contains("ignoring rushRooms"));
        Assert.Equal(MatchPhase.Warmup, m.Phase);
    }

    [Fact]
    public void AimIgnoresRooms()
    {
        var cfg = MatchConfigLoader.Parse(Json("aim1v1", "first_to_13", 1).Replace("\"winCondition\"", Rooms + "\"winCondition\""));
        New(cfg);
        Assert.Empty(RoomCommands);
    }

    [Fact]
    public void SettingOffSendsNothing()
    {
        New(RushWithRooms(), new MatchSettings { RushRooms = false });
        Assert.Empty(RoomCommands);
    }

    [Fact]
    public void MatchStartedCarriesTheFullPath()
    {
        var m = New(RushWithRooms());
        JoinAll(m);
        m.OnRushMatchLive();
        Assert.Equal(new[] { 401, 203, 207, 102, 211, 205, 301 }, _sink.Last<MatchStarted>().RushRooms);
    }

    [Fact]
    public void MatchingRoomsSendNoMismatch()
    {
        var m = New(RushWithRooms());
        JoinAll(m);
        _game.Arena = "102";
        m.OnRoundFreezeEnd(isWarmup: false);
        m.OnRoundEnd(Side.T, false, false);
        _game.Arena = "211";
        m.OnRoundFreezeEnd(isWarmup: false);
        m.OnRoundEnd(Side.CT, false, false);
        _game.Arena = "102";
        m.OnRoundFreezeEnd(isWarmup: false);
        Assert.DoesNotContain("rush_rooms_mismatch", _sink.Types);
    }

    [Fact]
    public void AWrongRoomIsReportedOncePerMap()
    {
        var m = New(RushWithRooms());
        JoinAll(m);
        _game.Arena = "104";
        m.OnRoundFreezeEnd(isWarmup: false);
        m.OnRoundEnd(Side.T, false, false);
        _game.Arena = "209";
        m.OnRoundFreezeEnd(isWarmup: false);

        var mismatch = Assert.Single(_sink.Events.OfType<RushRoomsMismatch>());
        Assert.Equal(1, mismatch.Round);
        Assert.Equal("102", mismatch.Expected);
        Assert.Equal("104", mismatch.Detected);
        Assert.Null(mismatch.MapNumber);
        Assert.Contains("MISMATCH", m.Status());
    }

    [Fact]
    public void AnUnreadableRoomIsNotAMismatch()
    {
        var m = New(RushWithRooms());
        JoinAll(m);
        _game.Arena = null;
        m.OnRoundFreezeEnd(isWarmup: false);
        Assert.DoesNotContain("rush_rooms_mismatch", _sink.Types);
    }

    [Fact]
    public void RoomsAreOnlyResentInWarmup()
    {
        var m = New(RushWithRooms());
        Assert.StartsWith("rooms sent", m.ResendRushRooms());
        Assert.Equal(2, RoomCommands.Count());
        JoinAll(m);
        m.OnRushMatchLive();
        Assert.Equal("rooms can only be sent in warmup", m.ResendRushRooms());
        m.OnMapStart();
        Assert.Equal(2, RoomCommands.Count());
    }

    [Fact]
    public void RestoreMidMatchDoesNotResetTheScript()
    {
        var m = New(RushWithRooms());
        JoinAll(m);
        m.OnRushMatchLive();
        var saved = _store.State!;
        _game.Commands.Clear();

        var again = new MatchController(RushWithRooms(), new MatchSettings(), _game, _sink, _clock, _uploader, _store);
        again.Restore(saved);
        Assert.Empty(RoomCommands);
        // The plan is still known so the round check keeps working.
        _game.Arena = "103";
        again.OnRoundFreezeEnd(isWarmup: false);
        Assert.Single(_sink.Events.OfType<RushRoomsMismatch>());
    }

    [Fact]
    public void RestoreKeepsAMismatchFromBeingSentTwice()
    {
        var m = New(RushWithRooms());
        JoinAll(m);
        _game.Arena = "104";
        m.OnRoundFreezeEnd(isWarmup: false);
        MatchState saved = _store.State!;
        Assert.True(saved.RushRoomsMismatchSent);

        var again = new MatchController(RushWithRooms(), new MatchSettings(), _game, _sink, _clock, _uploader, _store);
        again.Restore(saved);
        again.OnRoundFreezeEnd(isWarmup: false);
        Assert.Single(_sink.Events.OfType<RushRoomsMismatch>());
    }

    [Fact]
    public void EachSeriesMapSendsItsOwnRooms()
    {
        var cfg = MatchConfigLoader.Parse(WithSeries(Json(), """
          "rushRooms": [203, 207, 102, 211, 205],
          "series": { "bestOf": 3, "maps": [
            { "id": "rush_001", "mapName": "rush_001" },
            { "id": "rush_001", "mapName": "rush_001", "rushRooms": [201, 202, 104, 209, 210] },
            { "id": "rush_001", "mapName": "rush_001" } ] },
        """));
        var m = New(cfg, new MatchSettings { SeriesMapBreak = TimeSpan.Zero });
        Assert.Contains("say rushsite_rooms 203,207,102,211,205", RoomCommands);
        JoinAll(m);
        _game.Arena = "102";
        m.OnRoundFreezeEnd(isWarmup: false);
        for (var i = 0; i < 4; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();
        _game.Commands.Clear();

        _clock.Advance(10);
        m.Tick();
        m.OnMapStart();
        Assert.Equal(2, m.MapNumber);
        Assert.Equal("say rushsite_rooms 201,202,104,209,210", Assert.Single(RoomCommands));

        JoinAll(m);
        _game.Arena = "102";
        m.OnRoundFreezeEnd(isWarmup: false);
        var mismatch = Assert.Single(_sink.Events.OfType<RushRoomsMismatch>());
        Assert.Equal(("104", 2), (mismatch.Expected, mismatch.MapNumber));
    }

    [Fact]
    public void MismatchSerializesAsInTheContract()
    {
        var body = MatchEventJson.SerializeBody(new RushRoomsMismatch(1, "102", "104", new[] { 401, 203, 207, 102, 211, 205, 301 }));
        Assert.Equal("""{"event":{"type":"rush_rooms_mismatch","round":1,"expected":"102","detected":"104","rushRooms":[401,203,207,102,211,205,301]}}""", body);
    }
}
