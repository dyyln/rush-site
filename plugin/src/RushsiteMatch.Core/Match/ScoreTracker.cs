namespace RushsiteMatch.Core.Match;

// Aim modes. Keyed by config team name so a halftime side swap does not matter.
public sealed class FirstToScoreTracker
{
    private readonly int _target;
    private readonly Dictionary<string, int> _wins;

    public FirstToScoreTracker(int roundsToWin, IEnumerable<string> teams)
    {
        _target = roundsToWin;
        _wins = teams.ToDictionary(t => t, _ => 0);
    }

    public IReadOnlyDictionary<string, int> Wins => _wins;
    public string? DecidedWinner { get; private set; }

    // Returns the team that won the match with this round, or null.
    public string? RecordRound(string? winnerTeam)
    {
        if (DecidedWinner is not null || winnerTeam is null || !_wins.ContainsKey(winnerTeam)) return null;
        _wins[winnerTeam]++;
        if (_wins[winnerTeam] >= _target) DecidedWinner = winnerTeam;
        return DecidedWinner;
    }
}

// Mirrors the round and match logic of Valve's rush_001.js without changing anything in game.
// T win moves the front one slot toward the CT castle and CT win moves it back.
// A round won in the enemy castle, or 8 round wins, wins the match. Max 15 rounds.
public sealed class RushScoreTracker
{
    public const int TCastleSlot = 0;
    public const int CtCastleSlot = 6;
    public const int StartSlot = 3;

    private readonly Dictionary<Side, int> _wins = new() { [Side.T] = 0, [Side.CT] = 0 };
    private int _slot = StartSlot;

    public int RoundsPlayed { get; private set; }
    public IReadOnlyDictionary<Side, int> Wins => _wins;
    public Side? DecidedWinner { get; private set; }
    // Room slot the next round is played in.
    public int FrontSlot => _slot;

    // True when the next round is the 7 to 7 decider played in Convoy.
    public bool NextIsDecider => _wins[Side.T] == 7 && _wins[Side.CT] == 7;

    public Side? RecordRound(Side winner)
    {
        RoundsPlayed++;
        if (DecidedWinner is not null || !winner.IsPlaying()) return null;
        _wins[winner]++;

        if (winner == Side.T)
        {
            if (_slot == CtCastleSlot) DecidedWinner = Side.T;
            else _slot++;
        }
        else
        {
            if (_slot == TCastleSlot) DecidedWinner = Side.CT;
            else _slot--;
        }

        if (DecidedWinner is null && _wins[winner] >= Config.WinCondition.RushRoundsToWin) DecidedWinner = winner;
        return DecidedWinner;
    }
}
