using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Xml;
using Microsoft.Extensions.Options;

namespace Matpref.Server;

/// <summary>
/// Hämtar nya recept från källorna i appsettings.json. Läser sajternas egna sitemaps, väljer slumpvis bland receptsidor
/// vi inte har tittat på och sparar titel, bild, beskrivning och länk. Körs i bakgrunden och bara när leken börjar ta slut.
/// </summary>
public class Importer(Db db, HttpClient http, IOptionsMonitor<ImportOptions> options, ILogger<Importer> log) : BackgroundService
{
    readonly SemaphoreSlim _running = new(1, 1);

    public bool IsRunning => _running.CurrentCount == 0;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (options.CurrentValue.Enabled) await RunAsync(force: false, stoppingToken);
            await Task.Delay(TimeSpan.FromHours(Math.Max(0.1, options.CurrentValue.IntervalHours)), stoppingToken);
        }
    }

    /// <summary>Kör en import nu. Returnerar antal nya recept, eller null om en import redan pågår.</summary>
    public async Task<int?> RunAsync(bool force, CancellationToken ct)
    {
        if (!await _running.WaitAsync(0, ct)) return null;
        try
        {
            var o = options.CurrentValue;
            var unswiped = db.UnswipedCount();
            if (!force && unswiped >= o.TargetUnswiped)
            {
                log.LogInformation("{Count} recept kvar att swipa, ingen import behövs", unswiped);
                return 0;
            }
            var perSource = force
                ? o.MaxNewPerSource
                : Math.Clamp((o.TargetUnswiped - unswiped) / Math.Max(1, o.Sources.Count) + 1, 1, o.MaxNewPerSource);
            var added = 0;
            foreach (var source in o.Sources)
            {
                try
                {
                    added += await ImportSourceAsync(source, perSource, o.DelayMs, ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    log.LogWarning(e, "Import från {Source} misslyckades", source.Name);
                }
            }
            log.LogInformation("Importen klar: {Added} nya recept", added);
            return added;
        }
        finally
        {
            _running.Release();
        }
    }

    async Task<int> ImportSourceAsync(SourceOptions source, int wanted, int delayMs, CancellationToken ct)
    {
        var urlPattern = string.IsNullOrEmpty(source.UrlPattern) ? null : new Regex(source.UrlPattern, RegexOptions.IgnoreCase);
        var sitemapPattern = string.IsNullOrEmpty(source.SitemapPattern) ? null : new Regex(source.SitemapPattern, RegexOptions.IgnoreCase);
        var seen = db.SeenUrls(source.Name);
        var candidates = new HashSet<string>();
        foreach (var sitemap in source.Sitemaps)
            await CollectAsync(sitemap, sitemapPattern, candidates, depth: 0, ct);

        var fresh = candidates.Where(u => !seen.Contains(u) && (urlPattern?.IsMatch(u) ?? true)).ToArray();
        Random.Shared.Shuffle(fresh);
        log.LogInformation("{Source}: {Total} sidor i sitemapen, {Fresh} nya", source.Name, candidates.Count, fresh.Length);

        int added = 0, tries = 0;
        foreach (var url in fresh)
        {
            // Inte alla sidor är middagsrecept, men ge upp efter ett tag så att en körning inte hämtar hela sajten.
            if (added >= wanted || tries++ >= wanted * 3) break;
            await Task.Delay(delayMs, ct);
            string html;
            try
            {
                html = await GetStringAsync(url, ct);
            }
            catch (HttpRequestException e)
            {
                // Inte markerad som sedd: försök igen nästa gång.
                log.LogDebug("Kunde inte hämta {Url}: {Error}", url, e.Message);
                continue;
            }
            var meta = RecipeParser.Parse(html, url);
            if (meta is null || !Classifier.IsDinner(meta))
            {
                db.MarkSeen(source.Name, url, meta is null ? "not-recipe" : "not-dinner");
                continue;
            }
            if (db.AddRecipe(source.Name, meta with { Url = url }, Classifier.GuessCategory(meta))) added++;
            db.MarkSeen(source.Name, url, "recipe");
        }
        return added;
    }

    async Task CollectAsync(string url, Regex? sitemapPattern, HashSet<string> into, int depth, CancellationToken ct)
    {
        var (isIndex, locs) = Sitemap.Parse(await GetBytesAsync(url, ct));
        if (!isIndex)
        {
            into.UnionWith(locs);
            return;
        }
        if (depth >= 2) return;
        foreach (var child in locs.Where(l => sitemapPattern?.IsMatch(l) ?? true).Take(50))
        {
            try
            {
                await CollectAsync(child, sitemapPattern, into, depth + 1, ct);
            }
            catch (HttpRequestException e)
            {
                log.LogWarning("Kunde inte läsa sitemap {Url}: {Error}", child, e.Message);
            }
        }
    }

    /// <summary>Hämtar en enskild receptsida som någon har klistrat in en länk till. Null om sidan inte har något recept.</summary>
    public async Task<RecipeMeta?> FetchRecipeAsync(Uri url, CancellationToken ct) =>
        RecipeParser.Parse(await GetStringAsync(url.ToString(), ct), url.ToString());

    const int MaxPageBytes = 3_000_000;

    async Task<byte[]> GetBytesAsync(string url, CancellationToken ct)
    {
        using var res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        res.EnsureSuccessStatusCode();
        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var ms = new MemoryStream();
        var buffer = new byte[81920];
        int n;
        while ((n = await stream.ReadAsync(buffer, ct)) > 0)
        {
            ms.Write(buffer, 0, n);
            if (ms.Length > 50_000_000) throw new HttpRequestException($"{url} är för stor");
        }
        return ms.ToArray();
    }

    async Task<string> GetStringAsync(string url, CancellationToken ct)
    {
        var bytes = await GetBytesAsync(url, ct);
        return System.Text.Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, MaxPageBytes));
    }
}

public static class Sitemap
{
    const string SitemapNs = "http://www.sitemaps.org/schemas/sitemap/0.9";

    /// <summary>Läser en sitemap (eventuellt gzippad). Returnerar om det är ett index och alla &lt;loc&gt;-adresser.</summary>
    public static (bool IsIndex, List<string> Locs) Parse(byte[] data)
    {
        Stream stream = new MemoryStream(data);
        if (data.Length > 2 && data[0] == 0x1f && data[1] == 0x8b) stream = new GZipStream(stream, CompressionMode.Decompress);
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
        bool? isIndex = null;
        var locs = new List<string>();
        reader.MoveToContent();
        while (!reader.EOF)
        {
            if (reader.NodeType != XmlNodeType.Element)
            {
                reader.Read();
                continue;
            }
            isIndex ??= reader.LocalName == "sitemapindex";
            // Bara sitemapens egna <loc>, inte t.ex. <image:loc>.
            if (reader.LocalName == "loc" && reader.NamespaceURI is "" or SitemapNs)
            {
                if (reader.ReadElementContentAsString().Trim() is { Length: > 0 } loc) locs.Add(loc);
            }
            else reader.Read();
        }
        return (isIndex ?? false, locs);
    }
}
