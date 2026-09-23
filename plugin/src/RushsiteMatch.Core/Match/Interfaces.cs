namespace RushsiteMatch.Core.Match;

// Everything the controller needs from the game. The plugin implements it with CounterStrikeSharp.
public interface IGameServer
{
    void ExecuteCommand(string command);
    string? GetConVar(string name);
    void Kick(int userId, string reason);
    void PrintToAll(string message);
    void PrintToPlayer(string steamId, string message);
    void Log(string message);
    string CsgoDirectory { get; }

    // Current side of every connected human player.
    IReadOnlyList<(string SteamId, Side Side)> GetPlayerSides();

    // Best effort. ChangeTeam is a no-op on some CS2 builds so nothing may rely on it.
    void TryMovePlayer(string steamId, Side side);

    // Rush only. Room id of the current round or null.
    string? DetectRushArena();
}

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public interface IDemoUploader
{
    Task<DemoUploadResult> UploadAsync(string path, string presignedPutUrl, CancellationToken ct);
}

public sealed record DemoUploadResult(bool Ok, long? Bytes, string? Error)
{
    public static DemoUploadResult Success(long bytes) => new(true, bytes, null);
    public static DemoUploadResult Failed(string error, long? bytes = null) => new(false, bytes, error);
}

public sealed class MatchSettings
{
    public TimeSpan ConnectGrace { get; init; } = TimeSpan.FromMinutes(5);
    public TimeSpan DisconnectGrace { get; init; } = TimeSpan.FromMinutes(3);
    public TimeSpan ReadyTimeout { get; init; } = TimeSpan.FromMinutes(3);
    public TimeSpan MatchEndWait { get; init; } = TimeSpan.FromSeconds(10);
    public TimeSpan DemoStopExtra { get; init; } = TimeSpan.FromSeconds(5);
    public bool AimHalftime { get; init; }
    public bool PauseOnDisconnect { get; init; } = true;
    public bool KickBots { get; init; } = true;
    public bool TryChangeTeam { get; init; }
}
