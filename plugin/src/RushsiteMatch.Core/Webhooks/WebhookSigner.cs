using System.Security.Cryptography;
using System.Text;

namespace RushsiteMatch.Core.Webhooks;

public static class WebhookSigner
{
    public const string HeaderName = "X-Rushsite-Signature";

    // Returns "sha256=<lowercase hex HMAC-SHA256 of the UTF-8 body>".
    public static string Sign(string body, string secret)
    {
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body));
        return "sha256=" + Convert.ToHexString(mac).ToLowerInvariant();
    }

    public static bool Verify(string body, string secret, string header) =>
        CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(Sign(body, secret)),
            Encoding.ASCII.GetBytes(header ?? ""));
}
