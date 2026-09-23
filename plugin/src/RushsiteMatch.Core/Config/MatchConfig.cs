using System.Text.Json.Serialization;

namespace RushsiteMatch.Core.Config;

public sealed class MatchConfig
{
    public string MatchId { get; init; } = "";
    public string Mode { get; init; } = "";
    public List<string> AllowedSteamIds { get; init; } = new();
    public List<TeamConfig> Teams { get; init; } = new();
    public string Password { get; init; } = "";
    public string WebhookUrl { get; init; } = "";
    public string WebhookSecret { get; init; } = "";
    public DemoUploadConfig? DemoUpload { get; init; }
    public string WinCondition { get; init; } = "";

    [JsonIgnore]
    public WinCondition ParsedWinCondition { get; internal set; } = null!;

    public string? TeamOf(string steamId) =>
        Teams.FirstOrDefault(t => t.SteamIds.Contains(steamId))?.Name;

    public bool IsAllowed(string steamId) => AllowedSteamIds.Contains(steamId);

    // Side each team plays. teams[0] is CT and teams[1] is T unless a team sets side.
    // Fixed for the whole match. Never derived from where players stand.
    public string ConfiguredSide(string team)
    {
        var idx = Teams.FindIndex(t => t.Name == team);
        if (idx < 0) return "";
        var own = TeamConfig.NormalizeSide(Teams[idx].Side);
        if (own is not null) return own;
        var other = Teams.Count == 2 ? TeamConfig.NormalizeSide(Teams[1 - idx].Side) : null;
        if (other is not null) return other == TeamConfig.SideCt ? TeamConfig.SideT : TeamConfig.SideCt;
        return idx == 0 ? TeamConfig.SideCt : TeamConfig.SideT;
    }
}

public sealed class TeamConfig
{
    public string Name { get; init; } = "";
    public List<string> SteamIds { get; init; } = new();

    // Optional. "ct" or "t". When left out teams[0] plays CT and teams[1] plays T.
    public string? Side { get; init; }

    public const string SideCt = "ct";
    public const string SideT = "t";

    public static string? NormalizeSide(string? s) => s?.Trim().ToLowerInvariant() switch
    {
        "ct" or "3" or "counterterrorist" or "counter-terrorist" => SideCt,
        "t" or "2" or "terrorist" => SideT,
        _ => null,
    };
}

public sealed class DemoUploadConfig
{
    public string Bucket { get; init; } = "";
    public string Key { get; init; } = "";
    public string PresignedPutUrl { get; init; } = "";
}

public static class Modes
{
    public const string Aim1v1 = "aim1v1";
    public const string Aim2v2 = "aim2v2";
    public const string Rush3v3 = "rush3v3";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Aim1v1, Aim2v2, Rush3v3 };
}
