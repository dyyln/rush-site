namespace RushsiteMatch.Core.Events;

public interface IEventSink
{
    // Must be thread safe. Events are delivered in the order they were enqueued.
    void Enqueue(MatchEvent evt);
}
