using System.Net;
using System.Text;
using Matpref.Server;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Matpref.Server.Tests;

public sealed class ImporterTests : IDisposable
{
    readonly string _dir = Directory.CreateTempSubdirectory("matpref-import").FullName;

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, recursive: true);
    }

    class FakeSite(Dictionary<string, string> pages) : HttpMessageHandler
    {
        public List<string> Requested { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            Requested.Add(url);
            return Task.FromResult(pages.TryGetValue(url, out var body)
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8) }
                : new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }

    class Monitor(ImportOptions value) : IOptionsMonitor<ImportOptions>
    {
        public ImportOptions CurrentValue => value;
        public ImportOptions Get(string? name) => value;
        public IDisposable? OnChange(Action<ImportOptions, string?> listener) => null;
    }

    static string Page(string name, string category) =>
        $$"""<script type="application/ld+json">{"@type":"Recipe","name":"{{name}}","recipeCategory":"{{category}}","totalTime":"PT20M"}</script>""";

    [Fact]
    public async Task Imports_dinners_from_sitemaps_and_skips_the_rest()
    {
        const string ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var site = new FakeSite(new()
        {
            ["https://x.se/sitemap.xml"] = $"""<sitemapindex xmlns="{ns}"><sitemap><loc>https://x.se/sitemaps/recipes/1</loc></sitemap><sitemap><loc>https://x.se/sitemaps/products/1</loc></sitemap></sitemapindex>""",
            ["https://x.se/sitemaps/recipes/1"] = $"""<urlset xmlns="{ns}"><url><loc>https://x.se/recept/tacos-1/</loc></url><url><loc>https://x.se/recept/kladdkaka-2/</loc></url><url><loc>https://x.se/recept/borta-3/</loc></url><url><loc>https://x.se/om-oss/</loc></url></urlset>""",
            ["https://x.se/recept/tacos-1/"] = Page("Tacos", "Huvudrätt"),
            ["https://x.se/recept/kladdkaka-2/"] = Page("Kladdkaka", "Efterrätt"),
        });
        var db = new Db(Path.Combine(_dir, "import.db"));
        var options = new ImportOptions
        {
            DelayMs = 0,
            Sources = [new SourceOptions { Name = "X", Sitemaps = ["https://x.se/sitemap.xml"], SitemapPattern = "/recipes/", UrlPattern = "/recept/" }],
        };
        var importer = new Importer(db, new HttpClient(site), new Monitor(options), NullLogger<Importer>.Instance);

        Assert.Equal(1, await importer.RunAsync(force: false, CancellationToken.None));
        var card = Assert.Single(db.Recipes(0, 10).Recipes);
        Assert.Equal("Tacos", card.Title);
        Assert.Equal("fast", card.Category);
        Assert.DoesNotContain("https://x.se/sitemaps/products/1", site.Requested);
        Assert.DoesNotContain("https://x.se/om-oss/", site.Requested);

        // Andra gången hämtas bara sidan som inte gick att nå.
        site.Requested.Clear();
        Assert.Equal(0, await importer.RunAsync(force: true, CancellationToken.None));
        Assert.Equal(["https://x.se/sitemap.xml", "https://x.se/sitemaps/recipes/1", "https://x.se/recept/borta-3/"], site.Requested);
    }

    [Fact]
    public async Task Fetches_a_whole_recipe_from_a_pasted_link()
    {
        var url = "https://www.ica.se/recept/pannkakor-123/";
        var page = """
            <script type="application/ld+json">{"@type":"Recipe","name":"Pannkakor","recipeYield":"4",
             "recipeIngredient":["3 dl vetemjöl","6 dl mjölk","3 &auml;gg"],
             "recipeInstructions":[
               {"@type":"HowToSection","name":"Smet","itemListElement":[{"@type":"HowToStep","text":"Vispa mjöl och <b>mjölk</b>."},{"@type":"HowToStep","text":"Vispa i äggen."}]},
               {"@type":"HowToStep","text":"Stek tunna pannkakor."}]}</script>
            """;
        var site = new FakeSite(new() { [url] = page, ["https://x.se/text"] = """<script type="application/ld+json">{"@type":"Recipe","name":"Gröt","recipeInstructions":"<p>Koka vatten.</p><p>Rör i havre.</p>"}</script>""" });
        var db = new Db(Path.Combine(_dir, "f.db"));
        var importer = new Importer(db, new HttpClient(site), new Monitor(new ImportOptions()), NullLogger<Importer>.Instance);

        var r = (await importer.FetchRecipeAsync(new Uri(url), CancellationToken.None))!;
        Assert.Equal("Pannkakor", r.Title);
        Assert.Equal(["3 dl vetemjöl", "6 dl mjölk", "3 ägg"], r.Ingredients!);
        Assert.Equal(["Vispa mjöl och mjölk.", "Vispa i äggen.", "Stek tunna pannkakor."], r.Steps!);

        var porridge = (await importer.FetchRecipeAsync(new Uri("https://x.se/text"), CancellationToken.None))!;
        Assert.Equal(["Koka vatten.", "Rör i havre."], porridge.Steps!);
        Assert.Empty(db.Recipes(0, 10).Recipes);
    }

    [Theory]
    [InlineData("Sommardröm med mandelmaräng och färska bär", "Rosa mandelmarängbottnar, grädde och bär i en enkel sommartårta.")]
    [InlineData("Morotskaka med frosting", null)]
    [InlineData("Pavlova med passionsfrukt", null)]
    [InlineData("Jordgubbar med vaniljkräm", "En somrig efterrätt.")]
    [InlineData("Havrekakor", "Gott till kaffet.")]
    public void Desserts_are_not_dinner(string title, string? description) => Assert.False(Classifier.LooksLikeDinner(title, description));

    [Theory]
    [InlineData("Pannkakor med fläsk", null)]
    [InlineData("Fiskkakor med remouladsås", null)]
    [InlineData("Kycklinggryta med ris", "En specifikt god gryta till vardags.")]
    [InlineData("Ugnsbakad lax", "Servera med potatis.")]
    public void Dinners_stay(string title, string? description) => Assert.True(Classifier.LooksLikeDinner(title, description));

    [Fact]
    public void Sweet_keywords_are_not_dinner() =>
        Assert.False(Classifier.IsDinner(new RecipeMeta("https://x.se/r/", "Sommardröm", null, null, 60, 8, ["Fest"], ["Tårta", "Sommar"])));
}
