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

// Sent at the live start of each map. MapNumber is set only in a series.
public sealed record MatchStarted() : MatchEvent("match_started")
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? MapNumber { get; init; }

    // Rush only. The 7 room ids the plugin asked the script for, castles included. Null when the draw is Valve's.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<int>? RushRooms { get; init; }

    // Rush only, with RushRooms. True when our rush_001 script confirmed it applied exactly those rooms.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? RushRoomsConfirmed { get; init; }
}

// Rush only. The veto's rooms did not take. Sent at most once per map, normally still in warmup.
// Reason: "no_reply" (our script is not installed), "rejected" (it refused the set, Detail says why)
// or "different" (it applied other rooms, Detail lists them).
public sealed record RushRoomsFailed(string Reason, IReadOnlyList<int> RushRooms) : MatchEvent("rush_rooms_failed")
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Detail { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? MapNumber { get; init; }
}

// Rush only. A round was played in another room than the veto picked, so the modified script did not take.
// Sent once per map, for the first round that differs.
public sealed record RushRoomsMismatch(int Round, string Expected, string Detected, IReadOnlyList<int> RushRooms) : MatchEvent("rush_rooms_mismatch")
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? MapNumber { get; init; }
}

public sealed record RoundEnd(int Round, string WinnerTeam, IReadOnlyDictionary<string, int> Score) : MatchEvent("round_end")
{
    // Rush only. Room id from rush_001.js such as "101" or "convoy". Null when unknown.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Arena { get; init; }

    // Series only. Rounds restart at 1 on each map.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? MapNumber { get; init; }
}

public sealed record MatchEnd(
    string WinnerTeam,
    IReadOnlyDictionary<string, int> Score,
    IReadOnlyList<PlayerStats> Players,
    bool DemoUploaded) : MatchEvent("match_end")
{
    // Series only. Score is then maps won per team and players are totals across all maps.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<MapSummary>? Maps { get; init; }
}

public sealed record MapSummary(int MapNumber, string MapId, string WinnerTeam, IReadOnlyDictionary<string, int> Score);

// Series only. Sent for every map, the last one included, before match_end.
public sealed record MapEnd(
    int MapNumber,
    string MapId,
    string WinnerTeam,
    IReadOnlyDictionary<string, int> Score,
    IReadOnlyList<PlayerStats> Players,
    bool DemoUploaded) : MatchEvent("map_end");

// One frag. Round is the round it happened in, counting from 1. Tick is the server tick.
public sealed record Kill(
    int Round,
    int Tick,
    string Attacker,
    string Victim,
    string Weapon,
    bool Headshot,
    bool Wallbang) : MatchEvent("kill")
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Assister { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? MapNumber { get; init; }
}

public sealed record MatchAbandoned(string Reason, IReadOnlyList<string> MissingSteamIds) : MatchEvent("match_abandoned");

// Sent once the demo upload after match_end or match_abandoned finishes.
public sealed record DemoUploaded(bool Ok) : MatchEvent("demo_uploaded")
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? Bytes { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? MapNumber { get; init; }
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
