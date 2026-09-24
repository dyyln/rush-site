using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

// The rush_001 script answers each room set with rushsite_rooms_applied or rushsite_rooms_rejected.
public class RushRoomsHandshakeTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();
    private readonly MemoryStateStore _store = new();

    private const string Applied = "401,203,207,102,211,205,301";

    private static MatchConfig RushWithRooms() =>
        MatchConfigLoader.Parse(Json().Replace("\"winCondition\"", "\"rushRooms\": [203, 207, 102, 211, 205],\"winCondition\""));

    private MatchController New(MatchConfig? cfg = null)
    {
        var m = new MatchController(cfg ?? RushWithRooms(), new MatchSettings(), _game, _sink, _clock, _uploader, _store);
        m.Start();
        return m;
    }

    private int Sends => _game.Commands.Count(c => c.StartsWith("say rushsite_rooms"));
    private RushRoomsFailed? Failed => _sink.Events.OfType<RushRoomsFailed>().SingleOrDefault();

    private void Wait(MatchController m, double seconds)
    {
        _clock.Advance(seconds);
        m.Tick();
    }

    private void GoLive(MatchController m)
    {
        var uid = 1;
        foreach (var id in new[] { A1, A2, A3 }) { m.OnPlayerConnected(id, uid++); _game.Sides[id] = Side.CT; m.OnPlayerTeam(id, Side.CT); }
        foreach (var id in new[] { B1, B2, B3 }) { m.OnPlayerConnected(id, uid++); _game.Sides[id] = Side.T; m.OnPlayerTeam(id, Side.T); }
        m.OnRushMatchLive();
    }

    [Fact]
    public void AMatchingReplyConfirmsTheRooms()
    {
        var m = New();
        m.OnRushRoomsApplied(Applied);
        Wait(m, 30);
        Assert.Equal(1, Sends);
        Assert.Null(Failed);
        Assert.Contains("confirmed", m.Status());
        GoLive(m);
        Assert.True(_sink.Last<MatchStarted>().RushRoomsConfirmed);
    }

    [Fact]
    public void NoReplySendsOnceMoreThenReportsTheScriptMissing()
    {
        var m = New();
        Wait(m, 4);
        Assert.Equal(1, Sends);
        Wait(m, 1);
        Assert.Equal(2, Sends);
        Assert.Null(Failed);
        Wait(m, 5);
        Assert.Equal("no_reply", Failed!.Reason);
        Assert.Equal(new[] { 401, 203, 207, 102, 211, 205, 301 }, Failed.RushRooms);
        Assert.Null(Failed.Detail);
        Assert.Contains(_game.Logs, l => l.Contains("gameinfo.gi"));
        Wait(m, 60);
        Assert.Equal(2, Sends);
        Assert.Single(_sink.Events.OfType<RushRoomsFailed>());
        Assert.Contains("FAILED", m.Status());
        GoLive(m);
        Assert.False(_sink.Last<MatchStarted>().RushRoomsConfirmed);
    }

    [Fact]
    public void AReplyAfterTheResendStillConfirms()
    {
        var m = New();
        Wait(m, 5);
        m.OnRushRoomsApplied(Applied);
        Wait(m, 30);
        Assert.Null(Failed);
    }

    [Fact]
    public void ARejectionIsReportedWithTheScriptsReason()
    {
        var m = New();
        m.OnRushRoomsRejected("bad_set 203,207,102,211,205");
        Assert.Equal("rejected", Failed!.Reason);
        Assert.Equal("bad_set 203,207,102,211,205", Failed.Detail);
    }

    [Fact]
    public void OtherRoomsInPlayAreReported()
    {
        var m = New();
        m.OnRushRoomsApplied("401,206,211,101,203,212,301");
        Assert.Equal("different", Failed!.Reason);
        Assert.Equal("401,206,211,101,203,212,301", Failed.Detail);
    }

    [Fact]
    public void RepliesAreIgnoredWithoutAPlan()
    {
        var m = New(Rush());
        m.OnRushRoomsApplied("401,206,211,101,203,212,301");
        m.OnRushRoomsRejected("bad_set");
        Wait(m, 30);
        Assert.Null(Failed);
        GoLive(m);
        Assert.Null(_sink.Last<MatchStarted>().RushRoomsConfirmed);
    }

    [Fact]
    public void GoingLiveUnansweredStillReportsAfterTheTimeout()
    {
        var m = New();
        GoLive(m);
        Wait(m, 5);
        Assert.Equal("no_reply", Failed!.Reason);
        Assert.Equal(1, Sends);
    }

    [Fact]
    public void RestoreKeepsTheConfirmation()
    {
        var m = New();
        m.OnRushRoomsApplied(Applied);
        GoLive(m);
        var saved = _store.State!;
        Assert.True(saved.RushRoomsConfirmed);

        var again = new MatchController(RushWithRooms(), new MatchSettings(), _game, _sink, _clock, _uploader, _store);
        again.Restore(saved);
        Assert.Contains("confirmed", again.Status());
    }

    [Fact]
    public void FailedSerializesAsInTheContract()
    {
        var body = MatchEventJson.SerializeBody(new RushRoomsFailed("rejected", new[] { 401, 203, 207, 102, 211, 205, 301 }) { Detail = "too_late 203,207,102,211,205", MapNumber = 2 });
        Assert.Equal("""{"event":{"type":"rush_rooms_failed","reason":"rejected","rushRooms":[401,203,207,102,211,205,301],"detail":"too_late 203,207,102,211,205","mapNumber":2}}""", body);
    }
}
