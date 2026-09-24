namespace RushsiteMatch.Core.Match;

// Everything the controller needs from the game. The plugin implements it with CounterStrikeSharp.
public interface IGameServer
{
    void ExecuteCommand(string command);
    string? GetConVar(string name);
    void Kick(int userId, string reason);
    void PrintToAll(string message);
    void PrintToPlayer(string steamId, string message);
    // Center screen text for every player. Plain text without colour codes.
    void PrintCenterToAll(string message);
    // In-game name of a connected player, or null.
    string? PlayerName(string steamId);
    void Log(string message);
    string CsgoDirectory { get; }

    // Current side of every connected human player.
    IReadOnlyList<(string SteamId, Side Side)> GetPlayerSides();

    // Best effort. ChangeTeam is a no-op on some CS2 builds so nothing may rely on it.
    void TryMovePlayer(string steamId, Side side);

    // Makes the player issue jointeam for this side, as if they had picked it in the team menu.
    // Must not run inside the jointeam listener that asked for it. The adapter defers it one frame.
    void ForceJoinTeam(string steamId, Side side);

    // Kicks a player on the server by SteamID64. Does nothing when the player is not found.
    void KickPlayer(string steamId, string reason);

    // Humans fully connected right now. Authorized is false until Steam has confirmed the id.
    // SteamId is the id the client claims, which is only trusted once Authorized is true.
    IReadOnlyList<ConnectedPlayer> ConnectedPlayers();

    // Rush only. Room id of the current round or null.
    string? DetectRushArena();

    // Name of the loaded map as the engine reports it, or null.
    string? CurrentMapName { get; }

    // Aim only. Strips weapons the player should not hold, except the knife, then gives what is missing.
    void ApplyLoadout(string steamId, PlayerLoadout loadout);
}

// What the plugin reads from player_death. Ids are null for bots, the world and unknown players.
public sealed record DeathInfo(
    string? Attacker,
    string? Victim,
    string? Assister,
    string? Weapon,
    bool Headshot,
    int Penetrated,
    int Tick);

public sealed record ConnectedPlayer(string SteamId, int UserId, bool Authorized);

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
    // Aim. Countdown that starts once every player is in and on their side.
    public TimeSpan StartCountdown { get; init; } = TimeSpan.FromSeconds(10);
    // Aim. mp_respawn_immunitytime.
    public TimeSpan AimSpawnImmunity { get; init; } = TimeSpan.FromSeconds(2);
    // Aim. Hand out the map loadout and strip everything else on spawn.
    public bool AimLoadout { get; init; } = true;
    // Aim. Overtime period length for a tied map. Zero turns overtime off.
    public int OvertimeMaxRounds { get; init; } = 6;
    public int OvertimeStartMoney { get; init; } = 16000;
    // Series. Minimum wait between a map ending and the next map loading.
    public TimeSpan SeriesMapBreak { get; init; } = TimeSpan.FromSeconds(30);
    // Series. The match is abandoned when the next map has not loaded by then.
    public TimeSpan MapLoadTimeout { get; init; } = TimeSpan.FromMinutes(5);
    public TimeSpan MatchEndWait { get; init; } = TimeSpan.FromSeconds(10);
    public TimeSpan DemoStopExtra { get; init; } = TimeSpan.FromSeconds(5);
    public bool AimHalftime { get; init; }
    public bool PauseOnDisconnect { get; init; } = true;
    public bool KickBots { get; init; } = true;
    // Kick every player once the result is decided and MatchEndKickDelay has passed.
    public bool KickOnMatchEnd { get; init; } = true;
    // Time the final score stays on screen before the kick.
    public TimeSpan MatchEndKickDelay { get; init; } = TimeSpan.FromSeconds(10);
    public bool TryChangeTeam { get; init; }
    // Rush. Wrong team joins a player may make before being kicked.
    public int TeamJoinRefusalsBeforeKick { get; init; } = 3;
    // Rush. Hold warmup with mp_warmup_pausetimer until every player is in and on their side.
    public bool HoldRushWarmup { get; init; } = true;
    // Rush. Send the veto's rushRooms to our rush_001.js on each map.
    public bool RushRooms { get; init; } = true;
}
