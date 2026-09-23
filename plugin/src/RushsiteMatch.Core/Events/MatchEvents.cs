using System.Text.Json;
using System.Text.Json.Serialization;

namespace RushsiteMatch.Core.Events;

// Shapes follow MatchEvent in docs/CONTRACTS.md.
public abstract record MatchEvent(string Type)
{
    [JsonPropertyOrder(-1)]
    public string Type { get; } = Type;
}

public sealed record ServerReady() : MatchEvent("server_ready");

public sealed record PlayerConnected(string SteamId) : MatchEvent("player_connected");

public sealed record PlayerDisconnected(string SteamId) : MatchEvent("player_disconnected");

public sealed record MatchStarted() : MatchEvent("match_started");

public sealed record RoundEnd(int Round, string WinnerTeam, IReadOnlyDictionary<string, int> Score) : MatchEvent("round_end")
{
    // Rush only. Room id from rush_001.js such as "101" or "convoy". Null when unknown.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Arena { get; init; }
}

public sealed record MatchEnd(
    string WinnerTeam,
    IReadOnlyDictionary<string, int> Score,
    IReadOnlyList<PlayerStats> Players,
    bool DemoUploaded) : MatchEvent("match_end");

public sealed record MatchAbandoned(string Reason, IReadOnlyList<string> MissingSteamIds) : MatchEvent("match_abandoned");

// Sent once the demo upload after match_end or match_abandoned finishes.
public sealed record DemoUploaded(bool Ok) : MatchEvent("demo_uploaded")
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? Bytes { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; init; }
}

public sealed record PlayerStats(string SteamId, int Kills, int Deaths, int Headshots, int Damage);

public static class MatchEventJson
{
    public const string Draw = "draw";

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = null,
    };

    // Webhook body is { "event": MatchEvent }.
    public static string SerializeBody(MatchEvent evt) =>
        JsonSerializer.Serialize(new Envelope(evt), Options);

    private sealed record Envelope([property: JsonPropertyName("event")] object Event);
}
