using RushsiteMatch.Core.Config;

using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class ConfigTests
{
    [Fact]
    public void ParsesValidRushConfig()
    {
        var cfg = TestData.Rush();
        Assert.Equal("rush3v3", cfg.Mode);
        Assert.Equal(6, cfg.AllowedSteamIds.Count);
        Assert.Equal("alpha", cfg.TeamOf(TestData.A2));
        Assert.Equal("bravo", cfg.TeamOf(TestData.B3));
        Assert.Null(cfg.TeamOf(TestData.Outsider));
        Assert.Equal("demos", cfg.DemoUpload!.Bucket);
        Assert.Equal(WinConditionKind.ValveRush, cfg.ParsedWinCondition.Kind);
        Assert.False(cfg.ParsedWinCondition.PluginManagesMatch);
    }

    [Fact]
    public void ParsesRushTestModeWithOnePlayerASide()
    {
        var cfg = TestData.Rush1v1();
        Assert.Equal("rush1v1", cfg.Mode);
        Assert.Equal(2, cfg.AllowedSteamIds.Count);
        Assert.Equal(WinConditionKind.ValveRush, cfg.ParsedWinCondition.Kind);
        Assert.False(cfg.ParsedWinCondition.PluginManagesMatch);
        Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse(Json("rush1v1", "first_to_13", 1)));
    }

    [Fact]
    public void ParsesFirstTo13()
    {
        var cfg = TestData.Aim1v1();
        Assert.Equal(WinConditionKind.FirstTo, cfg.ParsedWinCondition.Kind);
        Assert.Equal(13, cfg.ParsedWinCondition.RoundsToWin);
        Assert.Equal(25, cfg.ParsedWinCondition.MaxRounds);
        Assert.True(cfg.ParsedWinCondition.PluginManagesMatch);
    }

    [Theory]
    [InlineData("first_to_13", true)]
    [InlineData("first_to_1", true)]
    [InlineData("valve_rush", true)]
    [InlineData("first_to_0", false)]
    [InlineData("first_to_", false)]
    [InlineData("bo3", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void WinConditionParsing(string? value, bool ok) =>
        Assert.Equal(ok, WinCondition.TryParse(value, out _));

    [Fact]
    public void IgnoresUnknownFieldsAndCase()
    {
        var json = TestData.Json().Replace("\"matchId\"", "\"extra\": 1, \"MatchId\"");
        Assert.Equal("5f0c7a3e-1b2c-4d5e-8f90-1234567890ab", MatchConfigLoader.Parse(json).MatchId);
    }

    [Theory]
    [InlineData("\"mode\": \"rush3v3\"", "\"mode\": \"deathmatch\"", "mode")]
    [InlineData("\"winCondition\": \"valve_rush\"", "\"winCondition\": \"first_to_13\"", "does not fit mode")]
    [InlineData("\"password\": \"hunter2\"", "\"password\": \"\"", "password")]
    [InlineData("\"webhookSecret\": \"topsecret\"", "\"webhookSecret\": \"\"", "webhookSecret")]
    [InlineData("\"webhookUrl\": \"https://api.example", "\"webhookUrl\": \"ftp://api.example", "webhookUrl")]
    [InlineData("\"76561198000000013\"]", "\"12345\"]", "SteamID64")]
    public void RejectsBadConfig(string find, string replace, string expected)
    {
        var json = TestData.Json().Replace(find, replace);
        Assert.NotEqual(TestData.Json(), json);
        var e = Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse(json));
        Assert.Contains(expected, e.Message);
    }

    [Fact]
    public void RejectsTeamMemberNotAllowed()
    {
        var json = TestData.Json().Replace("\"allowedSteamIds\": [\"76561198000000001\",", "\"allowedSteamIds\": [");
        var e = Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse(json));
        Assert.Contains("not in allowedSteamIds", e.Message);
    }

    [Fact]
    public void RejectsBadJson()
    {
        Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse("{ nope"));
        Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse("null"));
    }

    [Fact]
    public void LoadFileReportsMissingFile()
    {
        var e = Assert.Throws<MatchConfigException>(() => MatchConfigLoader.LoadFile("/nonexistent/match.json"));
        Assert.Contains("not found", e.Message);
    }

    [Fact]
    public void ResolvePathPrecedence()
    {
        const string csgo = "/srv/cs2/game/csgo";
        var none = Array.Empty<string>();
        var cmd = new[] { "-dedicated", "+rushsite_match_config", "cfg/cmd.json", "+map", "x" };

        Assert.Equal("/env/match.json", MatchConfigLoader.ResolvePath("/env/match.json", "cfg/cv.json", cmd, "/dir", csgo));
        Assert.Equal("/srv/cs2/game/csgo/cfg/cv.json", MatchConfigLoader.ResolvePath(null, "cfg/cv.json", cmd, "/dir", csgo));
        Assert.Equal("/srv/cs2/game/csgo/cfg/cmd.json", MatchConfigLoader.ResolvePath("", "", cmd, "/dir", csgo));
        Assert.Equal("/dir/match.json", MatchConfigLoader.ResolvePath(null, null, none, "/dir", csgo));
        Assert.Equal("/srv/cs2/game/csgo/cfg/match.json", MatchConfigLoader.ResolvePath(null, null, none, null, csgo));
    }
}

public class TeamSideConfigTests
{
    [Fact]
    public void DefaultsToFirstTeamCt()
    {
        var cfg = TestData.Rush();
        Assert.Equal("ct", cfg.ConfiguredSide("alpha"));
        Assert.Equal("t", cfg.ConfiguredSide("bravo"));
    }

    [Fact]
    public void OneSideFieldDecidesBoth()
    {
        var cfg = MatchConfigLoader.Parse(TestData.Json().Replace("{ \"name\": \"bravo\",", "{ \"name\": \"bravo\", \"side\": \"CT\","));
        Assert.Equal("t", cfg.ConfiguredSide("alpha"));
        Assert.Equal("ct", cfg.ConfiguredSide("bravo"));
    }

    [Fact]
    public void RejectsBadOrClashingSides()
    {
        var bad = TestData.Json().Replace("{ \"name\": \"alpha\",", "{ \"name\": \"alpha\", \"side\": \"left\",");
        Assert.Contains("must be 'ct' or 't'", Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse(bad)).Message);
        var clash = TestData.Json()
            .Replace("{ \"name\": \"alpha\",", "{ \"name\": \"alpha\", \"side\": \"t\",")
            .Replace("{ \"name\": \"bravo\",", "{ \"name\": \"bravo\", \"side\": \"t\",");
        Assert.Contains("same side", Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse(clash)).Message);
    }

    [Fact]
    public void ParsesSeriesAndMap()
    {
        var cfg = AimBo3();
        Assert.True(cfg.IsSeries);
        Assert.Equal(3, cfg.Series!.Maps.Count);
        Assert.Equal("host_workshop_map 3084291314", cfg.MapAt(1)!.LoadCommand());
        Assert.Equal("changelevel awp_india", cfg.MapAt(3)!.LoadCommand());
        Assert.Equal("https://s3.example/m2", cfg.DemoUploadFor(2)!.PresignedPutUrl);
        Assert.False(Aim1v1().IsSeries);
        Assert.Equal("https://s3.example/demo?sig=1", Aim1v1().DemoUploadFor(1)!.PresignedPutUrl);
    }

    [Theory]
    [InlineData("\"bestOf\": 3", "\"bestOf\": 2", "odd")]
    [InlineData("\"startMapNumber\": 1", "\"startMapNumber\": 4", "startMapNumber")]
    [InlineData("\"alpha\": 0", "\"alpha\": 2", "already decides")]
    [InlineData("\"alpha\": 0", "\"zulu\": 0", "unknown team")]
    [InlineData("\"mapName\": \"awp_india\"", "\"mapName\": \"awp india;quit\"", "not a valid map name")]
    [InlineData("\"id\": \"awp_india\", \"displayName\": \"AWP India\", \"mapName\": \"awp_india\"", "\"id\": \"awp_india\"", "workshopId or a mapName")]
    [InlineData("\"id\": \"aim_usp\",", "\"id\": \"aim_usp\", \"loadout\": { \"primary\": { \"ct\": \"ak47\" } },", "not a weapon_ name")]
    [InlineData("\"id\": \"aim_usp\",", "\"id\": \"aim_usp\", \"loadout\": { \"armor\": \"heavy\" },", "armor")]
    public void RejectsBadSeries(string find, string replace, string error)
    {
        var json = WithSeries(Json("aim1v1", "first_to_13", 1), SeriesJson.Replace(find, replace));
        var e = Assert.Throws<MatchConfigException>(() => MatchConfigLoader.Parse(json));
        Assert.Contains(error, e.Message);
    }
}
