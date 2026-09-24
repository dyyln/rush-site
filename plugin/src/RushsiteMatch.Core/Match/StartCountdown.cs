namespace RushsiteMatch.Core.Match;

public enum CountdownChange
{
    None,
    Started,
    Cancelled,
    Fired,
}

// Every mode. Replaces ready-up. The countdown runs while every player is in and on their side,
// goes back to waiting when that stops being true, and fires once when it runs out.
// With mayFire false it stays at zero and fires on a later update. Rush uses that to wait for the rooms.
public sealed class StartCountdown
{
    private readonly TimeSpan _length;

    public StartCountdown(TimeSpan length)
    {
        _length = length < TimeSpan.Zero ? TimeSpan.Zero : length;
    }

    public DateTimeOffset? Deadline { get; private set; }
    public bool Running => Deadline is not null && !Fired;
    public bool Fired { get; private set; }

    public CountdownChange Update(bool lineupComplete, DateTimeOffset now, bool mayFire = true)
    {
        if (Fired) return CountdownChange.None;
        if (!lineupComplete)
        {
            if (Deadline is null) return CountdownChange.None;
            Deadline = null;
            return CountdownChange.Cancelled;
        }
        if (Deadline is null)
        {
            Deadline = now + _length;
            if (_length > TimeSpan.Zero) return CountdownChange.Started;
        }
        if (now < Deadline || !mayFire) return CountdownChange.None;
        Fired = true;
        return CountdownChange.Fired;
    }

    // Whole seconds left, rounded up. Zero when not running.
    public int SecondsLeft(DateTimeOffset now) =>
        Running ? Math.Max(0, (int)Math.Ceiling((Deadline!.Value - now).TotalSeconds)) : 0;

    // Stops for good, for example when an admin forces the start.
    public void Close()
    {
        Deadline = null;
        Fired = true;
    }

    // Back to waiting, for the next map of a series.
    public void Reset()
    {
        Deadline = null;
        Fired = false;
    }
}
