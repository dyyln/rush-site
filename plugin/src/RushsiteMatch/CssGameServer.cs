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

    // Runs jointeam as the player on the next frame so the jointeam listener sees it as a normal pick.
    public void ForceJoinTeam(string steamId, Side side)
    {
        if (!side.IsPlaying()) return;
        var team = (int)side;
        Server.NextFrame(() =>
        {
            var p = FindPlayer(steamId);
            if (p is null) return;
            try
            {
                p.ExecuteClientCommandFromServer($"jointeam {team}");
            }
            catch (Exception e)
            {
                _logger.LogWarning("jointeam for {SteamId} failed: {Message}", steamId, e.Message);
            }
        });
    }

    public void KickPlayer(string steamId, string reason)
    {
        var p = FindPlayer(steamId);
        if (p?.UserId is int uid) Kick(uid, reason);
    }

    public IReadOnlyList<ConnectedPlayer> ConnectedPlayers() =>
        HumanPlayers()
            .Where(p => p.UserId is not null && p.SteamID != 0)
            .Select(p => new ConnectedPlayer(
                p.AuthorizedSteamID?.SteamId64.ToString() ?? p.SteamID.ToString(),
                p.UserId!.Value,
                p.AuthorizedSteamID is not null))
            .ToList();

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

    public string? CurrentMapName
    {
        get
        {
            try
            {
                return Server.MapName;
            }
            catch
            {
                return null;
            }
        }
    }

    // Removes every weapon the loadout does not list, keeping the knife, then gives what is missing.
    // Owned weapons are matched by item definition index because some report another designer name.
    public void ApplyLoadout(string steamId, PlayerLoadout loadout)
    {
        var p = FindPlayer(steamId);
        if (p is null || !p.PawnIsAlive) return;
        try
        {
            var pawn = p.PlayerPawn.Value;
            if (pawn is null || !pawn.IsValid) return;
            var have = new HashSet<string>();
            var remove = new List<CBasePlayerWeapon>();
            foreach (var handle in pawn.WeaponServices?.MyWeapons ?? Enumerable.Empty<CHandle<CBasePlayerWeapon>>())
            {
                var w = handle.Value;
                if (w is null || !w.IsValid) continue;
                var name = w.DesignerName;
                if (WeaponItems.IsKnife(name)) continue;
                int def = w.AttributeManager.Item.ItemDefinitionIndex;
                var wanted = loadout.Weapons.FirstOrDefault(x => !have.Contains(x) && WeaponItems.Matches(x, name, def));
                if (wanted is not null) have.Add(wanted);
                else remove.Add(w);
            }
            if (remove.Count > 0)
            {
                // Switch to the knife first so no removed weapon is in hand.
                p.ExecuteClientCommand("slot3");
                foreach (var w in remove) w.Remove();
            }
            foreach (var w in loadout.Weapons.Where(x => !have.Contains(x))) p.GiveNamedItem(w);
            if (loadout.Armor == ArmorKind.KevlarHelmet) p.GiveNamedItem("item_assaultsuit");
            else if (loadout.Armor == ArmorKind.Kevlar) p.GiveNamedItem("item_kevlar");
        }
        catch (Exception e)
        {
            _logger.LogWarning("loadout for {SteamId} failed: {Message}", steamId, e.Message);
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

    // Fully connected humans. Controllers of players who left can linger, so the connection state is checked.
    public static IEnumerable<CCSPlayerController> HumanPlayers() =>
        Utilities.GetPlayers().Where(p => p is { IsValid: true, IsBot: false, IsHLTV: false }
                                          && p.Connected == PlayerConnectedState.Connected);

    private static IEnumerable<CCSPlayerController> HumanAndBotPlayers() =>
        Utilities.GetPlayers().Where(p => p is { IsValid: true, IsHLTV: false });

    private static CCSPlayerController? FindPlayer(string steamId) =>
        HumanPlayers().FirstOrDefault(p => p.SteamID.ToString() == steamId);
}
