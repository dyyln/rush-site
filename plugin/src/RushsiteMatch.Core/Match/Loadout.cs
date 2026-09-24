using System.Globalization;
using System.Text.RegularExpressions;
using RushsiteMatch.Core.Config;

namespace RushsiteMatch.Core.Match;

public enum ArmorKind
{
    None,
    Kevlar,
    KevlarHelmet,
}

// What one player should hold after spawning. The knife is always kept and never listed.
public sealed record PlayerLoadout(IReadOnlyList<string> Weapons, ArmorKind Armor);

// Aim mode loadout for one map. A null weapon means that slot stays empty.
public sealed record Loadout(string? CtPrimary, string? TPrimary, string? CtSecondary, string? TSecondary, ArmorKind Armor)
{
    public const string ArmorNone = "none";
    public const string ArmorKevlar = "kevlar";
    public const string ArmorKevlarHelmet = "kevlar_helmet";

    private static readonly Regex WeaponPattern = new("^weapon_[a-z0-9_]+$", RegexOptions.Compiled);

    public static bool IsWeaponName(string? s) => s is not null && WeaponPattern.IsMatch(s);

    public static bool TryParseArmor(string? s, out ArmorKind armor)
    {
        armor = ArmorKind.KevlarHelmet;
        switch (s)
        {
            case null or ArmorKevlarHelmet: return true;
            case ArmorKevlar: armor = ArmorKind.Kevlar; return true;
            case ArmorNone: armor = ArmorKind.None; return true;
            default: return false;
        }
    }

    // Expects a config that passed validation.
    public static Loadout FromConfig(LoadoutConfig c)
    {
        TryParseArmor(c.Armor, out var armor);
        return new Loadout(Blank(c.Primary?.Ct), Blank(c.Primary?.T), Blank(c.Secondary?.Ct), Blank(c.Secondary?.T), armor);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    public PlayerLoadout For(Side side)
    {
        var weapons = new List<string>();
        var primary = side == Side.T ? TPrimary : CtPrimary;
        var secondary = side == Side.T ? TSecondary : CtSecondary;
        if (primary is not null) weapons.Add(primary);
        if (secondary is not null) weapons.Add(secondary);
        return new PlayerLoadout(weapons, Armor);
    }

    // Server convars that hand out this loadout and stop buying.
    // They must run after mode.cfg, which turns buying on.
    public IReadOnlyList<string> ConVarCommands() => new[]
    {
        $"mp_ct_default_primary \"{CtPrimary ?? ""}\"",
        $"mp_t_default_primary \"{TPrimary ?? ""}\"",
        $"mp_ct_default_secondary \"{CtSecondary ?? ""}\"",
        $"mp_t_default_secondary \"{TSecondary ?? ""}\"",
        "mp_ct_default_grenades \"\"",
        "mp_t_default_grenades \"\"",
        $"mp_free_armor {(Armor switch { ArmorKind.KevlarHelmet => 2, ArmorKind.Kevlar => 1, _ => 0 })}",
        "mp_buytime 0",
        "mp_buy_anywhere 0",
        "mp_weapons_allow_map_placed 0",
    };

    public static string SpawnImmunityCommand(TimeSpan t) =>
        "mp_respawn_immunitytime " + Math.Max(0, t.TotalSeconds).ToString("0.##", CultureInfo.InvariantCulture);
}

// Default aim loadouts by map. The API can override one per map with a loadout in match.json.
public static class AimLoadouts
{
    private const string Ak = "weapon_ak47";
    private const string M4 = "weapon_m4a1";
    private const string Usp = "weapon_usp_silencer";
    private const string Glock = "weapon_glock";
    private const string Deagle = "weapon_deagle";
    private const string Awp = "weapon_awp";

    public static readonly Loadout Rifles = new(M4, Ak, Usp, Glock, ArmorKind.KevlarHelmet);
    public static readonly Loadout UspOnly = new(null, null, Usp, Usp, ArmorKind.KevlarHelmet);
    public static readonly Loadout DeagleOnly = new(null, null, Deagle, Deagle, ArmorKind.KevlarHelmet);
    public static readonly Loadout AwpOnly = new(Awp, Awp, null, null, ArmorKind.KevlarHelmet);

    // Keys are shared map ids and the bsp names they load.
    public static readonly IReadOnlyDictionary<string, Loadout> ByMap = new Dictionary<string, Loadout>(StringComparer.OrdinalIgnoreCase)
    {
        ["aim_map"] = Rifles,
        ["aim_redline"] = Rifles,
        ["aim_ag_texture2"] = Rifles,
        ["aim_usp"] = UspOnly,
        ["aim_deagle7k"] = DeagleOnly,
        ["aim_deagle"] = DeagleOnly,
        ["awp_india"] = AwpOnly,
    };

    // Order is the map's own loadout, then the table by map id, then by map name,
    // then by the map the server reports, then rifles.
    public static Loadout Resolve(MapConfig? map, string? serverMapName)
    {
        if (map?.Loadout is not null) return Loadout.FromConfig(map.Loadout);
        foreach (var key in new[] { map?.Id, map?.MapName, serverMapName })
        {
            if (string.IsNullOrWhiteSpace(key)) continue;
            if (ByMap.TryGetValue(key, out var l)) return l;
            // Workshop bsp names often carry a suffix such as aim_redline_cs2.
            var prefix = ByMap.Keys.Where(k => key.StartsWith(k + "_", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(k => k.Length).FirstOrDefault();
            if (prefix is not null) return ByMap[prefix];
        }
        return Rifles;
    }
}

// Item definition indexes. Some weapons report another weapon's designer name in CS2,
// for example the USP-S shows as weapon_hkp2000, so owned weapons are matched by index when known.
public static class WeaponItems
{
    public static readonly IReadOnlyDictionary<string, int> DefIndex = new Dictionary<string, int>
    {
        ["weapon_deagle"] = 1,
        ["weapon_elite"] = 2,
        ["weapon_fiveseven"] = 3,
        ["weapon_glock"] = 4,
        ["weapon_ak47"] = 7,
        ["weapon_aug"] = 8,
        ["weapon_awp"] = 9,
        ["weapon_famas"] = 10,
        ["weapon_galilar"] = 13,
        ["weapon_m4a1"] = 16,
        ["weapon_tec9"] = 30,
        ["weapon_hkp2000"] = 32,
        ["weapon_p250"] = 36,
        ["weapon_sg556"] = 39,
        ["weapon_ssg08"] = 40,
        ["weapon_m4a1_silencer"] = 60,
        ["weapon_usp_silencer"] = 61,
        ["weapon_cz75a"] = 63,
        ["weapon_revolver"] = 64,
    };

    public static bool IsKnife(string? designerName) =>
        designerName is not null && (designerName.Contains("knife", StringComparison.Ordinal) || designerName == "weapon_bayonet");

    public static bool Matches(string wanted, string? designerName, int defIndex)
    {
        if (DefIndex.TryGetValue(wanted, out var idx) && defIndex > 0) return idx == defIndex;
        return wanted == designerName;
    }
}
