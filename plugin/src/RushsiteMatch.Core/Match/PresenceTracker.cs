namespace RushsiteMatch.Core.Match;

// Tracks who is on the server and for how long each match player has been missing.
// Players who never connected count as missing since the tracker started.
public sealed class PresenceTracker
{
    private readonly List<string> _players;
    private readonly HashSet<string> _connected = new();
    private readonly HashSet<string> _everConnected = new();
    private readonly Dictionary<string, DateTimeOffset> _missingSince = new();

    public PresenceTracker(IEnumerable<string> players, DateTimeOffset now)
    {
        _players = players.ToList();
        foreach (var p in _players) _missingSince[p] = now;
    }

    public bool IsConnected(string steamId) => _connected.Contains(steamId);
    public bool AllConnected => _players.All(_connected.Contains);
    public IReadOnlyList<string> Missing => _players.Where(p => !_connected.Contains(p)).ToList();

    // Returns true when this is a change.
    public bool Connect(string steamId)
    {
        if (!_players.Contains(steamId) || !_connected.Add(steamId)) return false;
        _everConnected.Add(steamId);
        _missingSince.Remove(steamId);
        return true;
    }

    public bool Disconnect(string steamId, DateTimeOffset now)
    {
        if (!_connected.Remove(steamId)) return false;
        _missingSince[steamId] = now;
        return true;
    }

    // Series map change. Everyone counts as gone from now and must connect again.
    // Players who were in before keep their disconnect grace, not the connect grace.
    // Returns the players who were connected.
    public IReadOnlyList<string> ResetForMapChange(DateTimeOffset now)
    {
        var was = _players.Where(_connected.Contains).ToList();
        _connected.Clear();
        foreach (var p in _players) _missingSince[p] = now;
        return was;
    }

    // Players never seen who are past the connect grace.
    public IReadOnlyList<string> NoShows(DateTimeOffset now, TimeSpan connectGrace) =>
        _players.Where(p => !_everConnected.Contains(p) && now - _missingSince[p] >= connectGrace).ToList();

    // Players who connected, left, and stayed away past the disconnect grace.
    public IReadOnlyList<string> Departed(DateTimeOffset now, TimeSpan disconnectGrace) =>
        _players.Where(p => _everConnected.Contains(p) && !_connected.Contains(p) && now - _missingSince[p] >= disconnectGrace).ToList();
}
