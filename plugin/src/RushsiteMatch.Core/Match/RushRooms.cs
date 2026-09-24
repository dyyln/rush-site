using System.Text.Json;

namespace RushsiteMatch.Core.Match;

// Rooms picked in the website veto for one Rush map. See docs/RUSH-ROOM-VETO.md.
// Slots 1 to 5 sit between the castles: 1 and 2 mid, 3 start, 4 and 5 mid. Slot 0 is the T castle and 6 the CT castle.
// Our modified rush_001.js (plugin/rush-script) takes them from server console chat. ent_fire from the
// console does nothing on a dedicated server, so script inputs are not used. Without that script the chat
// line does nothing and Valve's random draw stands, which the per round check then reports.
public sealed class RushRoomPlan
{
    public const int TCastle = 401;
    public const int CtCastle = 301;
    public const string DeciderRoom = "convoy";
    public const int PickedSlots = 5;
    public const int StartRoomSlot = 3;

    public static readonly IReadOnlySet<int> StartRooms = new HashSet<int> { 101, 102, 103, 104 };
    public static readonly IReadOnlySet<int> MidRooms = Enumerable.Range(201, 12).ToHashSet();

    // Chat prefix our rush_001.js listens for. Must match its OnPlayerChat handler.
    public const string ChatCommand = "rushsite_rooms";

    // Room ids for slots 1 to 5, in order.
    public IReadOnlyList<int> Slots { get; }

    private RushRoomPlan(IReadOnlyList<int> slots) => Slots = slots;

    // Room id for slots 0 to 6, castles included.
    public int RoomAt(int slot) => slot switch
    {
        RushScoreTracker.TCastleSlot => TCastle,
        RushScoreTracker.CtCastleSlot => CtCastle,
        _ => Slots[slot - 1],
    };

    public IReadOnlyList<int> Path => Enumerable.Range(RushScoreTracker.TCastleSlot, RushScoreTracker.CtCastleSlot + 1).Select(RoomAt).ToList();

    // Reads rushRooms straight from match.json. False with no error when it is absent or null.
    public static bool TryParse(JsonElement? json, out RushRoomPlan? plan, out string? error)
    {
        plan = null;
        error = null;
        if (json is not { } el || el.ValueKind == JsonValueKind.Null) return false;
        if (el.ValueKind != JsonValueKind.Array)
        {
            error = "rushRooms is not an array";
            return false;
        }
        var ids = new List<int>();
        foreach (var item in el.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var n)) ids.Add(n);
            else if (item.ValueKind == JsonValueKind.String && int.TryParse(item.GetString(), out var s)) ids.Add(s);
            else
            {
                error = $"rushRooms entry {item.GetRawText()} is not a room id";
                return false;
            }
        }
        return TryParse(ids, out plan, out error);
    }

    // Slot 3 takes a start room and the others a mid room, as in Valve's ROOM_IDS.
    // Placing any room in any slot is untested (step 5 of the test plan), so it is refused for now.
    public static bool TryParse(IReadOnlyList<int>? ids, out RushRoomPlan? plan, out string? error)
    {
        plan = null;
        error = null;
        if (ids is null) return false;
        if (ids.Count != PickedSlots)
        {
            error = $"rushRooms has {ids.Count} entries, needs {PickedSlots}";
            return false;
        }
        if (ids.Distinct().Count() != ids.Count)
        {
            error = "rushRooms has duplicates";
            return false;
        }
        for (var i = 0; i < ids.Count; i++)
        {
            var slot = i + 1;
            var pool = slot == StartRoomSlot ? StartRooms : MidRooms;
            if (!pool.Contains(ids[i]))
            {
                error = $"rushRooms slot {slot} has {ids[i]}, needs a {(slot == StartRoomSlot ? "start room 101-104" : "mid room 201-212")}";
                return false;
            }
        }
        plan = new RushRoomPlan(ids.ToList());
        return true;
    }

    // Server console chat the script reads. Only chat with no player behind it counts, so players cannot fake it.
    public string Command() => $"say {ChatCommand} {string.Join(",", Slots)}";

    // Room the round at this front slot should be played in. Null for the 7 to 7 decider, which is Valve's Convoy.
    public string? ExpectedArena(int frontSlot, bool decider) =>
        decider ? null : RoomAt(Math.Clamp(frontSlot, RushScoreTracker.TCastleSlot, RushScoreTracker.CtCastleSlot)).ToString();

    public override string ToString() => string.Join(",", Slots);
}
