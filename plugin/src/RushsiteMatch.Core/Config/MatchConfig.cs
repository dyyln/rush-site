using System.Text.Json;
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

    // Optional. False means no tv_record and no upload on any map. Absent means record, as older APIs send.
    public bool? RecordDemo { get; init; }

    [JsonIgnore]
    public bool RecordsDemo => RecordDemo != false;

    public string WinCondition { get; init; } = "";

    // Optional. The map the server was launched on. Used to pick the aim loadout.
    public MapConfig? Map { get; init; }

    // Optional. Present only for a series such as a Bo3. Absent means one map.
    public SeriesConfig? Series { get; init; }

    // Optional. Brand name for the chat prefix and the site the match link points to.
    public BrandConfig? Brand { get; init; }

    // Optional. Word id of the match, such as brave-amber-falcon. The match link uses it over matchId.
    public string? Slug { get; init; }

    // Optional. Rush rooms for slots 1 to 5 from the website veto. A map entry's own rushRooms wins.
    // Kept as raw JSON so a bad value falls back to Valve's random draw instead of failing the match.
    public JsonElement? RushRooms { get; init; }

    [JsonIgnore]
    public WinCondition ParsedWinCondition { get; internal set; } = null!;

    public string? TeamOf(string steamId) =>
        Teams.FirstOrDefault(t => t.SteamIds.Contains(steamId))?.Name;

    public bool IsAllowed(string steamId) => AllowedSteamIds.Contains(steamId);

    public bool IsSeries => Series is not null;

    // Map entry for a 1-based map number. Falls back to the top level map.
    public MapConfig? MapAt(int mapNumber)
    {
        if (Series is not null && mapNumber >= 1 && mapNumber <= Series.Maps.Count) return Series.Maps[mapNumber - 1];
        return Map;
    }

    // Rush rooms for a 1-based map number, as written in match.json. Null when none were picked.
    public JsonElement? RushRoomsFor(int mapNumber) => MapAt(mapNumber)?.RushRooms ?? RushRooms;

    // Demo upload target for a 1-based map number.
    // The top level demoUpload describes the map the server was launched on.
    public DemoUploadConfig? DemoUploadFor(int mapNumber)
    {
        if (Series is null) return DemoUpload;
        var idx = mapNumber - 1;
        if (Series.DemoUploads is { } ups && idx >= 0 && idx < ups.Count && ups[idx] is { } d) return d;
        return mapNumber == Series.StartMapNumber ? DemoUpload : null;
    }

    // Team that plays CT on a 1-based map number, from the map entry's ctTeam. Null when unset or not a team name.
    public string? CtTeamFor(int mapNumber)
    {
        var ct = MapAt(mapNumber)?.CtTeam;
        return ct is not null && Teams.Any(t => t.Name == ct) ? ct : null;
    }

    // The map entry's ctTeam when it is set but names no team. Such a value is ignored.
    public string? InvalidCtTeamFor(int mapNumber)
    {
        var ct = MapAt(mapNumber)?.CtTeam;
        return ct is not null && CtTeamFor(mapNumber) is null ? ct : null;
    }

    // Side each team plays on a 1-based map number. The map entry's ctTeam decides when valid.
    // Otherwise teams[0] is CT and teams[1] is T unless a team sets side.
    // Fixed for the whole map. Never derived from where players stand.
    public string ConfiguredSide(string team, int mapNumber = 1)
    {
        var idx = Teams.FindIndex(t => t.Name == team);
        if (idx < 0) return "";
        if (CtTeamFor(mapNumber) is { } ct) return team == ct ? TeamConfig.SideCt : TeamConfig.SideT;
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

    // Optional. Shown in chat when set, such as a cup team name.
    public string? DisplayName { get; init; }

    public const string SideCt = "ct";
    public const string SideT = "t";

    public static string? NormalizeSide(string? s) => s?.Trim().ToLowerInvariant() switch
    {
        "ct" or "3" or "counterterrorist" or "counter-terrorist" => SideCt,
        "t" or "2" or "terrorist" => SideT,
        _ => null,
    };
}

public sealed class BrandConfig
{
    public string? Name { get; init; }
    // Web site root, such as https://example.gg. Match links are siteUrl/matches/<slug or matchId>.
    public string? SiteUrl { get; init; }
}

public sealed class DemoUploadConfig
{
    public string Bucket { get; init; } = "";
    public string Key { get; init; } = "";
    public string PresignedPutUrl { get; init; } = "";
}

public sealed class MapConfig
{
    public string Id { get; init; } = "";
    public string? DisplayName { get; init; }
    public string? WorkshopId { get; init; }
    public string? MapName { get; init; }
    // Optional. Overrides the plugin's default aim loadout for this map.
    public LoadoutConfig? Loadout { get; init; }
    // Optional. Rush rooms for slots 1 to 5 on this map. See MatchConfig.RushRooms.
    public JsonElement? RushRooms { get; init; }
    // Optional. Team name that plays CT on this map, the other team plays T. Wins over teams[].side.
    // A value that names no team is ignored and the match goes on with the team sides.
    public string? CtTeam { get; init; }

    // Console command that loads this map on a running server.
    public string? LoadCommand() =>
        !string.IsNullOrEmpty(WorkshopId) ? $"host_workshop_map {WorkshopId}"
        : !string.IsNullOrEmpty(MapName) ? $"changelevel {MapName}"
        : null;
}

public sealed class SeriesConfig
{
    public int BestOf { get; init; }
    // Full ordered map list, one entry per map of the series.
    public List<MapConfig> Maps { get; init; } = new();
    // 1-based. Above 1 only when the series resumes after a crash.
    public int StartMapNumber { get; init; } = 1;
    // Maps each team already won before StartMapNumber.
    public Dictionary<string, int> Wins { get; init; } = new();
    // One per map. Index is mapNumber - 1. Left out when recordDemo is false.
    public List<DemoUploadConfig?>? DemoUploads { get; init; } = new();

    public int WinsNeeded => BestOf / 2 + 1;
}

// Weapons use engine names such as weapon_ak47. A missing side value means nothing in that slot.
public sealed class LoadoutConfig
{
    public SideWeaponsConfig? Primary { get; init; }
    public SideWeaponsConfig? Secondary { get; init; }
    // "none", "kevlar" or "kevlar_helmet". Defaults to kevlar_helmet.
    public string? Armor { get; init; }
}

public sealed class SideWeaponsConfig
{
    public string? Ct { get; init; }
    public string? T { get; init; }
}

public static class Modes
{
    public const string Aim1v1 = "aim1v1";
    public const string Aim2v2 = "aim2v2";
    public const string Rush3v3 = "rush3v3";
    // Unrated Rush test queue with one player per side
    public const string Rush1v1 = "rush1v1";
    // Unrated Rush test queue with two players per side
    public const string Rush2v2 = "rush2v2";
    public static readonly IReadOnlySet<string> All = new HashSet<string> { Aim1v1, Aim2v2, Rush3v3, Rush1v1, Rush2v2 };
    public static readonly IReadOnlySet<string> Rush = new HashSet<string> { Rush3v3, Rush1v1, Rush2v2 };
}
