using RushsiteMatch.Core.Events;

namespace RushsiteMatch.Core.Stats;

// Counts only match players. Team membership comes from the config, not the in-game side,
// so it stays right across side swaps and reconnects.
public sealed class StatsAggregator
{
    private readonly Func<string, string?> _teamOf;
    private readonly List<string> _order;
    private readonly Dictionary<string, Line> _lines = new();

    private sealed class Line
    {
        public int Kills, Deaths, Headshots, Damage;
    }

    public StatsAggregator(IEnumerable<string> steamIds, Func<string, string?> teamOf)
    {
        _teamOf = teamOf;
        _order = steamIds.ToList();
        foreach (var id in _order) _lines[id] = new Line();
    }

    public void RecordDeath(string? attacker, string victim, bool headshot)
    {
        if (_lines.TryGetValue(victim, out var v)) v.Deaths++;
        if (attacker is null || attacker == victim) return;
        if (!_lines.TryGetValue(attacker, out var a)) return;
        if (IsTeammate(attacker, victim)) return;
        a.Kills++;
        if (headshot) a.Headshots++;
    }

    // Damage to teammates and to self is not counted. Bots and unknown victims still count
    // because the attacker did real damage in a live round.
    public void RecordDamage(string? attacker, string? victim, int healthDamage)
    {
        if (attacker is null || healthDamage <= 0) return;
        if (!_lines.TryGetValue(attacker, out var a)) return;
        if (victim is not null && (attacker == victim || IsTeammate(attacker, victim))) return;
        a.Damage += healthDamage;
    }

    public void Reset()
    {
        foreach (var l in _lines.Values) l.Kills = l.Deaths = l.Headshots = l.Damage = 0;
    }

    public IReadOnlyList<PlayerStats> Snapshot() =>
        _order.Select(id =>
        {
            var l = _lines[id];
            return new PlayerStats(id, l.Kills, l.Deaths, l.Headshots, l.Damage);
        }).ToList();

    private bool IsTeammate(string a, string b)
    {
        var ta = _teamOf(a);
        return ta is not null && ta == _teamOf(b);
    }
}
