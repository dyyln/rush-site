using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Utils;
using Microsoft.Extensions.Logging;
using RushsiteMatch.Core.Match;

namespace RushsiteMatch;

// IGameServer backed by CounterStrikeSharp. Only call from the game thread.
// Avoids ChangeTeam, Teleport and entity listeners, which are broken on CS2 1.41.8.2
// with CounterStrikeSharp 1.0.374 and older.
public sealed class CssGameServer : IGameServer
{
    private readonly ILogger _logger;
    private readonly Func<bool> _tryChangeTeam;

    public CssGameServer(ILogger logger, Func<bool> tryChangeTeam)
    {
        _logger = logger;
        _tryChangeTeam = tryChangeTeam;
    }

    public string CsgoDirectory => Path.Combine(Server.GameDirectory, "csgo");

    public void ExecuteCommand(string command) => Server.ExecuteCommand(command);

    public string? GetConVar(string name)
    {
        var cv = ConVar.Find(name);
        if (cv is null) return null;
        try
        {
            return cv.Type switch
            {
                ConVarType.Bool => cv.GetPrimitiveValue<bool>() ? "1" : "0",
                ConVarType.Int16 => cv.GetPrimitiveValue<short>().ToString(),
                ConVarType.UInt16 => cv.GetPrimitiveValue<ushort>().ToString(),
                ConVarType.Int32 => cv.GetPrimitiveValue<int>().ToString(),
                ConVarType.UInt32 => cv.GetPrimitiveValue<uint>().ToString(),
                ConVarType.Int64 => cv.GetPrimitiveValue<long>().ToString(),
                ConVarType.UInt64 => cv.GetPrimitiveValue<ulong>().ToString(),
                ConVarType.Float32 => cv.GetPrimitiveValue<float>().ToString(System.Globalization.CultureInfo.InvariantCulture),
                ConVarType.Float64 => cv.GetPrimitiveValue<double>().ToString(System.Globalization.CultureInfo.InvariantCulture),
                _ => cv.StringValue,
            };
        }
        catch (Exception e)
        {
            _logger.LogWarning("could not read convar {Name}: {Message}", name, e.Message);
            return null;
        }
    }

    public void Kick(int userId, string reason) =>
        Server.ExecuteCommand($"kickid {userId} \"{reason.Replace("\"", "")}\"");

    public void PrintToAll(string message) => Server.PrintToChatAll(message);

    public void PrintToPlayer(string steamId, string message) => FindPlayer(steamId)?.PrintToChat(message);

    public void Log(string message) => _logger.LogInformation("{Message}", message);

    public IReadOnlyList<(string SteamId, Side Side)> GetPlayerSides() =>
        HumanPlayers().Select(p => (p.SteamID.ToString(), SideExtensions.FromTeamNum(p.TeamNum))).ToList();

    public void TryMovePlayer(string steamId, Side side)
    {
        if (!_tryChangeTeam() || !side.IsPlaying()) return;
        var p = FindPlayer(steamId);
        if (p is null) return;
        try
        {
            p.ChangeTeam(side == Side.T ? CsTeam.Terrorist : CsTeam.CounterTerrorist);
        }
        catch (Exception e)
        {
            _logger.LogWarning("ChangeTeam failed: {Message}", e.Message);
        }
    }

    // Finds the room whose t1room.<id> target is nearest the living T players.
    // Falls back to info_player_terrorist spawns when no pawn is available.
    public string? DetectRushArena()
    {
        try
        {
            var rooms = new List<(string, Vec3)>();
            var tSpawns = new List<Vec3>();
            foreach (var ent in Utilities.GetAllEntities())
            {
                if (!ent.IsValid) continue;
                var name = ent.Entity?.Name;
                var roomId = RushArena.RoomIdFromTargetName(name);
                if (roomId is not null)
                {
                    var pos = Origin(ent);
                    if (pos is not null) rooms.Add((roomId, pos.Value));
                }
                else if (ent.DesignerName == "info_player_terrorist" && name is not null && name.StartsWith("tspawn", StringComparison.Ordinal))
                {
                    var pos = Origin(ent);
                    if (pos is not null) tSpawns.Add(pos.Value);
                }
            }
            var tPawns = HumanAndBotPlayers()
                .Where(p => p.TeamNum == (byte)CsTeam.Terrorist && p.PawnIsAlive)
                .Select(p => p.PlayerPawn.Value?.AbsOrigin)
                .Where(v => v is not null)
                .Select(v => new Vec3(v!.X, v.Y, v.Z))
                .ToList();
            return RushArena.Detect(tPawns.Count > 0 ? tPawns : tSpawns, rooms);
        }
        catch (Exception e)
        {
            _logger.LogWarning("arena detection failed: {Message}", e.Message);
            return null;
        }
    }

    public static bool IsWarmup()
    {
        try
        {
            var rules = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules").FirstOrDefault()?.GameRules;
            return rules?.WarmupPeriod ?? false;
        }
        catch
        {
            return false;
        }
    }

    private static Vec3? Origin(CEntityInstance ent)
    {
        var v = new CBaseEntity(ent.Handle).AbsOrigin;
        return v is null ? null : new Vec3(v.X, v.Y, v.Z);
    }

    public static IEnumerable<CCSPlayerController> HumanPlayers() =>
        Utilities.GetPlayers().Where(p => p is { IsValid: true, IsBot: false, IsHLTV: false });

    private static IEnumerable<CCSPlayerController> HumanAndBotPlayers() =>
        Utilities.GetPlayers().Where(p => p is { IsValid: true, IsHLTV: false });

    private static CCSPlayerController? FindPlayer(string steamId) =>
        HumanPlayers().FirstOrDefault(p => p.SteamID.ToString() == steamId);
}
