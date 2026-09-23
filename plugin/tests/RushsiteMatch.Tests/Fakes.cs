using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;

namespace RushsiteMatch.Tests;

internal sealed class FakeGame : IGameServer
{
    public readonly List<string> Commands = new();
    public readonly List<(int UserId, string Reason)> Kicks = new();
    public readonly List<string> Chat = new();
    public readonly List<string> Logs = new();
    public readonly Dictionary<string, string> ConVars = new() { ["sv_password"] = "hunter2", ["tv_enable"] = "1", ["tv_delay"] = "0", ["bot_quota"] = "0" };
    public readonly Dictionary<string, Side> Sides = new();
    public readonly List<(string, Side)> Moves = new();
    public string? Arena;

    public void ExecuteCommand(string command) => Commands.Add(command);
    public string? GetConVar(string name) => ConVars.TryGetValue(name, out var v) ? v : null;
    public void Kick(int userId, string reason) => Kicks.Add((userId, reason));
    public void PrintToAll(string message) => Chat.Add(message);
    public void PrintToPlayer(string steamId, string message) => Chat.Add(steamId + ": " + message);
    public void Log(string message) => Logs.Add(message);
    public string CsgoDirectory => "/srv/cs2/game/csgo";
    public IReadOnlyList<(string SteamId, Side Side)> GetPlayerSides() => Sides.Select(kv => (kv.Key, kv.Value)).ToList();
    public void TryMovePlayer(string steamId, Side side) => Moves.Add((steamId, side));
    public string? DetectRushArena() => Arena;
}

internal sealed class FakeSink : IEventSink
{
    public readonly List<MatchEvent> Events = new();
    public void Enqueue(MatchEvent evt)
    {
        lock (Events) Events.Add(evt);
    }
    public IEnumerable<string> Types { get { lock (Events) return Events.Select(e => e.Type).ToList(); } }
    public T Last<T>() where T : MatchEvent { lock (Events) return Events.OfType<T>().Last(); }
}

internal sealed class FakeClock : IClock
{
    public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.UnixEpoch;
    public void Advance(double seconds) => UtcNow = UtcNow.AddSeconds(seconds);
}

internal sealed class FakeUploader : IDemoUploader
{
    public DemoUploadResult Result = DemoUploadResult.Success(4096);
    public readonly List<(string Path, string Url)> Calls = new();
    public Task<DemoUploadResult> UploadAsync(string path, string presignedPutUrl, CancellationToken ct)
    {
        Calls.Add((path, presignedPutUrl));
        return Task.FromResult(Result);
    }
}
