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

    // One entry of the live countdown. Joined is false for a player who has not been in yet.
    public sealed record Missing(string Name, TimeSpan Left, bool Joined);

    // Center screen countdown for the players still missing, soonest forfeit first. At most three names.
    public static string MissingCenter(IReadOnlyList<Missing> missing)
    {
        if (missing.Count == 1)
        {
            var m = missing[0];
            return m.Joined ? $"{m.Name} left. {Clock(m.Left)} to return or forfeit" : $"Waiting for {m.Name} to join. {Clock(m.Left)}";
        }
        var shown = missing.OrderBy(m => m.Left).Take(3).Select(m => $"{m.Name} {Clock(m.Left)}");
        var more = missing.Count > 3 ? $" and {missing.Count - 3} more" : "";
        return $"Waiting for {string.Join(", ", shown)}{more}";
    }

    public string StillAway(string name, TimeSpan left) =>
        Line($"{Hi(name)} has {Warn(Clock(left))} left to return or they forfeit.");

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
