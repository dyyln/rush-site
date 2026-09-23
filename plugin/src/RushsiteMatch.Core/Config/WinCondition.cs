using System.Text.RegularExpressions;

namespace RushsiteMatch.Core.Config;

public enum WinConditionKind
{
    // The plugin runs warmup, ready-up and round rules itself.
    FirstTo,
    // Valve's map script runs the match. The plugin only observes and reports.
    ValveRush,
}

public sealed record WinCondition(WinConditionKind Kind, int RoundsToWin)
{
    public const string ValveRushId = "valve_rush";

    // Rush rules from rush_001.js. First to 8 or a round win in the enemy castle.
    public const int RushRoundsToWin = 8;
    public const int RushMaxRounds = 15;

    public bool PluginManagesMatch => Kind == WinConditionKind.FirstTo;

    // Max rounds of 2N-1 with clinch on guarantees a first to N finish without overtime.
    public int MaxRounds => Kind == WinConditionKind.FirstTo ? RoundsToWin * 2 - 1 : RushMaxRounds;

    private static readonly Regex FirstToPattern = new("^first_to_([0-9]{1,3})$", RegexOptions.Compiled);

    public static bool TryParse(string? value, out WinCondition condition)
    {
        condition = null!;
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (value == ValveRushId)
        {
            condition = new WinCondition(WinConditionKind.ValveRush, RushRoundsToWin);
            return true;
        }
        var m = FirstToPattern.Match(value);
        if (!m.Success) return false;
        var n = int.Parse(m.Groups[1].Value);
        if (n < 1) return false;
        condition = new WinCondition(WinConditionKind.FirstTo, n);
        return true;
    }
}
