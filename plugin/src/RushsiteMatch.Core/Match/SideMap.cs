using RushsiteMatch.Core.Config;

namespace RushsiteMatch.Core.Match;

// Tracks which side each config team is on. Nothing here moves players.
//
// Fixed mode (Rush). Each team's side comes from the config and never changes.
// Where players stand never changes the mapping. Rush has mp_halftime 0 so sides never swap.
//
// Observed mode (aim). A team's side is where most of its players stand. A tie keeps the previous side,
// so one player on the wrong side can never flip the mapping.
public sealed class SideMap
{
    private readonly MatchConfig _cfg;
    private readonly bool _fixed;
    private readonly Dictionary<string, Side> _playerSide = new();
    private readonly Dictionary<string, Side> _teamSide = new();

    public SideMap(MatchConfig cfg, bool fixedFromConfig = false)
    {
        _cfg = cfg;
        _fixed = fixedFromConfig;
        if (_fixed)
            foreach (var t in cfg.Teams) _teamSide[t.Name] = ConfiguredSide(t.Name);
    }

    public bool IsFixed => _fixed;

    public Side ConfiguredSide(string team) =>
        _cfg.ConfiguredSide(team) == TeamConfig.SideT ? Side.T : Side.CT;

    public Side SideOfPlayer(string steamId) =>
        _playerSide.TryGetValue(steamId, out var s) ? s : Side.None;

    public void SetPlayerSide(string steamId, Side side)
    {
        _playerSide[steamId] = side;
        var team = _cfg.TeamOf(steamId);
        if (team is not null && !_fixed) UpdateObservedTeamSide(team);
    }

    public void RemovePlayer(string steamId)
    {
        _playerSide.Remove(steamId);
    }

    private void UpdateObservedTeamSide(string team)
    {
        var members = _cfg.Teams.First(t => t.Name == team).SteamIds;
        var ct = members.Count(id => SideOfPlayer(id) == Side.CT);
        var t = members.Count(id => SideOfPlayer(id) == Side.T);
        if (ct > t) _teamSide[team] = Side.CT;
        else if (t > ct) _teamSide[team] = Side.T;
    }

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

    // Fixed mode returns the configured side.
    // Observed mode. Teammates already on a side decide it. Otherwise an opponent already on a side decides it.
    // Otherwise the configured side, which is teams[0] CT and teams[1] T by default.
    public Side? RequiredSide(string steamId)
    {
        var team = _cfg.TeamOf(steamId);
        if (team is null) return null;
        if (_fixed) return ConfiguredSide(team);
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

    public Side DefaultSide(string team) => ConfiguredSide(team);

    public bool IsJoinAllowed(string steamId, Side requested)
    {
        if (!requested.IsPlaying()) return requested == Side.Spectator;
        var required = RequiredSide(steamId);
        return required is null || required == requested;
    }

    // True when the player stands on the side their team must play.
    public bool IsOnRequiredSide(string steamId)
    {
        var s = SideOfPlayer(steamId);
        return s.IsPlaying() && RequiredSide(steamId) == s;
    }

    // True when every listed player is on a playing side, teammates share a side and the teams differ.
    // In fixed mode every player must also be on the configured side.
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
            if (_fixed && s != ConfiguredSide(team)) return false;
            if (sides.TryGetValue(team, out var existing) && existing != s) return false;
            sides[team] = s;
        }
        return sides.Values.Distinct().Count() == sides.Count;
    }
}
