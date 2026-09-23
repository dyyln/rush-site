using RushsiteMatch.Core.Config;

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
}
