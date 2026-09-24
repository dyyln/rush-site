using System.Text.Json;
using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;

namespace RushsiteMatch.Core.State;

// Minimal match state written next to match.json so a plugin reload mid match can pick up where it left off.
public sealed class MatchState
{
    public int Version { get; init; } = 1;
    public string MatchId { get; init; } = "";
    public string Phase { get; init; } = "";
    public int Round { get; init; }
    public Dictionary<string, int> Score { get; init; } = new();
    public bool Recording { get; init; }
    public string? Arena { get; init; }
    // Rush. True once rush_rooms_mismatch went out for this map.
    public bool? RushRoomsMismatchSent { get; init; }
    // Rush. Our script confirmed the rooms, or rush_rooms_failed went out, for this map.
    public bool? RushRoomsConfirmed { get; init; }
    public bool? RushRoomsFailedSent { get; init; }
    // Rush only. Mirror of the rush_001.js front and wins per side.
    public int? RushFrontSlot { get; init; }
    public int? RushTWins { get; init; }
    public int? RushCtWins { get; init; }
    public int? RushRoundsPlayed { get; init; }
    // "T" or "CT" once the Rush mirror has decided the match.
    public string? RushDecided { get; init; }
    public List<PlayerStats> Players { get; init; } = new();
    // Aim overtime. Score each team had when the current period began, and the round it began on.
    public int? OvertimeBase { get; init; }
    public int? OvertimePeriodStart { get; init; }
    // Series only.
    public int? MapNumber { get; init; }
    public Dictionary<string, int>? SeriesWins { get; init; }
    public List<MapResult>? MapResults { get; init; }
    public List<PlayerStats>? SeriesPlayers { get; init; }
    public bool? SeriesOver { get; init; }
    public DateTimeOffset SavedAt { get; init; }
}

public interface IMatchStateStore
{
    void Save(MatchState state);
    MatchState? Load();
}

// Writes the state atomically to a json file. Errors are reported through the log callback and never thrown.
public sealed class FileMatchStateStore : IMatchStateStore
{
    public const string FileName = "match_state.json";

    private readonly string _path;
    private readonly Action<string> _log;

    public FileMatchStateStore(string path, Action<string>? log = null)
    {
        _path = path;
        _log = log ?? (_ => { });
    }

    public string Path => _path;

    // The state file sits in the same directory as match.json.
    public static string PathNextTo(string matchJsonPath) =>
        System.IO.Path.Combine(System.IO.Path.GetDirectoryName(matchJsonPath) ?? ".", FileName);

    public void Save(MatchState state)
    {
        try
        {
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(state, MatchConfigLoader.JsonOptions));
            File.Move(tmp, _path, overwrite: true);
        }
        catch (Exception e)
        {
            _log($"could not save match state to {_path}: {e.Message}");
        }
    }

    public MatchState? Load()
    {
        try
        {
            if (!File.Exists(_path)) return null;
            return JsonSerializer.Deserialize<MatchState>(File.ReadAllText(_path), MatchConfigLoader.JsonOptions);
        }
        catch (Exception e)
        {
            _log($"could not read match state from {_path}: {e.Message}");
            return null;
        }
    }

    // Restore only after a plugin hot reload and only for the match this server is still running.
    // A fresh server start means CS2 itself restarted, so its score is gone and a restore would be wrong.
    public static bool ShouldRestore(MatchState? state, MatchConfig cfg, bool hotReload) =>
        hotReload && state is not null && state.MatchId == cfg.MatchId && !string.IsNullOrEmpty(state.Phase);
}

// Writes state on a background task so serialising and file IO never run on the game thread.
// Only the newest state matters, so a save that arrives while one is writing replaces any
// state still waiting. One writer at a time keeps the file on the latest state.
public sealed class BackgroundMatchStateStore : IMatchStateStore
{
    private readonly IMatchStateStore _inner;
    private readonly Action<string> _log;
    private readonly object _lock = new();
    private readonly ManualResetEventSlim _idle = new(true);
    private MatchState? _pending;
    private bool _writing;

    public BackgroundMatchStateStore(IMatchStateStore inner, Action<string>? log = null)
    {
        _inner = inner;
        _log = log ?? (_ => { });
    }

    public void Save(MatchState state)
    {
        lock (_lock)
        {
            _pending = state;
            if (_writing) return;
            _writing = true;
            _idle.Reset();
        }
        Task.Run(Drain);
    }

    // Reads straight from the inner store. Only used at load, before any save.
    public MatchState? Load() => _inner.Load();

    // Waits for pending writes. Returns false on timeout.
    public bool Flush(TimeSpan timeout) => _idle.Wait(timeout);

    private void Drain()
    {
        while (true)
        {
            MatchState next;
            lock (_lock)
            {
                if (_pending is null)
                {
                    _writing = false;
                    _idle.Set();
                    return;
                }
                next = _pending;
                _pending = null;
            }
            try
            {
                _inner.Save(next);
            }
            catch (Exception e)
            {
                _log($"could not save match state: {e.Message}");
            }
        }
    }
}
