namespace RushsiteMatch.Core.Match;

// Values match the engine team numbers.
public enum Side
{
    None = 0,
    Spectator = 1,
    T = 2,
    CT = 3,
}

public static class SideExtensions
{
    public static bool IsPlaying(this Side s) => s is Side.T or Side.CT;

    public static Side Opposite(this Side s) => s switch
    {
        Side.T => Side.CT,
        Side.CT => Side.T,
        _ => Side.None,
    };

    public static Side FromTeamNum(int n) => n switch
    {
        2 => Side.T,
        3 => Side.CT,
        1 => Side.Spectator,
        _ => Side.None,
    };
}
