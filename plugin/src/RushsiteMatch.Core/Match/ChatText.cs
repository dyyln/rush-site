using System.Text;
using RushsiteMatch.Core.Config;

namespace RushsiteMatch.Core.Match;

// CS2 chat colour codes. Values match CounterStrikeSharp ChatColors.
public static class ChatColor
{
    public const char Default = '\x01';
    public const char Green = '\x04';
    public const char Grey = '\x08';
    public const char Purple = '\x0E';
    public const char LightRed = '\x0F';
    public const char Gold = '\x10';

    // Removes colour codes and other control characters. Used for logs, kick reasons and center text.
    public static string Strip(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
            if (!char.IsControl(c)) sb.Append(c);
        return sb.ToString();
    }
}

// Picks which remaining seconds of a countdown get announced. Ticks can skip a second,
// so a mark counts as reached once the time left is at or below it.
public static class CountdownMarks
{
    // Start countdown. Every ten seconds above ten, then each of the last five.
    public static bool IsStartMark(int seconds) => seconds <= 5 || seconds % 10 == 0;

    // Disconnect grace. Every minute, then 30 and 10 seconds.
    public static bool IsGraceMark(int seconds) => seconds % 60 == 0 || seconds == 30 || seconds == 10;

    // True when a mark lies in [left, lastSaid). lastSaid is the last value announced.
    public static bool Due(int left, int lastSaid, Func<int, bool> isMark)
    {
        if (left <= 0) return false;
        var top = Math.Min(lastSaid, left + 3600);
        for (var s = left; s < top; s++)
            if (isMark(s)) return true;
        return false;
    }
}

// Chat lines the match plugin prints. Brand, team labels and the match link come from match.json.
public sealed class MatchMessages
{
    public const string DefaultBrand = "DuelRush";

    private readonly MatchConfig _cfg;

    public MatchMessages(MatchConfig cfg)
    {
        _cfg = cfg;
        BrandName = CleanText(cfg.Brand?.Name, 24) is { Length: > 0 } n ? n : DefaultBrand;
        MatchUrl = BuildMatchUrl(cfg);
    }

    public string BrandName { get; }
    public string? MatchUrl { get; }

    // A leading space is needed or CS2 drops the first colour code.
    public string Prefix => $" {ChatColor.Purple}[{BrandName}]{ChatColor.Default}";

    public static string? BuildMatchUrl(MatchConfig cfg)
    {
        var site = cfg.Brand?.SiteUrl?.Trim();
        if (string.IsNullOrEmpty(site)) return null;
        if (!Uri.TryCreate(site, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https")) return null;
        var id = !string.IsNullOrWhiteSpace(cfg.Slug) ? cfg.Slug.Trim() : cfg.MatchId;
        if (string.IsNullOrEmpty(id)) return null;
        return $"{site.TrimEnd('/')}/matches/{Uri.EscapeDataString(id)}";
    }

    // Player names and brand text with control characters removed and a length cap.
    public static string CleanText(string? s, int max)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var t = ChatColor.Strip(s).Trim();
        return t.Length > max ? t[..max] : t;
    }

    public static string Clock(TimeSpan t)
    {
        var total = Math.Max(0, (int)Math.Ceiling(t.TotalSeconds));
        return $"{total / 60}:{total % 60:00}";
    }

    private static string Hi(string s) => $"{ChatColor.Gold}{s}{ChatColor.Default}";
    private static string Warn(string s) => $"{ChatColor.LightRed}{s}{ChatColor.Default}";
    private static string Good(string s) => $"{ChatColor.Green}{s}{ChatColor.Default}";

    public string Line(string text) => $"{Prefix} {text}";

    public string TeamLabel(string team)
    {
        var t = _cfg.Teams.FirstOrDefault(x => x.Name == team);
        var display = CleanText(t?.DisplayName, 32);
        return display.Length > 0 ? display : $"Team {team}";
    }

    // Team colours follow the site. The first team is purple and the second is amber.
    private string TeamColored(string team)
    {
        var idx = _cfg.Teams.FindIndex(t => t.Name == team);
        var colour = idx == 0 ? ChatColor.Purple : idx == 1 ? ChatColor.Gold : ChatColor.Default;
        return $"{colour}{TeamLabel(team)}{ChatColor.Default}";
    }

    // Team A 13 - 7 Team B, in config order.
    public string ScoreLine(IReadOnlyDictionary<string, int> score, bool plain = false)
    {
        if (_cfg.Teams.Count != 2) return string.Join(" ", score.Select(kv => $"{kv.Key} {kv.Value}"));
        var a = _cfg.Teams[0].Name;
        var b = _cfg.Teams[1].Name;
        var sa = score.GetValueOrDefault(a);
        var sb = score.GetValueOrDefault(b);
        return plain
            ? $"{TeamLabel(a)} {sa}-{sb} {TeamLabel(b)}"
            : $"{TeamColored(a)} {Hi(sa.ToString())} - {Hi(sb.ToString())} {TeamColored(b)}";
    }

    private string WinnerText(string winner) =>
        winner == Events.MatchEventJson.Draw ? "It is a draw." : $"Winner: {TeamColored(winner)}.";

    // Start countdown

    public string CountdownStarted(string what, int seconds) =>
        Line($"All players are in. {what} starts in {Hi(seconds.ToString())} seconds.");

    public string CountdownTick(string what, int seconds) =>
        Line($"{what} starts in {Hi(seconds.ToString())}.");

    public static string CountdownCenter(string what, int seconds) => $"{what} starts in {seconds}";

    public string CountdownCancelled(IReadOnlyList<string> left, IReadOnlyList<string> switched)
    {
        var why = new List<string>();
        if (left.Count > 0) why.Add($"{Names(left)} left the server.");
        if (switched.Count > 0) why.Add($"{Names(switched)} switched side.");
        if (why.Count == 0) why.Add("A player left or switched side.");
        return Line($"{Warn("Countdown stopped.")} {string.Join(" ", why)} It starts again once everyone is in and on their side.");
    }

    private static string Names(IReadOnlyList<string> names) =>
        names.Count == 1 ? Hi(names[0]) : string.Join(", ", names.Take(names.Count - 1).Select(Hi)) + " and " + Hi(names[^1]);

    // Disconnects

    public string Disconnected(string name, TimeSpan left, bool pausing) =>
        Line($"{Warn(name + " disconnected.")} {Hi(Clock(left))} to return or they forfeit." +
             (pausing ? " The match pauses at the next freeze time." : ""));

    public static string DisconnectedCenter(string name, TimeSpan left) => $"{name} disconnected. {Clock(left)} to return";

    // One entry of the live countdown. Name is null for a player who was never on the server, so the team
    // label stands in for it. Joined is false for a player who has not been in yet.
    public sealed record Missing(string? Name, string Team, TimeSpan Left, bool Joined);

    // Center screen countdown for the players still missing, soonest forfeit first. Players on the same
    // clock share one entry, and unnamed players from one team count as one, so no clock repeats.
    // At most three entries.
    public static string MissingCenter(IReadOnlyList<Missing> missing)
    {
        var groups = missing
            .GroupBy(m => ((int)Math.Ceiling(m.Left.TotalSeconds), m.Joined))
            .OrderBy(g => g.Key.Item1)
            .Select(g => (Who: Who(g.ToList()), Left: g.Min(m => m.Left), Joined: g.Key.Joined, Count: g.Count()))
            .ToList();
        if (groups.Count == 1)
        {
            var g = groups[0];
            return g.Joined ? $"{g.Who} left. {Clock(g.Left)} to return or forfeit" : $"Waiting for {g.Who} to join. {Clock(g.Left)}";
        }
        var shown = groups.Take(3).Select(g => $"{g.Who} {Clock(g.Left)}");
        var rest = groups.Skip(3).Sum(g => g.Count);
        var more = rest > 0 ? $" and {rest} more" : "";
        return $"Waiting for {string.Join(", ", shown)}{more}";
    }

    // "Al, Bob and 2 players from Team bravo". Named players first, then the unnamed ones per team.
    private static string Who(IReadOnlyList<Missing> group)
    {
        var parts = group.Where(m => m.Name is not null).Select(m => m.Name!).ToList();
        foreach (var team in group.Where(m => m.Name is null).GroupBy(m => m.Team))
            parts.Add(team.Count() == 1 ? $"a player from {team.Key}" : $"{team.Count()} players from {team.Key}");
        return parts.Count == 1 ? parts[0] : string.Join(", ", parts.Take(parts.Count - 1)) + " and " + parts[^1];
    }

    // One line for every player whose forfeit clock reached the same mark
    public string StillAway(IReadOnlyList<string> names, TimeSpan left) =>
        Line($"{Names(names)} {(names.Count == 1 ? "has" : "have")} {Warn(Clock(left))} left to return or they forfeit.");

    public string Returned(string name, bool unpausing) =>
        Line($"{Good(name + " is back.")}" + (unpausing ? " All players are in. Unpausing." : ""));

    // Map and match end

    public string MapOver(int mapNumber, string mapName, string winner, IReadOnlyDictionary<string, int> score,
        IReadOnlyDictionary<string, int> seriesWins, string? nextMap, int waitSeconds) =>
        Line($"Map {mapNumber} ({mapName}) over. {ScoreLine(score)}. {WinnerText(winner)} " +
             $"Series {ScoreLine(seriesWins)}." +
             (nextMap is null ? "" : $" Next map {Hi(nextMap)} in {waitSeconds} seconds."));

    public string MatchOver(string winner, IReadOnlyDictionary<string, int> score) =>
        Line($"Match over. {ScoreLine(score)}. {WinnerText(winner)}");

    public string SeriesOver(string winner, IReadOnlyDictionary<string, int> wins) =>
        Line($"Series over. {ScoreLine(wins)}. {WinnerText(winner)}");

    public string SeriesMapLine(MapResult r, string mapName) =>
        Line($"Map {r.MapNumber} {mapName}: {ScoreLine(r.Score)}");

    public string? LinkLine() => MatchUrl is null ? null : Line($"Match page: {Hi(MatchUrl)}");

    public string ClosingIn(int seconds) => Line($"The server closes in {seconds} seconds.");

    // Kick reasons show in the disconnect dialog. No colour codes.
    public string KickReason(IReadOnlyDictionary<string, int> score, bool series) =>
        $"{(series ? "Series" : "Match")} over. {ScoreLine(score, plain: true)}. Thanks for playing.";
}
