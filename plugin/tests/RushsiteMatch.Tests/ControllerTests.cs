using RushsiteMatch.Core.Config;
using RushsiteMatch.Core.Events;
using RushsiteMatch.Core.Match;
using static RushsiteMatch.Tests.TestData;

namespace RushsiteMatch.Tests;

public class ControllerTests
{
    private readonly FakeGame _game = new();
    private readonly FakeSink _sink = new();
    private readonly FakeClock _clock = new();
    private readonly FakeUploader _uploader = new();

    private MatchController New(MatchConfig cfg, MatchSettings? settings = null)
    {
        var m = new MatchController(cfg, settings ?? new MatchSettings(), _game, _sink, _clock, _uploader);
        m.Start();
        return m;
    }

    private void Join(MatchController m, string id, Side side, int uid = 1)
    {
        m.OnPlayerConnected(id, uid);
        _game.Sides[id] = side;
        m.OnPlayerTeam(id, side);
    }

    private static readonly string[] RoundConVars = { "mp_maxrounds", "mp_roundtime", "mp_halftime", "mp_warmup", "mp_match_can_clinch", "mp_overtime", "mp_pause_match", "mp_unpause_match", "mp_ignore_round_win_conditions", "mp_default_team_winner_no_objective" };

    [Fact]
    public void StartEmitsServerReadyAndChecksPassword()
    {
        _game.ConVars["sv_password"] = "wrong";
        New(Rush());
        Assert.Equal(new[] { "server_ready" }, _sink.Types);
        Assert.Contains("sv_password \"hunter2\"", _game.Commands);
        Assert.Contains("bot_quota 0", _game.Commands);
    }

    [Fact]
    public void KicksPlayersNotOnWhitelist()
    {
        var m = New(Rush());
        Assert.False(m.OnClientAuthorized(Outsider, 42));
        Assert.True(m.OnClientAuthorized(A1, 7));
        Assert.Equal(42, Assert.Single(_game.Kicks).UserId);
        m.OnPlayerConnected(Outsider, 43);
        Assert.Equal(2, _game.Kicks.Count);
        Assert.DoesNotContain("player_connected", _sink.Types);
    }

    [Fact]
    public void RushNeverTouchesRoundRulesOrPauses()
    {
        var m = New(Rush());
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
        Assert.True(m.OnJoinTeamRequest(A1, Side.CT));
        Assert.Contains("No ready-up", m.ReadyHint());
        m.OnRoundFreezeEnd(isWarmup: false);
        m.OnPlayerDisconnected(B1);
        _clock.Advance(10);
        m.Tick();
        // Holding and ending warmup are the only mp_ commands Rush sends.
        Assert.DoesNotContain(_game.Commands, c => RoundConVars.Any(c.StartsWith) && !c.StartsWith("mp_warmup_pausetimer") && c != "mp_warmup_end");
        Assert.Empty(_game.Moves);
        Assert.Empty(_game.ForcedJoins);
    }

    [Fact]
    public void RushRecordsWhenAllConnectedAndGoesLiveOnSignal()
    {
        var m = New(Rush());
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.T);
        foreach (var id in new[] { B1, B2 }) Join(m, id, Side.CT);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("tv_record"));
        Join(m, B3, Side.CT);
        Assert.Contains("tv_record \"rushsite_5f0c7a3e-1b2c-4d5e-8f90-1234567890ab\"", _game.Commands);

        m.OnRoundEnd(Side.T, false, isWarmup: true);
        m.OnRoundFreezeEnd(isWarmup: true);
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        m.OnRushMatchLive();
        m.OnRushMatchLive();
        Assert.Equal(MatchPhase.Live, m.Phase);
        Assert.Single(_sink.Types, "match_started");
        Assert.Single(_game.Commands, c => c.StartsWith("tv_record"));
    }

    private MatchController LiveRush()
    {
        var m = New(Rush());
        foreach (var id in new[] { A1, A2, A3 }) Join(m, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(m, id, Side.T);
        _game.Arena = "102";
        m.OnRoundFreezeEnd(isWarmup: false);
        return m;
    }

    [Fact]
    public void MatchEndKicksEveryConnectedPlayer()
    {
        var m = LiveRush();
        for (var i = 0; i < 4; i++) m.OnRoundEnd(Side.CT, false, false);
        foreach (var id in new[] { A1, A2, A3, B1, B2, B3 }) _game.Connected.Add(new ConnectedPlayer(id, 1, true));
        m.OnWinPanelMatch();
        Assert.Equal(MatchPhase.Ended, m.Phase);
        Assert.Empty(_game.SteamKicks);
        _clock.Advance(10);
        m.Tick();
        var kicked = _game.SteamKicks.Select(k => k.Item1).ToHashSet();
        Assert.Equal(6, kicked.Count);
        Assert.All(_game.SteamKicks, k => Assert.Equal("Match over. Team alpha 4-0 Team bravo. Thanks for playing.", k.Item2));
        Assert.Single(_sink.Types, "match_end");
    }

    [Fact]
    public async Task RushCastleWinSendsMatchEndAtOnceThenDemoUploaded()
    {
        _game.ConVars["tv_delay"] = "105";
        var m = LiveRush();
        m.OnPlayerHurt(A1, B1, 100);
        m.OnPlayerDeath(new DeathInfo(A1, B1, null, "ak47", true, 0, 100));
        for (var i = 0; i < 4; i++) m.OnRoundEnd(Side.CT, false, false);

        var rounds = _sink.Events.OfType<RoundEnd>().ToList();
        Assert.Equal(new[] { 1, 2, 3, 4 }, rounds.Select(r => r.Round));
        Assert.All(rounds, r => Assert.Equal("alpha", r.WinnerTeam));
        Assert.Equal("102", rounds[0].Arena);
        Assert.Equal(4, rounds[^1].Score["alpha"]);
        Assert.Equal(0, rounds[^1].Score["bravo"]);

        m.OnWinPanelMatch();
        Assert.Equal(MatchPhase.Ended, m.Phase);
        var end = _sink.Last<MatchEnd>();
        Assert.Equal("alpha", end.WinnerTeam);
        Assert.False(end.DemoUploaded);
        var a1 = end.Players.Single(p => p.SteamId == A1);
        Assert.Equal((1, 1, 100), (a1.Kills, a1.Headshots, a1.Damage));

        m.OnRoundEnd(Side.T, false, false);
        m.OnWinPanelMatch();
        Assert.Equal(4, _sink.Events.OfType<RoundEnd>().Count());
        Assert.Single(_sink.Types, "match_end");

        _clock.Advance(109);
        m.Tick();
        Assert.DoesNotContain("tv_stoprecord", _game.Commands);
        Assert.True(m.DemoPending);
        _clock.Advance(1);
        m.Tick();
        Assert.Contains("tv_stoprecord", _game.Commands);
        await m.UploadTask!;

        Assert.Equal("demo_uploaded", _sink.Types.Last());
        var demo = _sink.Last<DemoUploaded>();
        Assert.True(demo.Ok);
        Assert.Equal(4096, demo.Bytes);
        Assert.Null(demo.Error);
        Assert.False(m.DemoPending);
        Assert.Equal(Path.Combine(_game.CsgoDirectory, "rushsite_5f0c7a3e-1b2c-4d5e-8f90-1234567890ab.dem"), _uploader.Calls.Single().Path);
    }

    [Fact]
    public void RushEndsFromScoreTrackingWhenWinPanelNeverFires()
    {
        var m = LiveRush();
        for (var i = 0; i < 7; i++)
        {
            m.OnRoundEnd(Side.CT, false, false);
            m.OnRoundEnd(Side.T, false, false);
        }
        m.OnRoundEnd(Side.T, false, false);
        Assert.Equal(MatchPhase.Live, m.Phase);
        _clock.Advance(10);
        m.Tick();
        Assert.Equal(MatchPhase.Ended, m.Phase);
        var end = _sink.Last<MatchEnd>();
        Assert.Equal("bravo", end.WinnerTeam);
        Assert.Equal(8, end.Score["bravo"]);
        Assert.Equal(7, end.Score["alpha"]);
    }

    [Fact]
    public async Task FailedUploadReportsDemoUploadedFalse()
    {
        _uploader.Result = DemoUploadResult.Failed("HTTP 403", 2048);
        var m = LiveRush();
        for (var i = 0; i < 4; i++) m.OnRoundEnd(Side.T, false, false);
        m.OnWinPanelMatch();
        _clock.Advance(5);
        m.Tick();
        await m.UploadTask!;
        Assert.Equal("bravo", _sink.Last<MatchEnd>().WinnerTeam);
        var demo = _sink.Last<DemoUploaded>();
        Assert.False(demo.Ok);
        Assert.Equal("HTTP 403", demo.Error);
        Assert.Equal(2048, demo.Bytes);
    }

    [Fact]
    public void AbandonsOnNoShow()
    {
        var m = New(Rush(), new MatchSettings { ConnectGrace = TimeSpan.FromSeconds(60) });
        Join(m, A1, Side.T);
        _clock.Advance(59);
        m.Tick();
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        _clock.Advance(1);
        m.Tick();
        Assert.Equal(MatchPhase.Abandoned, m.Phase);
        _clock.Advance(60);
        m.Tick();
        Assert.Null(m.UploadTask);
        Assert.DoesNotContain("demo_uploaded", _sink.Types);
        var ab = _sink.Last<MatchAbandoned>();
        Assert.Equal("no_show", ab.Reason);
        Assert.Equal(new[] { A2, A3, B1, B2, B3 }, ab.MissingSteamIds);
        m.Tick();
        Assert.Single(_sink.Types, "match_abandoned");
    }

    [Fact]
    public async Task AbandonsThenUploadsPartialDemo()
    {
        var m = LiveRush();
        m.OnPlayerDisconnected(B2);
        Assert.Equal(B2, _sink.Last<PlayerDisconnected>().SteamId);
        _clock.Advance(179);
        m.Tick();
        m.OnPlayerConnected(B2, 5);
        _clock.Advance(100);
        m.Tick();
        Assert.Equal(MatchPhase.Live, m.Phase);

        m.OnPlayerDisconnected(B2);
        _clock.Advance(180);
        m.Tick();
        Assert.Equal(MatchPhase.Abandoned, m.Phase);
        Assert.Equal("disconnected", _sink.Last<MatchAbandoned>().Reason);
        Assert.Equal(new[] { B2 }, _sink.Last<MatchAbandoned>().MissingSteamIds);
        Assert.DoesNotContain("tv_stoprecord", _game.Commands);
        _clock.Advance(5);
        m.Tick();
        Assert.Contains("tv_stoprecord", _game.Commands);
        await m.UploadTask!;
        Assert.Equal(new[] { "match_abandoned", "demo_uploaded" }, _sink.Types.TakeLast(2));
        Assert.True(_sink.Last<DemoUploaded>().Ok);
        Assert.Single(_uploader.Calls);
    }

    [Fact]
    public void AimCountdownStartsWhenLineupIsCompleteThenGoesLive()
    {
        var m = New(Aim1v1(), new MatchSettings { StartCountdown = TimeSpan.FromSeconds(10) });
        Assert.Contains("mp_warmup_pausetimer 1", _game.Commands);
        Join(m, A1, Side.CT);
        Assert.False(m.OnJoinTeamRequest(B1, Side.CT));
        Assert.True(m.OnJoinTeamRequest(B1, Side.T));
        Join(m, B1, Side.T);
        Assert.True(m.CountdownRunning);
        Assert.Contains(_game.Chat, c => c.Contains("starts in 10 seconds"));

        _clock.Advance(9);
        m.Tick();
        Assert.Equal(MatchPhase.Warmup, m.Phase);
        _clock.Advance(1);
        m.Tick();

        Assert.Equal(MatchPhase.Live, m.Phase);
        var start = _game.Commands.SkipWhile(c => c != "mp_maxrounds 25").ToList();
        Assert.Equal(new[] { "mp_maxrounds 25", "mp_match_can_clinch 1", "mp_overtime_enable 1", "mp_overtime_maxrounds 6",
            "mp_overtime_startmoney 16000", "mp_halftime 0", "mp_warmup_pausetimer 0" }, start.Take(7));
        Assert.StartsWith("tv_record", start[7]);
        Assert.Equal("mp_warmup_end", start[8]);
        Assert.Equal(new[] { "server_ready", "player_connected", "player_connected", "match_started" }, _sink.Types);
        Assert.Null(_sink.Last<MatchStarted>().MapNumber);
    }

    [Fact]
    public void AimCountdownCancelsWhenAPlayerLeavesOrSwitchesSide()
    {
        var m = New(Aim2v2(), new MatchSettings { StartCountdown = TimeSpan.FromSeconds(10) });
        Join(m, A1, Side.CT);
        Join(m, A2, Side.CT);
        Join(m, B1, Side.T);
        Assert.False(m.CountdownRunning);
        Join(m, B2, Side.T);
        Assert.True(m.CountdownRunning);

        _clock.Advance(5);
        _game.Sides[B2] = Side.Spectator;
        m.OnPlayerTeam(B2, Side.Spectator);
        Assert.False(m.CountdownRunning);
        Assert.Contains(_game.Chat, c => c.Contains("Countdown stopped"));

        _game.Sides[B2] = Side.T;
        m.OnPlayerTeam(B2, Side.T);
        Assert.True(m.CountdownRunning);
        _clock.Advance(5);
        m.OnPlayerDisconnected(A2);
        Assert.False(m.CountdownRunning);
        _clock.Advance(30);
        m.Tick();
        Assert.Equal(MatchPhase.Warmup, m.Phase);

        m.OnPlayerConnected(A2, 2);
        Assert.True(m.CountdownRunning);
        _clock.Advance(10);
        m.Tick();
        Assert.Equal(MatchPhase.Live, m.Phase);
    }

    [Fact]
    public void AimNoShowStillAbandonsWhileWaitingForTheLineup()
    {
        var m = New(Aim1v1(), new MatchSettings { ConnectGrace = TimeSpan.FromSeconds(60) });
        Join(m, A1, Side.CT);
        _clock.Advance(60);
        m.Tick();
        Assert.Equal(MatchPhase.Abandoned, m.Phase);
        Assert.Equal(new[] { B1 }, _sink.Last<MatchAbandoned>().MissingSteamIds);
    }

    [Fact]
    public void ReadyCommandOnlyExplains()
    {
        var m = New(Aim1v1());
        Assert.Contains("No ready-up needed", m.ReadyHint());
    }

    [Fact]
    public void AimLoadoutConVarsImmunityAndSpawnLoadout()
    {
        var cfg = MatchConfigLoader.Parse(Json("aim1v1", "first_to_13", 1).Replace(
            "\"winCondition\"", "\"map\": { \"id\": \"aim_usp\", \"workshopId\": \"3299812021\" }, \"winCondition\""));
        var m = New(cfg, new MatchSettings { AimSpawnImmunity = TimeSpan.FromSeconds(2.5) });
        Assert.Contains("mp_ct_default_secondary \"weapon_usp_silencer\"", _game.Commands);
        Assert.Contains("mp_t_default_primary \"\"", _game.Commands);
        Assert.Contains("mp_free_armor 2", _game.Commands);
        Assert.Contains("mp_buytime 0", _game.Commands);
        Assert.Contains("mp_respawn_immunitytime 2.5", _game.Commands);

        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        m.OnPlayerSpawn(B1, Side.T);
        var (id, loadout) = Assert.Single(_game.Loadouts);
        Assert.Equal(B1, id);
        Assert.Equal(new[] { "weapon_usp_silencer" }, loadout.Weapons);
        Assert.Equal(ArmorKind.KevlarHelmet, loadout.Armor);
        m.OnPlayerSpawn(Outsider, Side.T);
        Assert.Single(_game.Loadouts);

        // Loadout convars run again after mode.cfg at the start because the cfg turns buying back on.
        m.ForceStart();
        var exec = _game.Commands.LastIndexOf("exec rushsite/matches/5f0c7a3e-1b2c-4d5e-8f90-1234567890ab/mode.cfg");
        Assert.True(_game.Commands.LastIndexOf("mp_buytime 0") > exec);
    }

    [Fact]
    public void RushGetsNoLoadoutOrImmunity()
    {
        var m = New(Rush());
        m.OnPlayerSpawn(A1, Side.CT);
        Assert.Empty(_game.Loadouts);
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("mp_respawn_immunitytime") || c.StartsWith("mp_free_armor") || c.StartsWith("mp_ct_default"));
        Assert.Null(m.CurrentLoadout);
    }

    [Fact]
    public void AimTiedRegulationGoesToOvertime()
    {
        var m = New(Aim1v1());
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        m.ForceStart();
        for (var i = 0; i < 12; i++)
        {
            m.OnRoundEnd(Side.CT, false, false);
            m.OnRoundEnd(Side.T, false, false);
        }
        m.OnRoundEnd(Side.None, false, false);
        _clock.Advance(30);
        m.Tick();
        Assert.Equal(MatchPhase.Live, m.Phase);
        for (var i = 0; i < 4; i++) m.OnRoundEnd(Side.T, false, false);
        m.OnWinPanelMatch();
        Assert.Equal("bravo", _sink.Last<MatchEnd>().WinnerTeam);
        Assert.Equal(16, _sink.Last<MatchEnd>().Score["bravo"]);
    }

    [Fact]
    public void AimFirstTo13WithPauseOnDisconnect()
    {
        var m = New(Aim1v1());
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        Assert.True(m.ForceStart());
        m.OnRoundEnd(Side.None, gameCommencing: true, isWarmup: false);

        m.OnPlayerDisconnected(B1);
        Assert.Contains("mp_pause_match", _game.Commands);
        _game.Sides.Remove(B1);
        Join(m, B1, Side.T);
        Assert.Contains("mp_unpause_match", _game.Commands);

        for (var i = 0; i < 12; i++)
        {
            m.OnRoundEnd(Side.CT, false, false);
            m.OnRoundEnd(Side.T, false, false);
        }
        m.OnRoundEnd(Side.T, false, false);
        Assert.Equal(25, m.Round);
        m.OnWinPanelMatch();
        Assert.Equal("bravo", _sink.Last<MatchEnd>().WinnerTeam);
        Assert.Equal(13, _sink.Last<MatchEnd>().Score["bravo"]);
    }

    [Fact]
    public void AimScoreFollowsHalftimeSwap()
    {
        var m = New(Aim1v1(), new MatchSettings { AimHalftime = true });
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        m.ForceStart();
        Assert.Contains("mp_halftime 1", _game.Commands);
        m.OnRoundEnd(Side.CT, false, false);
        _game.Sides[A1] = Side.T;
        _game.Sides[B1] = Side.CT;
        m.OnRoundEnd(Side.CT, false, false);
        Assert.Equal(1, m.Score["alpha"]);
        Assert.Equal(1, m.Score["bravo"]);
    }

    [Fact]
    public void DrawRoundIsCountedButScoresNobody()
    {
        var m = LiveRush();
        m.OnRoundEnd(Side.None, false, false);
        var r = _sink.Last<RoundEnd>();
        Assert.Equal("draw", r.WinnerTeam);
        Assert.Equal(1, r.Round);
    }

    [Fact]
    public async Task MissingPresignedUrlReportsDemoNotUploaded()
    {
        var m = New(MatchConfigLoader.Parse(Json("aim1v1", "first_to_13", 1, presigned: null)));
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        m.ForceStart();
        for (var i = 0; i < 16; i++) m.OnRoundEnd(Side.CT, false, false);
        m.OnWinPanelMatch();
        _clock.Advance(5);
        m.Tick();
        await m.UploadTask!;
        Assert.Empty(_uploader.Calls);
        Assert.Equal("alpha", _sink.Last<MatchEnd>().WinnerTeam);
        var demo = _sink.Last<DemoUploaded>();
        Assert.False(demo.Ok);
        Assert.Null(demo.Bytes);
        Assert.Contains("presignedPutUrl", demo.Error);
    }

    [Fact]
    public void AimExecsPerMatchModeCfgFirstAndRushNever()
    {
        var m = New(Aim1v1());
        Join(m, A1, Side.CT);
        Join(m, B1, Side.T);
        m.ForceStart();
        var exec = "exec rushsite/matches/5f0c7a3e-1b2c-4d5e-8f90-1234567890ab/mode.cfg";
        var start = _game.Commands.SkipWhile(c => c != exec).ToList();
        Assert.Equal(exec, start[0]);
        Assert.True(start.IndexOf("mp_maxrounds 25") > 0);
        Assert.True(start.IndexOf("mp_warmup_pausetimer 0") > 0);
        Assert.True(start.IndexOf("mp_warmup_end") > start.IndexOf("mp_warmup_pausetimer 0"));

        _game.Commands.Clear();
        var rush = New(Rush());
        foreach (var id in new[] { A1, A2, A3 }) Join(rush, id, Side.CT);
        foreach (var id in new[] { B1, B2, B3 }) Join(rush, id, Side.T);
        rush.Tick();
        rush.OnRushMatchLive();
        Assert.DoesNotContain(_game.Commands, c => c.StartsWith("exec "));
    }

    [Fact]
    public void ReenforcesBotQuota()
    {
        var m = New(Rush());
        _game.Commands.Clear();
        _game.ConVars["bot_quota"] = "2";
        m.Tick();
        Assert.Equal(new[] { "bot_quota 0", "bot_kick" }, _game.Commands);
    }
}
