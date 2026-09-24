using RushsiteMatch.Core.Events;

namespace RushsiteMatch.Core.Match;

public sealed record MapResult(int MapNumber, string MapId, string WinnerTeam, IReadOnlyDictionary<string, int> Score);

// Map wins and player totals across a series. Map numbers are 1-based.
// A map with no winner (draw) credits nobody. The series is over once a team has a majority
// or the last map is played. Then the team with more map wins takes it, or it is a draw.
public sealed class SeriesTracker
{
    private readonly List<string> _teams;
    private readonly Dictionary<string, int> _wins;
    private readonly List<MapResult> _results = new();
    private readonly List<string> _playerOrder;
    private readonly Dictionary<string, PlayerStats> _totals = new();

    public SeriesTracker(int bestOf, IEnumerable<string> teams, IEnumerable<string> players, int startMapNumber = 1,
        IReadOnlyDictionary<string, int>? wins = null)
    {
        BestOf = bestOf;
        _teams = teams.ToList();
        _wins = _teams.ToDictionary(t => t, t => wins is not null && wins.TryGetValue(t, out var w) ? w : 0);
        _playerOrder = players.ToList();
        foreach (var p in _playerOrder) _totals[p] = new PlayerStats(p, 0, 0, 0, 0);
        MapNumber = Math.Clamp(startMapNumber, 1, Math.Max(1, bestOf));
    }

    public int BestOf { get; }
    public int WinsNeeded => BestOf / 2 + 1;
    // The map being played, or the one that just ended until Advance is called.
    public int MapNumber { get; private set; }
    public IReadOnlyDictionary<string, int> Wins => _wins;
    public IReadOnlyList<MapResult> Results => _results;
    public bool IsOver { get; private set; }

    public string? Leader
    {
        get
        {
            var ordered = _wins.OrderByDescending(kv => kv.Value).ToList();
            if (ordered.Count < 2 || ordered[0].Value == ordered[1].Value) return null;
            return ordered[0].Key;
        }
    }

    public string? Winner => _wins.FirstOrDefault(kv => kv.Value >= WinsNeeded).Key;

    // Records the map that just ended. Returns true when the series is over.
    public bool RecordMap(string mapId, string winnerTeam, IReadOnlyDictionary<string, int> score, IEnumerable<PlayerStats> players)
    {
        if (IsOver) return true;
        if (_wins.ContainsKey(winnerTeam)) _wins[winnerTeam]++;
        _results.Add(new MapResult(MapNumber, mapId, winnerTeam, new Dictionary<string, int>(score)));
        foreach (var p in players)
        {
            if (!_totals.TryGetValue(p.SteamId, out var t)) continue;
            _totals[p.SteamId] = t with
            {
                Kills = t.Kills + p.Kills,
                Deaths = t.Deaths + p.Deaths,
                Headshots = t.Headshots + p.Headshots,
                Damage = t.Damage + p.Damage,
            };
        }
        IsOver = Winner is not null || MapNumber >= BestOf;
        return IsOver;
    }

    // Moves to the next map. Returns false when there is none.
    public bool Advance()
    {
        if (IsOver || MapNumber >= BestOf) return false;
        MapNumber++;
        return true;
    }

    public string FinalWinner => Winner ?? Leader ?? MatchEventJson.Draw;

    public IReadOnlyList<PlayerStats> Totals() => _playerOrder.Select(id => _totals[id]).ToList();

    // Used after a plugin reload.
    public void Restore(int mapNumber, IReadOnlyDictionary<string, int>? wins, IEnumerable<MapResult>? results,
        IEnumerable<PlayerStats>? totals, bool isOver)
    {
        MapNumber = Math.Clamp(mapNumber, 1, Math.Max(1, BestOf));
        if (wins is not null)
            foreach (var t in _teams) _wins[t] = wins.TryGetValue(t, out var w) ? w : 0;
        _results.Clear();
        if (results is not null) _results.AddRange(results);
        if (totals is not null)
            foreach (var p in totals)
                if (_totals.ContainsKey(p.SteamId)) _totals[p.SteamId] = p;
        IsOver = isOver;
    }
}
