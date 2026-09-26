using System.Text.RegularExpressions;
using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class DemoToggleTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();

    private const string OffLog = "demo recording is off for this match. No demo is recorded or uploaded.";

    private static readonly Regex DemoUploadLine = new("\"demoUpload\": \\{[^}]*\\},");

    private static string WithoutDemoUpload(string json) => DemoUploadLine.Replace(json, "");

    private static string RecordOff(string json, bool blankUpload = false) =>
        DemoUploadLine.Replace(json, blankUpload
            ? "\"recordDemo\": false, \"demoUpload\": { \"bucket\": \"\", \"key\": \"\", \"presignedPutUrl\": \"\" },"
            : "\"recordDemo\": false,");

    private const string SeriesNoUploads = """
      "series": {
        "bestOf": 3,
        "maps": [
          { "id": "aim_map", "displayName": "Aim Map", "workshopId": "3084291314" },
          { "id": "aim_usp", "displayName": "USP", "workshopId": "3299812021" },
          { "id": "awp_india", "displayName": "AWP India", "mapName": "awp_india" }
        ],
        "startMapNumber": 1,
        "wins": { "alpha": 0, "bravo": 0 }
      },
    """;

    private MatchController New(MatchConfig cfg, MatchSettings? settings = null)
    {
        var m = new MatchController(cfg, settings ?? new MatchSettings { StartCountdown = TimeSpan.Zero }, _game, _sink, _clock, _uploader);
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

    [Fact]
    public void ConfigWithoutRecordDemoRecords()
    {
        var cfg = Rush();
        Assert.Null(cfg.RecordDemo);
        Assert.True(cfg.RecordsDemo);
        Assert.Equal("https://s3.example/demo?sig=1", cfg.DemoUploadFor(1)?.PresignedPutUrl);
    }

    [Fact]
    public void ConfigWithoutRecordDemoStillNeedsDemoUpload()
    {
        var e = Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse(WithoutDemoUpload(Json())));
        Assert.Contains("demoUpload is required", e.Message);
    }

    [Fact]
    public void RecordDemoFalseNeedsNoDemoUpload()
    {
        var cfg = MatchConfigLoader.Parse(RecordOff(Json()));
        Assert.False(cfg.RecordsDemo);
        Assert.Null(cfg.DemoUpload);

        var blank = MatchConfigLoader.Parse(RecordOff(Json(), blankUpload: true));
        Assert.False(blank.RecordsDemo);

        var series = MatchConfigLoader.Parse(WithSeries(RecordOff(Json("aim1v1", "first_to_13", 1)), SeriesNoUploads));
        Assert.False(series.RecordsDemo);
        Assert.Null(series.DemoUploadFor(2));
    }

    [Fact]
    public void RecordDemoTrueBehavesLikeMissing()
    {
        var cfg = MatchConfigLoader.Parse(Json().Replace("\"demoUpload\"", "\"recordDemo\": true, \"demoUpload\""));
        Assert.True(cfg.RecordsDemo);
    }

    [Fact]
    public void RushWithRecordingOffNeverRecordsOrUploads()
    {
        _game.ConVars["tv_delay"] = "105";
        var m = New(MatchConfigLoader.Parse(RecordOff(Json(), blankUpload: true)), new MatchSettings { TvDelay = 0 });
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
        m.OnRoundFreezeEnd(isWarmup: false);
        m.OnRushMatchLive();
        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("tv_record"));
        Assert.Contains("tv_delay 0", _game.Commands);
        Assert.Single(_game.Logs, OffLog);

        for (var i = 0; i < 4; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();
        Assert.Equal(MatchPhase.Ended, m.Phase);
        Assert.False(_sink.Last<MatchEnd>().DemoUploaded);
        _clock.Advance(300);
        m.Tick();
        m.Tick();

        Assert.DoesNotContain("tv_stoprecord", _game.Commands);
        Assert.Null(m.UploadTask);
        Assert.False(m.DemoPending);
        Assert.Empty(_uploader.Calls);
        Assert.DoesNotContain("demo_uploaded", _sink.Types);
    }

    [Fact]
    public void Bo3WithRecordingOffSkipsEveryMapAndStillChangesLevel()
    {
        _game.ConVars["tv_delay"] = "105";
        var settings = new MatchSettings { StartCountdown = TimeSpan.Zero, TvDelay = 0, SeriesMapBreak = TimeSpan.FromSeconds(10) };
        var m = New(MatchConfigLoader.Parse(WithSeries(RecordOff(Json("aim1v1", "first_to_13", 1), blankUpload: true), SeriesNoUploads)), settings);

        for (var map = 1; map <= 2; map++)
        {
            _game.Sides.Clear();
            Join(m, A1, Side.CT);
            Join(m, B1, Side.T);
            Assert.Equal(MatchPhase.Live, m.Phase);
            Assert.Equal(map, m.MapNumber);
            for (var i = 0; i < 13; i++) m.OnRoundEnd(Side.CT, false, false);
            m.OnWinPanelMatch();
            if (map == 1)
            {
                Assert.Equal(MatchPhase.BetweenMaps, m.Phase);
                // Nothing to flush, so only the map break holds the next map back
                _clock.Advance(10);
                m.Tick();
                Assert.Contains("host_workshop_map 3299812021", _game.Commands);
                m.OnMapStart();
            }
        }

        Assert.Equal(MatchPhase.Ended, m.Phase);
        Assert.Equal(2, _sink.Last<MatchEnd>().Score["alpha"]);
        Assert.All(_sink.Events.OfType<MapEnd>(), e => Assert.False(e.DemoUploaded));
        _clock.Advance(300);
        m.Tick();

        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("tv_record") || c == "tv_stoprecord");
        Assert.Equal(2, _game.Commands.Count(c => c == "tv_delay 0"));
        Assert.Null(m.UploadTask);
        Assert.Empty(_uploader.Calls);
        Assert.DoesNotContain("demo_uploaded", _sink.Types);
        Assert.Single(_game.Logs, OffLog);
    }
}
