using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Webhooks;

namespace RushsiteMatch.Tests;

public class WebhookSignerTests
{
    [Fact]
    public void MatchesReferenceHmac()
    {
        // Reference value computed with Python hmac and hashlib.
        var body = "{\"event\":{\"type\":\"server_ready\"}}";
        Assert.Equal("sha256=2995ee5561b06f8c2eb46c4de71bc9347d41ff7de7080137ea1789fc02586d09", WebhookSigner.Sign(body, "topsecret"));
    }

    [Fact]
    public void BodyForServerReadyIsExact()
    {
        Assert.Equal("{\"event\":{\"type\":\"server_ready\"}}", MatchEventJson.SerializeBody(new ServerReady()));
    }

    [Fact]
    public void VerifyRejectsTampering()
    {
        var sig = WebhookSigner.Sign("body", "s");
        Assert.True(WebhookSigner.Verify("body", "s", sig));
        Assert.False(WebhookSigner.Verify("body!", "s", sig));
        Assert.False(WebhookSigner.Verify("body", "t", sig));
    }
}

public class EventJsonTests
{
    [Fact]
    public void RoundEndShape()
    {
        var body = MatchEventJson.SerializeBody(new RoundEnd(3, "alpha", new Dictionary<string, int> { ["alpha"] = 2, ["bravo"] = 1 }));
        Assert.Equal("{\"event\":{\"type\":\"round_end\",\"round\":3,\"winnerTeam\":\"alpha\",\"score\":{\"alpha\":2,\"bravo\":1}}}", body);
    }

    [Fact]
    public void RoundEndIncludesArenaWhenKnown()
    {
        var body = MatchEventJson.SerializeBody(new RoundEnd(1, "alpha", new Dictionary<string, int>()) { Arena = "101" });
        Assert.Contains("\"arena\":\"101\"", body);
    }

    [Fact]
    public void MatchEndShape()
    {
        var evt = new MatchEnd("bravo", new Dictionary<string, int> { ["alpha"] = 4, ["bravo"] = 8 },
            new[] { new PlayerStats("76561198000000001", 10, 5, 4, 1234) }, true);
        Assert.Equal(
            "{\"event\":{\"type\":\"match_end\",\"winnerTeam\":\"bravo\",\"score\":{\"alpha\":4,\"bravo\":8}," +
            "\"players\":[{\"steamId\":\"76561198000000001\",\"kills\":10,\"deaths\":5,\"headshots\":4,\"damage\":1234}],\"demoUploaded\":true}}",
            MatchEventJson.SerializeBody(evt));
    }

    [Fact]
    public void OtherShapes()
    {
        Assert.Equal("{\"event\":{\"type\":\"player_connected\",\"steamId\":\"1\"}}", MatchEventJson.SerializeBody(new PlayerConnected("1")));
        Assert.Equal("{\"event\":{\"type\":\"player_disconnected\",\"steamId\":\"1\"}}", MatchEventJson.SerializeBody(new PlayerDisconnected("1")));
        Assert.Equal("{\"event\":{\"type\":\"match_started\"}}", MatchEventJson.SerializeBody(new MatchStarted()));
        Assert.Equal("{\"event\":{\"type\":\"match_abandoned\",\"reason\":\"no_show\",\"missingSteamIds\":[\"1\"]}}",
            MatchEventJson.SerializeBody(new MatchAbandoned("no_show", new[] { "1" })));
        Assert.Equal("{\"event\":{\"type\":\"demo_uploaded\",\"ok\":true,\"bytes\":123}}",
            MatchEventJson.SerializeBody(new DemoUploaded(true) { Bytes = 123 }));
        Assert.Equal("{\"event\":{\"type\":\"demo_uploaded\",\"ok\":false,\"error\":\"HTTP 403\"}}",
            MatchEventJson.SerializeBody(new DemoUploaded(false) { Error = "HTTP 403" }));
    }
}

public class WebhookDispatcherTests
{
    private sealed class FakeTransport : IHttpTransport
    {
        private readonly Queue<object> _script;
        public readonly List<(string Body, string Sig)> Calls = new();

        public FakeTransport(params object[] script) => _script = new Queue<object>(script);

        public Task<int> PostJsonAsync(string url, string body, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
        {
            lock (Calls) Calls.Add((body, headers[WebhookSigner.HeaderName]));
            var next = _script.Count > 0 ? _script.Dequeue() : 200;
            if (next is Exception e) throw e;
            return Task.FromResult((int)next);
        }
    }

    private static readonly Func<TimeSpan, CancellationToken, Task> NoDelay = (_, _) => Task.CompletedTask;

    [Fact]
    public async Task RetriesHeadBeforeSendingNextAndKeepsOrder()
    {
        var t = new FakeTransport(503, new HttpRequestException("down"), 200, 200);
        var log = new List<string>();
        await using var d = new WebhookDispatcher("u", "topsecret", t, new WebhookOptions { MaxAttempts = 5 }, log.Add, NoDelay);
        d.Enqueue(new ServerReady());
        d.Enqueue(new MatchStarted());
        Assert.True(await d.FlushAsync(TimeSpan.FromSeconds(5)));

        Assert.Equal(4, t.Calls.Count);
        Assert.All(t.Calls.Take(3), c => Assert.Contains("server_ready", c.Body));
        Assert.Contains("match_started", t.Calls[3].Body);
        Assert.All(t.Calls, c => Assert.Equal(WebhookSigner.Sign(c.Body, "topsecret"), c.Sig));
    }

    [Fact]
    public async Task DropsAfterMaxAttempts()
    {
        var t = new FakeTransport(500, 500, 500, 200);
        var log = new List<string>();
        await using var d = new WebhookDispatcher("u", "s", t, new WebhookOptions { MaxAttempts = 3 }, log.Add, NoDelay);
        d.Enqueue(new ServerReady());
        d.Enqueue(new MatchStarted());
        Assert.True(await d.FlushAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(4, t.Calls.Count);
        Assert.Contains(log, l => l.Contains("gave up"));
    }

    [Fact]
    public async Task DoesNotRetryClientErrors()
    {
        var t = new FakeTransport(401, 200);
        await using var d = new WebhookDispatcher("u", "s", t, new WebhookOptions(), _ => { }, NoDelay);
        d.Enqueue(new ServerReady());
        d.Enqueue(new MatchStarted());
        Assert.True(await d.FlushAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(2, t.Calls.Count);
    }

    [Fact]
    public async Task UsesExponentialBackoff()
    {
        var t = new FakeTransport(500, 500, 500, 500, 200);
        var waits = new List<TimeSpan>();
        var opts = new WebhookOptions { MaxAttempts = 10, BaseDelay = TimeSpan.FromSeconds(1), MaxDelay = TimeSpan.FromSeconds(5) };
        await using var d = new WebhookDispatcher("u", "s", t, opts, _ => { }, (w, _) => { waits.Add(w); return Task.CompletedTask; });
        d.Enqueue(new ServerReady());
        Assert.True(await d.FlushAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(new[] { 1.0, 2.0, 4.0, 5.0 }, waits.Select(w => w.TotalSeconds));
    }

    [Theory]
    [InlineData(500, true)]
    [InlineData(503, true)]
    [InlineData(429, true)]
    [InlineData(408, true)]
    [InlineData(400, false)]
    [InlineData(401, false)]
    [InlineData(404, false)]
    public void Retryable(int status, bool expected) => Assert.Equal(expected, WebhookDispatcher.IsRetryable(status));
}
