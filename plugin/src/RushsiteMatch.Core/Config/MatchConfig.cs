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
}

public sealed class TeamConfig
{
    public string Name { get; init; } = "";
    public List<string> SteamIds { get; init; } = new();
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
