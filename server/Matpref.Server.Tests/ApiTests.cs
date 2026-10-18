using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Matpref.Server;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Matpref.Server.Tests;

public sealed class ApiTests : IDisposable
{
    readonly string _dir = Directory.CreateTempSubdirectory("matpref-test").FullName;
    readonly WebApplicationFactory<Program> _factory;
    readonly HttpClient _client;

    public ApiTests()
    {
        _factory = Factory();
        _client = _factory.CreateClient();
    }

    WebApplicationFactory<Program> Factory(string token = "") => new WebApplicationFactory<Program>().WithWebHostBuilder(b => b
        .UseSetting("Matpref:DatabasePath", Path.Combine(_dir, "test.db"))
        .UseSetting("Matpref:Token", token)
        .UseSetting("Import:Enabled", "false"));

    public void Dispose()
    {
        _factory.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, recursive: true);
    }

    Db Db => _factory.Services.GetRequiredService<Db>();

    void Seed(int count)
    {
        for (var i = 0; i < count; i++)
            Db.AddRecipe("Test", new RecipeMeta($"https://x.se/recept/{i}/", $"Rätt {i}", null, null, 30, 4, [], []), "fast");
    }

    static object Change(string key, object? value, long at, string device = "phone-a") => new { key, value, updatedAt = at, device };

    async Task<JsonElement> Sync(long cursor, string? databaseId, params object[] changes)
    {
        var res = await _client.PostAsJsonAsync("/api/sync", new { databaseId, cursor, changes });
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    static Dictionary<string, string> Values(JsonElement res) =>
        res.GetProperty("changes").EnumerateArray().ToDictionary(c => c.GetProperty("key").GetString()!, c => c.GetProperty("value").GetRawText());

    [Fact]
    public async Task Sync_sends_changes_to_the_other_phone()
    {
        var a = await Sync(0, null, Change("swipe/a/1", true, 100), Change("name/a", "Axel", 100));
        var dbId = a.GetProperty("databaseId").GetString();
        var cursorA = a.GetProperty("cursor").GetInt64();

        var b = await Sync(0, null, Change("swipe/b/1", true, 110, "phone-b"));
        Assert.Equal(new Dictionary<string, string> { ["swipe/a/1"] = "true", ["name/a"] = "\"Axel\"", ["swipe/b/1"] = "true" }, Values(b));

        // Telefon A får bara det som är nytt sedan sist.
        var a2 = await Sync(cursorA, dbId);
        Assert.Equal(new Dictionary<string, string> { ["swipe/b/1"] = "true" }, Values(a2));
        Assert.Empty(Values(await Sync(a2.GetProperty("cursor").GetInt64(), dbId)));
    }

    [Fact]
    public async Task Newest_change_wins_even_if_it_arrives_first()
    {
        await Sync(0, null, Change("favorite/lasagne", true, 200, "phone-b"));
        // En telefon som varit offline skickar en äldre ändring: den ska inte skriva över.
        var res = await Sync(0, null, Change("favorite/lasagne", null, 150));
        Assert.Equal("true", Values(res)["favorite/lasagne"]);
        res = await Sync(0, null, Change("favorite/lasagne", null, 250));
        Assert.Equal("null", Values(res)["favorite/lasagne"]);
    }

    [Fact]
    public async Task New_database_makes_the_phone_start_over()
    {
        var first = await Sync(0, null, Change("rating/a/tacos", "like", 1));
        var res = await Sync(first.GetProperty("cursor").GetInt64() + 100, "en-annan-databas");
        Assert.Equal(first.GetProperty("databaseId").GetString(), res.GetProperty("databaseId").GetString());
        Assert.Equal("\"like\"", Values(res)["rating/a/tacos"]);
    }

    [Fact]
    public void Sync_pages_large_histories()
    {
        var (cursor, changes, more) = Db.Sync(0, Enumerable.Range(0, 5).Select(i =>
            new Change($"cooked/r{i}", JsonDocument.Parse("\"2026-10-18\"").RootElement, i, "x")), limit: 3);
        Assert.Equal(3, changes.Length);
        Assert.True(more);
        (_, changes, more) = Db.Sync(cursor, [], limit: 3);
        Assert.Equal(["cooked/r3", "cooked/r4"], changes.Select(c => c.Key));
        Assert.False(more);
    }

    [Fact]
    public async Task Rejects_unknown_keys()
    {
        var res = await _client.PostAsJsonAsync("/api/sync", new { cursor = 0, changes = new[] { Change("secret/x", 1, 1) } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Syncs_whole_recipes_but_not_huge_ones()
    {
        var recipe = new { name = "Lasagne", category = "storkok", steps = Enumerable.Repeat("Ett ganska långt steg i receptet.", 100) };
        var res = await Sync(0, null, Change("recipe/lasagne", recipe, 1));
        Assert.Contains("Lasagne", Values(res)["recipe/lasagne"]);

        var huge = new { name = "För stort", category = "fast", steps = Enumerable.Repeat(new string('x', 1000), 30) };
        var bad = await _client.PostAsJsonAsync("/api/sync", new { cursor = 0, changes = new[] { Change("recipe/stort", huge, 1) } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Lists_recipes_in_pages_with_their_shared_rank()
    {
        Seed(5);
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/recipes?limit=3");
        var recipes = page.GetProperty("recipes").EnumerateArray().ToArray();
        Assert.Equal(3, recipes.Length);
        Assert.True(page.GetProperty("more").GetBoolean());
        Assert.InRange(recipes[0].GetProperty("rank").GetDouble(), 0, 1);
        var rest = await _client.GetFromJsonAsync<JsonElement>($"/api/recipes?after={recipes[^1].GetProperty("id").GetInt64()}");
        Assert.Equal(2, rest.GetProperty("recipes").GetArrayLength());
        Assert.False(rest.GetProperty("more").GetBoolean());
    }

    [Fact]
    public async Task Counts_recipes_someone_has_not_swiped()
    {
        Seed(3);
        var ids = Db.Recipes(0, 10).Recipes.Select(r => r.Id).ToArray();
        await Sync(0, null, Change($"swipe/a/{ids[0]}", true, 1), Change($"swipe/b/{ids[0]}", false, 1), Change($"swipe/a/{ids[1]}", true, 1),
            Change($"swipe/b/{ids[2]}", null, 1));
        Assert.Equal(2, Db.UnswipedCount());
    }

    [Fact]
    public async Task Token_is_required_when_configured_and_cors_allows_the_app()
    {
        using var factory = Factory(token: "hemlig");
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/health")).StatusCode);
        // Dockers health check skickar ingen nyckel.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/healthz")).StatusCode);

        var req = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        req.Headers.Add("X-Matpref-Token", "hemlig");
        req.Headers.Add("Origin", "https://elmaxe.github.io");
        var res = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("https://elmaxe.github.io", res.Headers.GetValues("Access-Control-Allow-Origin").Single());

        var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/sync");
        preflight.Headers.Add("Origin", "https://elmaxe.github.io");
        preflight.Headers.Add("Access-Control-Request-Method", "POST");
        preflight.Headers.Add("Access-Control-Request-Headers", "x-matpref-token");
        preflight.Headers.Add("Access-Control-Request-Private-Network", "true");
        var pre = await client.SendAsync(preflight);
        Assert.True(pre.IsSuccessStatusCode);
        Assert.Equal("true", pre.Headers.GetValues("Access-Control-Allow-Private-Network").Single());
    }

    [Fact]
    public async Task Version_is_dev_unless_the_image_sets_it()
    {
        var dev = await _client.GetFromJsonAsync<JsonElement>("/api/version");
        Assert.Equal("dev", dev.GetProperty("version").GetString());

        using var factory = Factory().WithWebHostBuilder(b => b
            .UseSetting("MATPREF_VERSION", "3baefba")
            .UseSetting("MATPREF_BUILT", "2026-10-18T19:14:13Z"));
        var res = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/version");
        Assert.Equal("3baefba", res.GetProperty("version").GetString());
        Assert.Equal("2026-10-18T19:14:13Z", res.GetProperty("built").GetString());
    }

    [Fact]
    public async Task Allowed_origin_may_include_the_apps_path()
    {
        using var factory = Factory().WithWebHostBuilder(b => b.UseSetting("Matpref:AllowedOrigins:0", "https://elmaxe.github.io/matpref/"));
        var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/sync");
        preflight.Headers.Add("Origin", "https://elmaxe.github.io");
        preflight.Headers.Add("Access-Control-Request-Method", "POST");
        preflight.Headers.Add("Access-Control-Request-Headers", "content-type,x-matpref-token");
        var res = await factory.CreateClient().SendAsync(preflight);
        Assert.Equal("https://elmaxe.github.io", res.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task Server_errors_keep_the_cors_headers_so_the_app_can_show_them()
    {
        using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(_dir, "test.db")}"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "DROP TABLE kv";
            cmd.ExecuteNonQuery();
        }
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/sync") { Content = JsonContent.Create(new { cursor = 0, changes = Array.Empty<object>() }) };
        req.Headers.Add("Origin", "https://elmaxe.github.io");
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.InternalServerError, res.StatusCode);
        Assert.Equal("https://elmaxe.github.io", res.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Contains("kv", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task App_can_sync_without_a_preflight()
    {
        // Som appen gör: nyckeln i adressen och JSON som text/plain, så att webbläsaren inte behöver fråga först.
        using var factory = Factory(token: "hemlig");
        var client = factory.CreateClient();
        var body = new StringContent("""{"cursor":0,"changes":[{"key":"name/a","value":"Axel","updatedAt":1,"device":"d"}]}""",
            System.Text.Encoding.UTF8, "text/plain");
        var res = await client.PostAsync("/api/sync?token=hemlig", body);
        res.EnsureSuccessStatusCode();
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("\"Axel\"", Values(json)["name/a"]);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/sync?token=fel", new StringContent("{}"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/sync?token=hemlig", new StringContent("inte json"))).StatusCode);
    }
}
