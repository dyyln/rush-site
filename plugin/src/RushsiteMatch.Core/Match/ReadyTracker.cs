namespace RushsiteMatch.Core.Match;

public enum ReadyResult
{
    Ok,
    AlreadyReady,
    NotReady,
    NotAPlayer,
    NotInWarmup,
    WrongSide,
}

// Aim modes only. Rush warmup is run by Valve's script.
public sealed class ReadyTracker
{
    private readonly HashSet<string> _players;
    private readonly HashSet<string> _ready = new();

    public ReadyTracker(IEnumerable<string> players)
    {
        _players = players.ToHashSet();
    }

    public bool IsOpen { get; private set; } = true;
    public IReadOnlyCollection<string> Ready => _ready;

    public ReadyResult SetReady(string steamId, bool onValidSide)
    {
        if (!IsOpen) return ReadyResult.NotInWarmup;
        if (!_players.Contains(steamId)) return ReadyResult.NotAPlayer;
        if (!onValidSide) return ReadyResult.WrongSide;
        return _ready.Add(steamId) ? ReadyResult.Ok : ReadyResult.AlreadyReady;
    }

    public ReadyResult SetUnready(string steamId)
    {
        if (!IsOpen) return ReadyResult.NotInWarmup;
        if (!_players.Contains(steamId)) return ReadyResult.NotAPlayer;
        return _ready.Remove(steamId) ? ReadyResult.Ok : ReadyResult.NotReady;
    }

    public void Drop(string steamId) => _ready.Remove(steamId);

    public bool AllReady => _players.All(_ready.Contains);

    public IEnumerable<string> NotReady => _players.Where(p => !_ready.Contains(p));

    public void Close() => IsOpen = false;
}
