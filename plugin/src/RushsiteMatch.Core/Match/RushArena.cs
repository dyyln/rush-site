namespace RushsiteMatch.Core.Match;

public readonly record struct Vec3(float X, float Y, float Z)
{
    public float DistanceSquared(Vec3 o)
    {
        var dx = X - o.X;
        var dy = Y - o.Y;
        var dz = Z - o.Z;
        return dx * dx + dy * dy + dz * dz;
    }
}

public static class RushArena
{
    // rush_001 marks each room with a target named t1room.<id>.
    public const string RoomTargetPrefix = "t1room.";

    public static string? RoomIdFromTargetName(string? name) =>
        name is not null && name.StartsWith(RoomTargetPrefix, StringComparison.Ordinal) && name.Length > RoomTargetPrefix.Length
            ? name[RoomTargetPrefix.Length..]
            : null;

    // Picks the room whose target is closest to the most T spawn positions.
    public static string? Detect(IReadOnlyList<Vec3> tPositions, IReadOnlyList<(string RoomId, Vec3 Pos)> rooms)
    {
        if (tPositions.Count == 0 || rooms.Count == 0) return null;
        return tPositions
            .Select(p => rooms.MinBy(r => r.Pos.DistanceSquared(p)).RoomId)
            .GroupBy(id => id)
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key, StringComparer.Ordinal)
            .First().Key;
    }
}
