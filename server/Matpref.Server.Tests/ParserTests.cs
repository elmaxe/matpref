using System.IO.Compression;
using System.Text;
using Matpref.Server;

namespace Matpref.Server.Tests;

public class ParserTests
{
    const string Url = "https://www.ica.se/recept/kycklinggryta-med-curry-123/";

    [Fact]
    public void Reads_recipe_from_json_ld_graph()
    {
        var html = """
            <html><head>
            <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
            <script type="application/ld+json">
            {"@context":"https://schema.org","@graph":[
              {"@type":"WebPage","name":"Sida"},
              {"@type":["Recipe"],"name":"Kycklinggryta med curry &amp; ris","description":"<p>Krämig   gryta</p>",
               "image":[{"@type":"ImageObject","url":"//assets.icanet.se/bild.jpg"}],
               "prepTime":"PT10M","cookTime":"PT25M","recipeYield":"4 portioner",
               "recipeCategory":["Huvudrätt","Middag"],"keywords":"kyckling, gryta, vardag"}
            ]}
            </script></head></html>
            """;
        var r = RecipeParser.Parse(html, Url)!;
        Assert.Equal("Kycklinggryta med curry & ris", r.Title);
        Assert.Equal("Krämig gryta", r.Description);
        Assert.Equal("https://assets.icanet.se/bild.jpg", r.Image);
        Assert.Equal(35, r.TotalMinutes);
        Assert.Equal(4, r.Servings);
        Assert.Equal(["Huvudrätt", "Middag"], r.Categories);
        Assert.Equal(["kyckling", "gryta", "vardag"], r.Keywords);
        Assert.Equal(Url, r.Url);
    }

    [Fact]
    public void Reads_recipe_from_top_level_array_with_string_image_and_total_time()
    {
        var html = """<script type='application/ld+json'>[{"@type":"Recipe","name":"Laxpasta","image":"/img/lax.jpg","totalTime":"PT1H5M","recipeYield":4}]</script>""";
        var r = RecipeParser.Parse(html, "https://www.arla.se/recept/laxpasta/")!;
        Assert.Equal("https://www.arla.se/img/lax.jpg", r.Image);
        Assert.Equal(65, r.TotalMinutes);
        Assert.Equal(4, r.Servings);
    }

    [Fact]
    public void Falls_back_to_open_graph_only_when_page_says_recipe()
    {
        var recipe = """<meta property="og:title" content="Pytt i panna"><meta property="og:image" content="https://x.se/p.jpg"><meta name="meta-page-type" content="recipe">""";
        Assert.Equal("Pytt i panna", RecipeParser.Parse(recipe, "https://www.koket.se/pytt")!.Title);

        var article = """<meta property="og:title" content="Så tolkar du färgen på vinet"><meta property="og:type" content="article">""";
        Assert.Null(RecipeParser.Parse(article, "https://www.koket.se/vin"));
    }

    [Fact]
    public void Skips_broken_json_ld()
    {
        var html = """<script type="application/ld+json">{ broken</script><script type="application/ld+json">{"@type":"Recipe","name":"Tacos"}</script>""";
        Assert.Equal("Tacos", RecipeParser.Parse(html, Url)!.Title);
    }

    static RecipeMeta Meta(string title, int? minutes = null, int? servings = null, string[]? categories = null, string[]? keywords = null) =>
        new(Url, title, null, null, minutes, servings, categories ?? [], keywords ?? []);

    [Fact]
    public void Filters_out_desserts_and_baking()
    {
        Assert.False(Classifier.IsDinner(Meta("Äppelpaj", categories: ["Efterrätt"])));
        Assert.False(Classifier.IsDinner(Meta("Kladdkaka med grädde")));
        Assert.False(Classifier.IsDinner(Meta("Frukostbröd", categories: ["Bakning", "Bröd"])));
        Assert.True(Classifier.IsDinner(Meta("Pannkaka med fläsk", categories: ["Huvudrätt"])));
        Assert.True(Classifier.IsDinner(Meta("Kycklinggryta", categories: ["Middag"])));
    }

    [Fact]
    public void Guesses_app_category()
    {
        Assert.Equal("finmiddag", Classifier.GuessCategory(Meta("Oxfilé med rödvinssås", 50)));
        Assert.Equal("finmiddag", Classifier.GuessCategory(Meta("Lax", 30, keywords: ["Fest"])));
        Assert.Equal("storkok", Classifier.GuessCategory(Meta("Kycklinggryta med curry", 35)));
        Assert.Equal("storkok", Classifier.GuessCategory(Meta("Ugnsbakad fläskkarré", 120)));
        Assert.Equal("storkok", Classifier.GuessCategory(Meta("Biff", 30, servings: 8)));
        Assert.Equal("fast", Classifier.GuessCategory(Meta("Stekt lax med potatis", 25)));
        Assert.Equal("fast", Classifier.GuessCategory(Meta("Tacos")));
    }

    [Fact]
    public void Parses_sitemap_index_urlset_and_gzip()
    {
        var index = """
            <?xml version="1.0" encoding="UTF-8"?>
            <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <sitemap><loc>https://x.se/recept/sitemaps/recipes/1</loc></sitemap>
              <sitemap><loc> https://x.se/recept/sitemaps/2 </loc></sitemap>
            </sitemapindex>
            """;
        var (isIndex, locs) = Sitemap.Parse(Encoding.UTF8.GetBytes(index));
        Assert.True(isIndex);
        Assert.Equal(["https://x.se/recept/sitemaps/recipes/1", "https://x.se/recept/sitemaps/2"], locs);

        var urlset = """
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://x.se/recept/a-1/</loc><lastmod>2026-01-01</lastmod><image:image><image:loc>https://x.se/a.jpg</image:loc></image:image></url><url><loc>https://x.se/recept/b-2/</loc></url></urlset>
            """;
        using var gz = new MemoryStream();
        using (var z = new GZipStream(gz, CompressionMode.Compress)) z.Write(Encoding.UTF8.GetBytes(urlset));
        (isIndex, locs) = Sitemap.Parse(gz.ToArray());
        Assert.False(isIndex);
        Assert.Equal(["https://x.se/recept/a-1/", "https://x.se/recept/b-2/"], locs);
    }
}
