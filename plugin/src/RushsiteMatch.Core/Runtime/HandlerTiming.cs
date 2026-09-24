using System.Diagnostics;

namespace RushsiteMatch.Core.Runtime;

// Measures plugin handlers on the game thread and warns when one runs longer than the threshold.
// Each handler name warns once per map so a slow path does not flood the console.
public sealed class HandlerTiming
{
    private readonly Action<string> _warn;
    private readonly Func<long> _timestamp;
    private readonly double _ticksPerMs;
    private readonly HashSet<string> _warned = new();

    public HandlerTiming(TimeSpan threshold, Action<string> warn, Func<long>? timestamp = null, long? frequency = null)
    {
        Threshold = threshold;
        _warn = warn;
        _timestamp = timestamp ?? Stopwatch.GetTimestamp;
        _ticksPerMs = (frequency ?? Stopwatch.Frequency) / 1000.0;
    }

    public TimeSpan Threshold { get; set; }

    public void Run(string name, Action action)
    {
        var start = _timestamp();
        try
        {
            action();
        }
        finally
        {
            Report(name, start);
        }
    }

    public T Run<T>(string name, Func<T> action)
    {
        var start = _timestamp();
        try
        {
            return action();
        }
        finally
        {
            Report(name, start);
        }
    }

    // Returns true when this call logged a warning.
    public bool Report(string name, TimeSpan elapsed)
    {
        if (Threshold <= TimeSpan.Zero || elapsed < Threshold) return false;
        lock (_warned)
        {
            if (!_warned.Add(name)) return false;
        }
        _warn($"slow handler {name} took {elapsed.TotalMilliseconds:0} ms on the game thread " +
              $"(warns above {Threshold.TotalMilliseconds:0} ms). Later slow runs of {name} are not logged until the next map.");
        return true;
    }

    // Warnings start again on each map.
    public void NewMap()
    {
        lock (_warned) _warned.Clear();
    }

    private void Report(string name, long start)
    {
        var ms = (_timestamp() - start) / _ticksPerMs;
        Report(name, TimeSpan.FromMilliseconds(ms));
    }
}
