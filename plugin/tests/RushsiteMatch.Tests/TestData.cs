using RushsiteMatch.Core.Config;

namespace RushsiteMatch.Tests;

internal static class TestData
{
    public const string A1 = "76561198000000001";
    public const string A2 = "76561198000000002";
    public const string A3 = "76561198000000003";
    public const string B1 = "76561198000000011";
    public const string B2 = "76561198000000012";
    public const string B3 = "76561198000000013";
    public const string Outsider = "76561198000000099";

    public static string Json(string mode = "rush3v3", string win = "valve_rush", int teamSize = 3, string? presigned = "https://s3.example/demo?sig=1")
    {
        var a = new[] { A1, A2, A3 }.Take(teamSize).ToArray();
        var b = new[] { B1, B2, B3 }.Take(teamSize).ToArray();
        string Arr(IEnumerable<string> ids) => "[" + string.Join(",", ids.Select(i => $"\"{i}\"")) + "]";
        return $$"""
        {
          "matchId": "5f0c7a3e-1b2c-4d5e-8f90-1234567890ab",
          "mode": "{{mode}}",
          "allowedSteamIds": {{Arr(a.Concat(b))}},
          "teams": [ { "name": "alpha", "steamIds": {{Arr(a)}} }, { "name": "bravo", "steamIds": {{Arr(b)}} } ],
          "password": "hunter2",
          "webhookUrl": "https://api.example/webhooks/match/5f0c7a3e-1b2c-4d5e-8f90-1234567890ab",
          "webhookSecret": "topsecret",
          "demoUpload": { "bucket": "demos", "key": "m/1.dem", "presignedPutUrl": "{{presigned ?? ""}}" },
          "winCondition": "{{win}}"
        }
        """;
    }

    public const string SeriesJson = """
      "series": {
        "bestOf": 3,
        "maps": [
          { "id": "aim_map", "displayName": "Aim Map", "workshopId": "3084291314" },
          { "id": "aim_usp", "displayName": "USP", "workshopId": "3299812021" },
          { "id": "awp_india", "displayName": "AWP India", "mapName": "awp_india" }
        ],
        "startMapNumber": 1,
        "wins": { "alpha": 0, "bravo": 0 },
        "demoUploads": [
          { "bucket": "demos", "key": "m/1.dem", "presignedPutUrl": "https://s3.example/m1" },
          { "bucket": "demos", "key": "m/2.dem", "presignedPutUrl": "https://s3.example/m2" },
          { "bucket": "demos", "key": "m/3.dem", "presignedPutUrl": "https://s3.example/m3" }
        ]
      },
    """;

    public static string WithSeries(string json, string series = SeriesJson) =>
        json.Replace("\"winCondition\"", series + "\"winCondition\"");

    public static MatchConfig AimBo3() => MatchConfigLoader.Parse(WithSeries(Json("aim1v1", "first_to_13", 1)));

    public static MatchConfig RushBo3() => MatchConfigLoader.Parse(WithSeries(Json(), """
      "series": { "bestOf": 3, "maps": [ { "id": "rush_001", "mapName": "rush_001" }, { "id": "rush_001", "mapName": "rush_001" }, { "id": "rush_001", "mapName": "rush_001" } ] },
    """));

    public static MatchConfig Rush() => MatchConfigLoader.Parse(Json());
    public static MatchConfig Rush1v1() => MatchConfigLoader.Parse(Json("rush1v1", "valve_rush", 1));
    public static MatchConfig Aim1v1() => MatchConfigLoader.Parse(Json("aim1v1", "first_to_13", 1));
    public static MatchConfig Aim2v2() => MatchConfigLoader.Parse(Json("aim2v2", "first_to_13", 2));
}
