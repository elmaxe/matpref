using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;

namespace Matpref.Server;

/// <summary>Det vi sparar om ett recept: bara metadata och en länk, aldrig själva receptet.</summary>
public record RecipeMeta(
    string Url,
    string Title,
    string? Description,
    string? Image,
    int? TotalMinutes,
    int? Servings,
    string[] Categories,
    string[] Keywords);

/// <summary>Läser receptdata ur en receptsida. Nästan alla receptsajter lägger schema.org/Recipe som JSON-LD för Googles skull.</summary>
public static partial class RecipeParser
{
    public static RecipeMeta? Parse(string html, string pageUrl)
    {
        foreach (Match m in JsonLdRegex().Matches(html))
        {
            try
            {
                using var doc = JsonDocument.Parse(m.Groups[1].Value.Trim(), new JsonDocumentOptions { AllowTrailingCommas = true });
                if (FindRecipe(doc.RootElement) is { } recipe && FromJsonLd(recipe, pageUrl) is { } meta) return meta;
            }
            catch (JsonException)
            {
                // Trasig JSON-LD i ett block, prova nästa.
            }
        }
        return FromOpenGraph(html, pageUrl);
    }

    static JsonElement? FindRecipe(JsonElement el)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Array:
                foreach (var item in el.EnumerateArray())
                    if (FindRecipe(item) is { } found) return found;
                return null;
            case JsonValueKind.Object:
                if (el.TryGetProperty("@type", out var type) && Strings(type).Any(t => t.Equals("Recipe", StringComparison.OrdinalIgnoreCase)))
                    return el;
                if (el.TryGetProperty("@graph", out var graph)) return FindRecipe(graph);
                if (el.TryGetProperty("mainEntity", out var main)) return FindRecipe(main);
                return null;
            default:
                return null;
        }
    }

    static RecipeMeta? FromJsonLd(JsonElement r, string pageUrl)
    {
        var title = Clean(Str(r, "name"), 200);
        if (title is null) return null;
        var prep = Minutes(Str(r, "prepTime"));
        var cook = Minutes(Str(r, "cookTime"));
        var total = Minutes(Str(r, "totalTime")) ?? (prep is null && cook is null ? null : (prep ?? 0) + (cook ?? 0));
        return new RecipeMeta(
            Url: AbsoluteUrl(Str(r, "url"), pageUrl) ?? pageUrl,
            Title: title,
            Description: Clean(Str(r, "description"), 400),
            Image: AbsoluteUrl(r.TryGetProperty("image", out var img) ? ImageUrl(img) : null, pageUrl),
            TotalMinutes: total is > 0 ? total : null,
            Servings: r.TryGetProperty("recipeYield", out var y) ? FirstNumber(y) : null,
            Categories: List(r, "recipeCategory"),
            Keywords: List(r, "keywords"));
    }

    /// <summary>Reserv för sidor utan JSON-LD: Open Graph, men bara om sidan själv säger att den är ett recept.</summary>
    static RecipeMeta? FromOpenGraph(string html, string pageUrl)
    {
        var meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match m in MetaRegex().Matches(html))
        {
            var attrs = AttrRegex().Matches(m.Value).ToDictionary(a => a.Groups[1].Value.ToLowerInvariant(), a => a.Groups[3].Value);
            var key = attrs.GetValueOrDefault("property") ?? attrs.GetValueOrDefault("name");
            if (key is not null && attrs.TryGetValue("content", out var content)) meta.TryAdd(key, content);
        }
        var isRecipe = meta.Any(kv => kv.Key.Contains("type", StringComparison.OrdinalIgnoreCase) && kv.Value.Trim().Equals("recipe", StringComparison.OrdinalIgnoreCase));
        var title = Clean(meta.GetValueOrDefault("og:title"), 200);
        if (!isRecipe || title is null) return null;
        return new RecipeMeta(
            AbsoluteUrl(meta.GetValueOrDefault("og:url"), pageUrl) ?? pageUrl,
            title,
            Clean(meta.GetValueOrDefault("og:description"), 400),
            AbsoluteUrl(meta.GetValueOrDefault("og:image"), pageUrl),
            null, null, [], []);
    }

    static string? Str(JsonElement obj, string prop) =>
        obj.TryGetProperty(prop, out var v) ? Strings(v).FirstOrDefault() : null;

    static IEnumerable<string> Strings(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => [v.GetString()!],
        JsonValueKind.Number => [v.GetRawText()],
        JsonValueKind.Array => v.EnumerateArray().SelectMany(Strings),
        _ => [],
    };

    static string[] List(JsonElement obj, string prop) =>
        obj.TryGetProperty(prop, out var v)
            ? Strings(v).SelectMany(s => s.Split(',')).Select(s => Clean(s, 60)).OfType<string>().Distinct().Take(20).ToArray()
            : [];

    static string? ImageUrl(JsonElement img) => img.ValueKind switch
    {
        JsonValueKind.String => img.GetString(),
        JsonValueKind.Array => img.EnumerateArray().Select(ImageUrl).FirstOrDefault(u => !string.IsNullOrWhiteSpace(u)),
        JsonValueKind.Object => Str(img, "url") ?? Str(img, "contentUrl"),
        _ => null,
    };

    static int? FirstNumber(JsonElement v)
    {
        foreach (var s in Strings(v))
            if (NumberRegex().Match(s) is { Success: true } m && int.TryParse(m.Value, out var n) && n is > 0 and < 100) return n;
        return null;
    }

    /// <summary>ISO 8601-tid, t.ex. "PT1H30M", till minuter.</summary>
    public static int? Minutes(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return null;
        try
        {
            return (int)Math.Round(XmlConvert.ToTimeSpan(iso.Trim()).TotalMinutes);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    static string? AbsoluteUrl(string? url, string pageUrl)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        url = WebUtility.HtmlDecode(url.Trim());
        if (url.StartsWith("//")) url = "https:" + url;
        return Uri.TryCreate(new Uri(pageUrl), url, out var abs) && (abs.Scheme == "https" || abs.Scheme == "http") ? abs.ToString() : null;
    }

    static string? Clean(string? s, int max)
    {
        if (s is null) return null;
        s = WhitespaceRegex().Replace(TagRegex().Replace(WebUtility.HtmlDecode(s), " "), " ").Trim();
        if (s.Length == 0) return null;
        return s.Length <= max ? s : s[..(max - 1)].TrimEnd() + "…";
    }

    [GeneratedRegex(@"<script[^>]*type\s*=\s*[""']?application/ld\+json[""']?[^>]*>(.*?)</script>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex JsonLdRegex();

    [GeneratedRegex(@"<meta\s[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex MetaRegex();

    [GeneratedRegex(@"([\w:-]+)\s*=\s*([""'])(.*?)\2", RegexOptions.Singleline)]
    private static partial Regex AttrRegex();

    [GeneratedRegex(@"\d+")]
    private static partial Regex NumberRegex();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex TagRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
