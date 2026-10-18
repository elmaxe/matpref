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

    long[] Seed(int count)
    {
        var db = _factory.Services.GetRequiredService<Db>();
        for (var i = 0; i < count; i++)
            db.AddRecipe("Test", new RecipeMeta($"https://x.se/recept/{i}/", $"Rätt {i}", null, null, 30, 4, [], []), i % 2 == 0 ? "fast" : "storkok");
        return db.Deck("a", 100, null).Cards.Select(c => c.Id).ToArray();
    }

    async Task<JsonElement> Get(string url) => await _client.GetFromJsonAsync<JsonElement>(url);

    async Task<JsonElement> Swipe(string user, long id, bool liked)
    {
        var res = await _client.PostAsJsonAsync("/api/swipes", new { user, recipeId = id, liked });
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    static long[] Ids(JsonElement deck) => deck.GetProperty("cards").EnumerateArray().Select(c => c.GetProperty("id").GetInt64()).ToArray();

    [Fact]
    public async Task Both_users_get_the_same_deck_order()
    {
        Seed(10);
        Assert.Equal(Ids(await Get("/api/deck?user=a")), Ids(await Get("/api/deck?user=b")));
        var deck = await Get("/api/deck?user=a&category=fast&limit=3");
        Assert.Equal(3, Ids(deck).Length);
        Assert.Equal(5, deck.GetProperty("remaining").GetInt32());
    }

    [Fact]
    public async Task Partner_likes_come_first_and_partner_nos_are_skipped()
    {
        var ids = Seed(6);
        await Swipe("a", ids[4], true);
        await Swipe("a", ids[2], false);
        var deckB = Ids(await Get("/api/deck?user=b"));
        Assert.Equal(ids[4], deckB[0]);
        Assert.DoesNotContain(ids[2], deckB);
        Assert.Equal(5, deckB.Length);
        Assert.DoesNotContain(ids[4], Ids(await Get("/api/deck?user=a")));
    }

    [Fact]
    public async Task Two_likes_make_a_match_and_undo_removes_it()
    {
        var ids = Seed(3);
        Assert.Equal(JsonValueKind.Null, (await Swipe("a", ids[0], true)).GetProperty("match").ValueKind);
        var res = await Swipe("b", ids[0], true);
        Assert.Equal(ids[0], res.GetProperty("match").GetProperty("id").GetInt64());

        var matches = await Get("/api/matches");
        Assert.Equal(1, matches.GetArrayLength());
        Assert.Equal(ids[0], matches[0].GetProperty("recipe").GetProperty("id").GetInt64());

        (await _client.DeleteAsync($"/api/swipes/b/{ids[0]}")).EnsureSuccessStatusCode();
        Assert.Equal(0, (await Get("/api/matches")).GetArrayLength());
        Assert.Contains(ids[0], Ids(await Get("/api/deck?user=b")));
    }

    [Fact]
    public async Task Removed_match_does_not_come_back_in_the_deck()
    {
        var ids = Seed(2);
        await Swipe("a", ids[1], true);
        await Swipe("b", ids[1], true);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/matches/{ids[1]}")).StatusCode);
        Assert.Equal(0, (await Get("/api/matches")).GetArrayLength());
        Assert.DoesNotContain(ids[1], Ids(await Get("/api/deck?user=a")));
        Assert.DoesNotContain(ids[1], Ids(await Get("/api/deck?user=b")));
    }

    [Fact]
    public async Task Rejects_bad_input()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync("/api/deck?user=c")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync("/api/deck?user=a&category=dessert")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsJsonAsync("/api/swipes", new { user = "a", recipeId = 999, liked = true })).StatusCode);
    }

    [Fact]
    public async Task Token_is_required_when_configured_and_cors_allows_the_app()
    {
        using var factory = Factory(token: "hemlig");
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/health")).StatusCode);

        var req = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        req.Headers.Add("X-Matpref-Token", "hemlig");
        req.Headers.Add("Origin", "https://elmaxe.github.io");
        var res = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("https://elmaxe.github.io", res.Headers.GetValues("Access-Control-Allow-Origin").Single());

        var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/deck");
        preflight.Headers.Add("Origin", "https://elmaxe.github.io");
        preflight.Headers.Add("Access-Control-Request-Method", "GET");
        preflight.Headers.Add("Access-Control-Request-Headers", "x-matpref-token");
        preflight.Headers.Add("Access-Control-Request-Private-Network", "true");
        var pre = await client.SendAsync(preflight);
        Assert.True(pre.IsSuccessStatusCode);
        Assert.Equal("true", pre.Headers.GetValues("Access-Control-Allow-Private-Network").Single());
    }
}
