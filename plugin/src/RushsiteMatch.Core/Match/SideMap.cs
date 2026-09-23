using RushsiteMatch.Core.Config;

namespace RushsiteMatch.Core.Match;

// Tracks which side each config team is on from what players are observed doing.
// Nothing here moves players. That keeps it working while ChangeTeam is broken.
public sealed class SideMap
{
    private readonly MatchConfig _cfg;
    private readonly Dictionary<string, Side> _playerSide = new();
    private readonly Dictionary<string, Side> _teamSide = new();

    public SideMap(MatchConfig cfg)
    {
        _cfg = cfg;
    }

    public Side SideOfPlayer(string steamId) =>
        _playerSide.TryGetValue(steamId, out var s) ? s : Side.None;

    public void SetPlayerSide(string steamId, Side side)
    {
        _playerSide[steamId] = side;
        var team = _cfg.TeamOf(steamId);
        if (team is not null && side.IsPlaying()) _teamSide[team] = side;
    }

    public void RemovePlayer(string steamId) => _playerSide.Remove(steamId);

    public Side SideOfTeam(string team)
    {
        if (_teamSide.TryGetValue(team, out var s)) return s;
        var other = _cfg.Teams.FirstOrDefault(t => t.Name != team)?.Name;
        if (other is not null && _teamSide.TryGetValue(other, out var o)) return o.Opposite();
        return Side.None;
    }

    public string? TeamOnSide(Side side)
    {
        if (!side.IsPlaying()) return null;
        foreach (var t in _cfg.Teams)
            if (SideOfTeam(t.Name) == side) return t.Name;
        return null;
    }

    // Aim modes hold each team to one side without moving anyone.
    // Teammates already on a side decide it. Otherwise an opponent already on a side decides it.
    // Otherwise teams[0] defaults to CT and teams[1] to T, matching mp_teamname_1 and mp_teamname_2.
    public Side? RequiredSide(string steamId)
    {
        var team = _cfg.TeamOf(steamId);
        if (team is null) return null;
        var mates = _cfg.Teams.First(t => t.Name == team).SteamIds.Where(id => id != steamId);
        foreach (var m in mates)
        {
            var s = SideOfPlayer(m);
            if (s.IsPlaying()) return s;
        }
        foreach (var opp in _cfg.Teams.Where(t => t.Name != team).SelectMany(t => t.SteamIds))
        {
            var s = SideOfPlayer(opp);
            if (s.IsPlaying()) return s.Opposite();
        }
        return DefaultSide(team);
    }

    public Side DefaultSide(string team) =>
        _cfg.Teams.Count > 0 && _cfg.Teams[0].Name == team ? Side.CT : Side.T;

    public bool IsJoinAllowed(string steamId, Side requested)
    {
        if (!requested.IsPlaying()) return requested == Side.Spectator;
        var required = RequiredSide(steamId);
        return required is null || required == requested;
    }

    // True when every listed player is on a playing side, teammates share a side and the teams differ.
    public bool TeamsAreValid(IEnumerable<string> steamIds)
    {
        var ids = steamIds.ToList();
        var sides = new Dictionary<string, Side>();
        foreach (var id in ids)
        {
            var s = SideOfPlayer(id);
            if (!s.IsPlaying()) return false;
            var team = _cfg.TeamOf(id);
            if (team is null) return false;
            if (sides.TryGetValue(team, out var existing) && existing != s) return false;
            sides[team] = s;
        }
        return sides.Values.Distinct().Count() == sides.Count;
    }
}
