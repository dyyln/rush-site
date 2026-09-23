using RushsiteMatch.Core.Match;

namespace RushsiteMatch.Core.Demo;

// HTTP PUT of the .dem file to a presigned object storage URL.
public sealed class HttpDemoUploader : IDemoUploader
{
    private readonly Action<string> _log;
    private readonly int _attempts;
    private readonly TimeSpan _timeout;

    public HttpDemoUploader(Action<string> log, int attempts = 3, TimeSpan? timeout = null)
    {
        _log = log;
        _attempts = attempts;
        _timeout = timeout ?? TimeSpan.FromMinutes(10);
    }

    public async Task<DemoUploadResult> UploadAsync(string path, string presignedPutUrl, CancellationToken ct)
    {
        if (!await WaitForStableFileAsync(path, ct).ConfigureAwait(false))
        {
            return DemoUploadResult.Failed($"demo {path} not found or still growing");
        }
        string error = "no attempt made";
        long? size = null;
        using var http = new HttpClient { Timeout = _timeout };
        for (var attempt = 1; attempt <= _attempts; attempt++)
        {
            try
            {
                await using var file = File.OpenRead(path);
                size = file.Length;
                using var content = new StreamContent(file);
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                content.Headers.ContentLength = file.Length;
                using var res = await http.PutAsync(presignedPutUrl, content, ct).ConfigureAwait(false);
                if (res.IsSuccessStatusCode)
                {
                    _log($"demo uploaded ({file.Length} bytes).");
                    return DemoUploadResult.Success(file.Length);
                }
                error = $"HTTP {(int)res.StatusCode}";
                _log($"demo upload attempt {attempt} got {error}.");
                if ((int)res.StatusCode is >= 400 and < 500 and not 408 and not 429) return DemoUploadResult.Failed(error, size);
            }
            catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                error = e.Message;
                _log($"demo upload attempt {attempt} failed: {e.Message}");
            }
            if (attempt < _attempts) await Task.Delay(TimeSpan.FromSeconds(5 * attempt), ct).ConfigureAwait(false);
        }
        return DemoUploadResult.Failed(error, size);
    }

    // The engine flushes the file after tv_stoprecord. Wait until the size stops changing.
    private static async Task<bool> WaitForStableFileAsync(string path, CancellationToken ct)
    {
        long last = -1;
        for (var i = 0; i < 30; i++)
        {
            if (File.Exists(path))
            {
                var size = new FileInfo(path).Length;
                if (size > 0 && size == last) return true;
                last = size;
            }
            await Task.Delay(1000, ct).ConfigureAwait(false);
        }
        return false;
    }
}
