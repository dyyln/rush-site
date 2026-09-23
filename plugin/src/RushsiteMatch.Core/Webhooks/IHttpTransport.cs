namespace RushsiteMatch.Core.Webhooks;

public interface IHttpTransport
{
    // Returns the HTTP status code. Throws on network failure.
    Task<int> PostJsonAsync(string url, string body, IReadOnlyDictionary<string, string> headers, CancellationToken ct);
}

public sealed class HttpClientTransport : IHttpTransport, IDisposable
{
    private readonly HttpClient _http;

    public HttpClientTransport(TimeSpan timeout)
    {
        _http = new HttpClient { Timeout = timeout };
    }

    public async Task<int> PostJsonAsync(string url, string body, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };
        foreach (var (k, v) in headers) req.Headers.TryAddWithoutValidation(k, v);
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        return (int)res.StatusCode;
    }

    public void Dispose() => _http.Dispose();
}
