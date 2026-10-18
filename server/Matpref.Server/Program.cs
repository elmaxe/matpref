using System.Net;
using Matpref.Server;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<MatprefOptions>(builder.Configuration.GetSection("Matpref"));
builder.Services.Configure<ImportOptions>(builder.Configuration.GetSection("Import"));
builder.Services.AddSingleton(sp => new Db(sp.GetRequiredService<IOptions<MatprefOptions>>().Value.DatabasePath));
builder.Services.AddHttpClient(nameof(Importer), http =>
    {
        http.Timeout = TimeSpan.FromSeconds(30);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Matpref/1.0 (+https://github.com/elmaxe/matpref)");
        http.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xml;q=0.9,*/*;q=0.8");
        http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("sv-SE,sv;q=0.9");
    })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All });
builder.Services.AddSingleton(sp =>
    ActivatorUtilities.CreateInstance<Importer>(sp, sp.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(Importer))));
builder.Services.AddHostedService(sp => sp.GetRequiredService<Importer>());

var origins = builder.Configuration.GetSection("Matpref:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// Chrome frågar innan en publik sida (github.io) får anropa en adress i hemnätverket. Svara ja på den frågan.
app.Use(async (ctx, next) =>
{
    if (HttpMethods.IsOptions(ctx.Request.Method) && ctx.Request.Headers.ContainsKey("Access-Control-Request-Private-Network"))
        ctx.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
    await next();
});
app.UseCors();

// Valfri delad nyckel. Servern ska ligga bakom VPN, men en nyckel skadar inte.
app.Use(async (ctx, next) =>
{
    var token = ctx.RequestServices.GetRequiredService<IOptions<MatprefOptions>>().Value.Token;
    if (!string.IsNullOrEmpty(token) && ctx.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsOptions(ctx.Request.Method)
        && ctx.Request.Headers["X-Matpref-Token"] != token)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new { error = "Fel eller saknad nyckel" });
        return;
    }
    await next();
});

static bool ValidUser(string? user) => user is not null && Db.Users.Contains(user);
static IResult BadUser() => Results.BadRequest(new { error = "user måste vara a eller b" });
string[] categories = ["fast", "storkok", "finmiddag"];

var api = app.MapGroup("/api");

api.MapGet("/health", (Db db, Importer importer) => new
{
    ok = true,
    recipes = db.CountBySource(),
    importing = importer.IsRunning,
});

api.MapGet("/deck", (Db db, string user, int? limit, string? category) =>
{
    if (!ValidUser(user)) return BadUser();
    if (category is not null && !categories.Contains(category)) return Results.BadRequest(new { error = "Okänd kategori" });
    return Results.Ok(db.Deck(user, Math.Clamp(limit ?? 20, 1, 100), category));
});

api.MapPost("/swipes", (Db db, SwipeRequest req) =>
{
    if (!ValidUser(req.User)) return BadUser();
    var (found, match) = db.Swipe(req.User, req.RecipeId, req.Liked);
    return found ? Results.Ok(new { match }) : Results.NotFound(new { error = "Receptet finns inte" });
});

api.MapDelete("/swipes/{user}/{recipeId:long}", (Db db, string user, long recipeId) =>
{
    if (!ValidUser(user)) return BadUser();
    db.Undo(user, recipeId);
    return Results.NoContent();
});

api.MapGet("/matches", (Db db) => db.Matches());

api.MapDelete("/matches/{recipeId:long}", (Db db, long recipeId) =>
    db.RemoveMatch(recipeId) ? Results.NoContent() : Results.NotFound());

// Starta en import direkt i stället för att vänta på nästa schemalagda.
api.MapPost("/import", (Importer importer, IHostApplicationLifetime life) =>
{
    if (importer.IsRunning) return Results.Conflict(new { error = "En import pågår redan" });
    _ = Task.Run(() => importer.RunAsync(force: true, life.ApplicationStopping));
    return Results.Accepted();
});

app.Run();

record SwipeRequest(string User, long RecipeId, bool Liked);

public partial class Program;
