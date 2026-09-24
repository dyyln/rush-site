using System.Text.Json;

namespace RushsiteMatch.Core.Config;

public sealed class MatchConfigException : Exception
{
    public MatchConfigException(string message, Exception? inner = null) : base(message, inner) { }
}

public static class MatchConfigLoader
{
    public const string DefaultFileName = "match.json";
    public const string ConVarName = "rushsite_match_config";
    public const string MatchJsonEnv = "RUSHSITE_MATCH_JSON";
    public const string MatchDirEnv = "RUSHSITE_MATCH_DIR";
    public const string MatchIdEnv = "RUSHSITE_MATCH_ID";

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static MatchConfig LoadFile(string path)
    {
        if (!File.Exists(path)) throw new MatchConfigException($"match config not found at {path}");
        return Parse(File.ReadAllText(path));
    }

    public static MatchConfig Parse(string json)
    {
        MatchConfig? cfg;
        try
        {
            cfg = JsonSerializer.Deserialize<MatchConfig>(json, JsonOptions);
        }
        catch (JsonException e)
        {
            throw new MatchConfigException($"match config is not valid JSON: {e.Message}", e);
        }
        if (cfg is null) throw new MatchConfigException("match config is empty");
        Validate(cfg);
        return cfg;
    }

    private static void Validate(MatchConfig cfg)
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(cfg.MatchId)) errors.Add("matchId is required");
        if (!Modes.All.Contains(cfg.Mode)) errors.Add($"mode '{cfg.Mode}' is not one of {string.Join(", ", Modes.All)}");
        if (cfg.AllowedSteamIds.Count == 0) errors.Add("allowedSteamIds must not be empty");
        foreach (var id in cfg.AllowedSteamIds)
            if (!IsSteamId64(id)) errors.Add($"allowedSteamIds entry '{id}' is not a SteamID64");
        if (cfg.AllowedSteamIds.Distinct().Count() != cfg.AllowedSteamIds.Count) errors.Add("allowedSteamIds has duplicates");

        if (cfg.Teams.Count != 2) errors.Add("teams must have exactly 2 entries");
        if (cfg.Teams.Any(t => string.IsNullOrWhiteSpace(t.Name))) errors.Add("every team needs a name");
        if (cfg.Teams.Select(t => t.Name).Distinct().Count() != cfg.Teams.Count) errors.Add("team names must be unique");
        var teamIds = cfg.Teams.SelectMany(t => t.SteamIds).ToList();
        if (teamIds.Distinct().Count() != teamIds.Count) errors.Add("a steamId appears in more than one team");
        foreach (var id in teamIds)
            if (!cfg.AllowedSteamIds.Contains(id)) errors.Add($"team member {id} is not in allowedSteamIds");
        foreach (var id in cfg.AllowedSteamIds)
            if (!teamIds.Contains(id)) errors.Add($"allowed steamId {id} is not on any team");

        foreach (var t in cfg.Teams)
            if (t.Side is not null && TeamConfig.NormalizeSide(t.Side) is null)
                errors.Add($"team {t.Name} side '{t.Side}' must be 'ct' or 't'");
        if (cfg.Teams.Count == 2)
        {
            var s0 = TeamConfig.NormalizeSide(cfg.Teams[0].Side);
            var s1 = TeamConfig.NormalizeSide(cfg.Teams[1].Side);
            if (s0 is not null && s0 == s1) errors.Add("both teams have the same side");
        }

        if (string.IsNullOrEmpty(cfg.Password)) errors.Add("password is required");
        if (!Uri.TryCreate(cfg.WebhookUrl, UriKind.Absolute, out var hook) || (hook.Scheme != "http" && hook.Scheme != "https"))
            errors.Add("webhookUrl must be an absolute http(s) URL");
        if (string.IsNullOrEmpty(cfg.WebhookSecret)) errors.Add("webhookSecret is required");
        if (cfg.DemoUpload is null) errors.Add("demoUpload is required");
        else if (!string.IsNullOrEmpty(cfg.DemoUpload.PresignedPutUrl) && !Uri.TryCreate(cfg.DemoUpload.PresignedPutUrl, UriKind.Absolute, out _))
            errors.Add("demoUpload.presignedPutUrl must be an absolute URL");

        if (!WinCondition.TryParse(cfg.WinCondition, out var wc))
            errors.Add($"winCondition '{cfg.WinCondition}' must be 'valve_rush' or 'first_to_N'");
        else
        {
            cfg.ParsedWinCondition = wc;
            var isRushMode = Modes.Rush.Contains(cfg.Mode);
            if (isRushMode != (wc.Kind == WinConditionKind.ValveRush))
                errors.Add($"winCondition '{cfg.WinCondition}' does not fit mode '{cfg.Mode}'");
        }

        if (cfg.Map is not null) ValidateMap(cfg.Map, "map", errors);
        if (cfg.Series is not null) ValidateSeries(cfg, cfg.Series, errors);

        if (errors.Count > 0) throw new MatchConfigException("invalid match config: " + string.Join("; ", errors));
    }

    private static readonly System.Text.RegularExpressions.Regex MapNamePattern = new("^[A-Za-z0-9_]+$");

    private static void ValidateMap(MapConfig map, string where, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(map.Id)) errors.Add($"{where}.id is required");
        var hasWorkshop = !string.IsNullOrEmpty(map.WorkshopId);
        if (hasWorkshop && !map.WorkshopId!.All(char.IsAsciiDigit)) errors.Add($"{where}.workshopId must be digits");
        if (!string.IsNullOrEmpty(map.MapName) && !MapNamePattern.IsMatch(map.MapName)) errors.Add($"{where}.mapName is not a valid map name");
        if (map.LoadCommand() is null) errors.Add($"{where} needs a workshopId or a mapName");
        if (map.Loadout is { } l)
        {
            foreach (var (slot, w) in new[] { ("primary.ct", l.Primary?.Ct), ("primary.t", l.Primary?.T), ("secondary.ct", l.Secondary?.Ct), ("secondary.t", l.Secondary?.T) })
                if (!string.IsNullOrWhiteSpace(w) && !Match.Loadout.IsWeaponName(w.Trim()))
                    errors.Add($"{where}.loadout.{slot} '{w}' is not a weapon_ name");
            if (!Match.Loadout.TryParseArmor(l.Armor, out _))
                errors.Add($"{where}.loadout.armor must be none, kevlar or kevlar_helmet");
        }
    }

    private static void ValidateSeries(MatchConfig cfg, SeriesConfig s, List<string> errors)
    {
        if (s.BestOf < 1 || s.BestOf % 2 == 0) errors.Add("series.bestOf must be an odd number");
        if (s.Maps.Count != s.BestOf) errors.Add($"series.maps has {s.Maps.Count} entries but bestOf is {s.BestOf}");
        for (var i = 0; i < s.Maps.Count; i++) ValidateMap(s.Maps[i], $"series.maps[{i}]", errors);
        if (s.StartMapNumber < 1 || s.StartMapNumber > s.Maps.Count) errors.Add("series.startMapNumber is out of range");
        if (s.DemoUploads.Count > 0 && s.DemoUploads.Count != s.BestOf) errors.Add($"series.demoUploads has {s.DemoUploads.Count} entries but bestOf is {s.BestOf}");
        foreach (var d in s.DemoUploads)
            if (d is not null && !string.IsNullOrEmpty(d.PresignedPutUrl) && !Uri.TryCreate(d.PresignedPutUrl, UriKind.Absolute, out _))
                errors.Add("series.demoUploads presignedPutUrl must be an absolute URL");
        var teams = cfg.Teams.Select(t => t.Name).ToHashSet();
        foreach (var (team, wins) in s.Wins)
        {
            if (!teams.Contains(team)) errors.Add($"series.wins has unknown team '{team}'");
            if (wins < 0) errors.Add($"series.wins for '{team}' is negative");
        }
        if (s.BestOf >= 1 && s.Wins.Values.Any(w => w >= s.WinsNeeded)) errors.Add("series.wins already decides the series");
        if (s.Wins.Values.Where(w => w > 0).Sum() >= s.StartMapNumber) errors.Add("series.wins counts more maps than were played before startMapNumber");
    }

    public static bool IsSteamId64(string s) =>
        s.Length == 17 && s.All(char.IsAsciiDigit) && s.StartsWith("7656");

    // Order is RUSHSITE_MATCH_JSON, then the convar, then +rushsite_match_config on the command line,
    // then match.json in RUSHSITE_MATCH_DIR, then cfg/match.json. Relative paths resolve against the csgo directory.
    public static string ResolvePath(
        string? matchJsonEnv,
        string? conVarValue,
        IReadOnlyList<string> commandLine,
        string? matchDirEnv,
        string csgoDir)
    {
        string? chosen = null;
        if (!string.IsNullOrWhiteSpace(matchJsonEnv)) chosen = matchJsonEnv;
        if (chosen is null && !string.IsNullOrWhiteSpace(conVarValue)) chosen = conVarValue;
        if (chosen is null)
        {
            for (var i = 0; i < commandLine.Count - 1; i++)
            {
                if (commandLine[i] == "+" + ConVarName || commandLine[i] == "-" + ConVarName)
                {
                    chosen = commandLine[i + 1];
                    break;
                }
            }
        }
        if (chosen is null && !string.IsNullOrWhiteSpace(matchDirEnv)) chosen = Path.Combine(matchDirEnv.Trim(), DefaultFileName);
        chosen ??= Path.Combine("cfg", DefaultFileName);
        chosen = chosen.Trim().Trim('"');
        return Path.IsPathRooted(chosen) ? chosen : Path.GetFullPath(Path.Combine(csgoDir, chosen));
    }
}
