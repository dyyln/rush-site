namespace RushsiteMatch.Core.Match;

// Aim modes. Keyed by config team name so a halftime side swap does not matter.
// Follows the game with mp_maxrounds 2N-1 and clinch on. The first team to N wins. If regulation runs out
// on unequal scores, which only draw rounds allow, the leader wins. A tie goes to overtime periods of
// overtimeMaxRounds rounds when that is above zero. A period is won by clinching half of it plus one,
// or by leading when it runs out. A tied period starts another one.
public sealed class FirstToScoreTracker
{
    private readonly int _target;
    private readonly int _overtimeRounds;
    private readonly Dictionary<string, int> _wins;

    public FirstToScoreTracker(int roundsToWin, IEnumerable<string> teams, int overtimeMaxRounds = 0)
    {
        _target = roundsToWin;
        _overtimeRounds = overtimeMaxRounds > 0 ? overtimeMaxRounds : 0;
        _wins = teams.ToDictionary(t => t, _ => 0);
    }

    public IReadOnlyDictionary<string, int> Wins => _wins;
    public string? DecidedWinner { get; private set; }
    // Only when overtime is off. Regulation ended level.
    public bool EndedTied { get; private set; }
    public int RoundsPlayed { get; private set; }
    public int RegulationRounds => _target * 2 - 1;
    public bool InOvertime => OvertimeBase is not null;
    // Each team's score when the current overtime period began.
    public int? OvertimeBase { get; private set; }
    // Rounds played when the current overtime period began.
    public int OvertimePeriodStart { get; private set; }
    public bool IsOver => DecidedWinner is not null || EndedTied;

    // Counts every round. Pass null for a draw. Returns the team that won the match with this round, or null.
    public string? RecordRound(string? winnerTeam)
    {
        if (IsOver) return null;
        RoundsPlayed++;
        if (winnerTeam is not null && _wins.ContainsKey(winnerTeam)) _wins[winnerTeam]++;
        Evaluate();
        return DecidedWinner;
    }

    private void Evaluate()
    {
        if (IsOver) return;
        if (OvertimeBase is null)
        {
            DecidedWinner = _wins.FirstOrDefault(kv => kv.Value >= _target).Key;
            if (DecidedWinner is not null || RoundsPlayed < RegulationRounds) return;
            DecidedWinner = Leader();
            if (DecidedWinner is null) StartPeriodOrEnd();
            return;
        }
        var need = _overtimeRounds / 2 + 1;
        DecidedWinner = _wins.FirstOrDefault(kv => kv.Value - OvertimeBase.Value >= need).Key;
        if (DecidedWinner is not null || RoundsPlayed - OvertimePeriodStart < _overtimeRounds) return;
        DecidedWinner = Leader();
        if (DecidedWinner is null) StartPeriodOrEnd();
    }

    private void StartPeriodOrEnd()
    {
        if (_overtimeRounds == 0)
        {
            EndedTied = true;
            return;
        }
        OvertimeBase = _wins.Values.Max();
        OvertimePeriodStart = RoundsPlayed;
    }

    private string? Leader()
    {
        var ordered = _wins.OrderByDescending(kv => kv.Value).ToList();
        if (ordered.Count < 2 || ordered[0].Value == ordered[1].Value) return null;
        return ordered[0].Key;
    }

    // Used after a plugin reload.
    public void Restore(IReadOnlyDictionary<string, int> wins, int roundsPlayed = 0, int? overtimeBase = null, int overtimePeriodStart = 0)
    {
        foreach (var t in _wins.Keys.ToList())
            _wins[t] = wins.TryGetValue(t, out var w) ? w : 0;
        RoundsPlayed = Math.Max(0, roundsPlayed);
        OvertimeBase = _overtimeRounds > 0 ? overtimeBase : null;
        OvertimePeriodStart = overtimePeriodStart;
        DecidedWinner = null;
        EndedTied = false;
        Evaluate();
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

    // Used after a plugin reload.
    public void Restore(int frontSlot, int tWins, int ctWins, int roundsPlayed, Side? decided)
    {
        if (decided is Side d && d.IsPlaying()) DecidedWinner = d;
        _slot = Math.Clamp(frontSlot, TCastleSlot, CtCastleSlot);
        _wins[Side.T] = Math.Max(0, tWins);
        _wins[Side.CT] = Math.Max(0, ctWins);
        RoundsPlayed = Math.Max(0, roundsPlayed);
        if (DecidedWinner is not null) return;
        if (_wins[Side.T] >= Config.WinCondition.RushRoundsToWin) DecidedWinner = Side.T;
        else if (_wins[Side.CT] >= Config.WinCondition.RushRoundsToWin) DecidedWinner = Side.CT;
    }
}
