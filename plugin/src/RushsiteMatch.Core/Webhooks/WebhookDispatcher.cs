using RushsiteMatch.Core.Events;

namespace RushsiteMatch.Core.Webhooks;

public sealed class WebhookOptions
{
    public int MaxAttempts { get; init; } = 10;
    public TimeSpan BaseDelay { get; init; } = TimeSpan.FromSeconds(1);
    public TimeSpan MaxDelay { get; init; } = TimeSpan.FromSeconds(30);
}

// One background worker drains a FIFO queue. The head event is retried with
// exponential backoff before the next one is sent, so the API sees events in order.
public sealed class WebhookDispatcher : IEventSink, IAsyncDisposable
{
    private readonly string _url;
    private readonly string _secret;
    private readonly IHttpTransport _transport;
    private readonly WebhookOptions _options;
    private readonly Action<string> _log;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly Queue<MatchEvent> _queue = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _worker;
    private int _inFlight;

    public WebhookDispatcher(
        string url,
        string secret,
        IHttpTransport transport,
        WebhookOptions options,
        Action<string> log,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _url = url;
        _secret = secret;
        _transport = transport;
        _options = options;
        _log = log;
        _delay = delay ?? Task.Delay;
        _worker = Task.Run(RunAsync);
    }

    public int Pending
    {
        get { lock (_queue) return _queue.Count + _inFlight; }
    }

    public void Enqueue(MatchEvent evt)
    {
        lock (_queue) _queue.Enqueue(evt);
        _signal.Release();
    }

    public static TimeSpan BackoffFor(int attempt, WebhookOptions o)
    {
        var ms = o.BaseDelay.TotalMilliseconds * Math.Pow(2, Math.Max(0, attempt - 1));
        return TimeSpan.FromMilliseconds(Math.Min(ms, o.MaxDelay.TotalMilliseconds));
    }

    public static bool IsRetryable(int status) =>
        status >= 500 || status == 408 || status == 429;

    // Waits until the queue is empty or the timeout passes.
    public async Task<bool> FlushAsync(TimeSpan timeout)
    {
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            if (Pending == 0) return true;
            await Task.Delay(50).ConfigureAwait(false);
        }
        return Pending == 0;
    }

    private async Task RunAsync()
    {
        var ct = _cts.Token;
        while (!ct.IsCancellationRequested)
        {
            try { await _signal.WaitAsync(ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }

            MatchEvent evt;
            lock (_queue)
            {
                if (_queue.Count == 0) continue;
                evt = _queue.Dequeue();
                _inFlight = 1;
            }
            try { await DeliverAsync(evt, ct).ConfigureAwait(false); }
            finally { lock (_queue) _inFlight = 0; }
        }
    }

    private async Task DeliverAsync(MatchEvent evt, CancellationToken ct)
    {
        var body = MatchEventJson.SerializeBody(evt);
        var headers = new Dictionary<string, string> { [WebhookSigner.HeaderName] = WebhookSigner.Sign(body, _secret) };
        for (var attempt = 1; attempt <= _options.MaxAttempts; attempt++)
        {
            string failure;
            try
            {
                var status = await _transport.PostJsonAsync(_url, body, headers, ct).ConfigureAwait(false);
                if (status is >= 200 and < 300) return;
                if (!IsRetryable(status))
                {
                    _log($"webhook {evt.Type} rejected with HTTP {status}. Dropping it.");
                    return;
                }
                failure = $"HTTP {status}";
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                failure = e.GetType().Name + ": " + e.Message;
            }

            if (attempt == _options.MaxAttempts) break;
            var wait = BackoffFor(attempt, _options);
            _log($"webhook {evt.Type} attempt {attempt} failed ({failure}). Retrying in {wait.TotalSeconds:0.#}s.");
            try { await _delay(wait, ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
        }
        _log($"webhook {evt.Type} gave up after {_options.MaxAttempts} attempts. Dropping it.");
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        try { await _worker.ConfigureAwait(false); } catch { }
        _cts.Dispose();
        _signal.Dispose();
    }
}
