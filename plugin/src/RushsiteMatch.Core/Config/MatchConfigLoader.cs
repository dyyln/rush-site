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
            var isRushMode = cfg.Mode == Modes.Rush3v3;
            if (isRushMode != (wc.Kind == WinConditionKind.ValveRush))
                errors.Add($"winCondition '{cfg.WinCondition}' does not fit mode '{cfg.Mode}'");
        }

        if (errors.Count > 0) throw new MatchConfigException("invalid match config: " + string.Join("; ", errors));
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
