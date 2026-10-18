using System.Net;
using System.Text.Json;
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

// Webbläsaren skickar bara schema och värd ("https://elmaxe.github.io"), så sökväg och snedstreck i inställningen tas bort.
var origins = (builder.Configuration.GetSection("Matpref:AllowedOrigins").Get<string[]>() ?? [])
    .Select(o => Uri.TryCreate(o.Trim(), UriKind.Absolute, out var u) ? u.GetLeftPart(UriPartial.Authority) : o.Trim())
    .ToArray();
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

// Ett fel i servern ska synas som ett fel i appen. Utan det här försvinner CORS-headrarna med felet, och webbläsaren
// rapporterar det som ett CORS-problem i stället.
app.Use(async (ctx, next) =>
{
    try
    {
        await next();
    }
    catch (Exception e) when (!ctx.Response.HasStarted && !ctx.RequestAborted.IsCancellationRequested)
    {
        ctx.RequestServices.GetRequiredService<ILogger<Program>>().LogError(e, "Fel vid {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
        ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await ctx.Response.WriteAsJsonAsync(new { error = e.Message });
    }
});

// Valfri delad nyckel. Servern ska ligga bakom VPN, men en nyckel skadar inte.
// Appen skickar den som ?token=, så att webbläsaren inte behöver fråga servern först (en CORS-preflight), se src/server.ts.
// Headern X-Matpref-Token fungerar också, t.ex. med curl.
app.Use(async (ctx, next) =>
{
    var token = ctx.RequestServices.GetRequiredService<IOptions<MatprefOptions>>().Value.Token;
    if (!string.IsNullOrEmpty(token) && ctx.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsOptions(ctx.Request.Method)
        && ctx.Request.Headers["X-Matpref-Token"] != token && ctx.Request.Query["token"] != token)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new { error = "Fel eller saknad nyckel" });
        return;
    }
    await next();
});

// För Dockers health check. Ligger utanför /api så att den svarar utan nyckel.
app.MapGet("/healthz", () => "ok");

var api = app.MapGroup("/api");

api.MapGet("/health", (Db db, Importer importer) => new
{
    ok = true,
    recipes = db.CountBySource(),
    importing = importer.IsRunning,
});

// Vilken version servern kör. Sätts när Docker-imagen byggs (se Dockerfile), annars "dev".
api.MapGet("/version", (IConfiguration config) => new
{
    version = config["MATPREF_VERSION"] is { Length: > 0 } v ? v : "dev",
    built = config["MATPREF_BUILT"] is { Length: > 0 } b ? b : null,
});

// Appen är local first: den sparar allt lokalt och synkar hit när den kan. Se Db.Sync.
// Appen skickar JSON som text/plain, så att webbläsaren inte gör en CORS-preflight. Därför läses kroppen här i stället
// för att låta ASP.NET göra det (det kräver application/json).
api.MapPost("/sync", async (Db db, HttpRequest http) =>
{
    SyncRequest? req;
    try
    {
        req = await JsonSerializer.DeserializeAsync<SyncRequest>(http.Body, JsonSerializerOptions.Web, http.HttpContext.RequestAborted);
    }
    catch (JsonException)
    {
        req = null;
    }
    if (req is null) return Results.BadRequest(new { error = "Ogiltig JSON" });
    var changes = req.Changes ?? [];
    if (changes.Length > 5000) return Results.BadRequest(new { error = "För många ändringar på en gång" });
    var bad = changes.FirstOrDefault(ch => !Db.ValidKey(ch.Key) || ch.Device is not { Length: > 0 and <= 64 }
        || ch.Value.ValueKind == JsonValueKind.Undefined || ch.Value.GetRawText().Length > 2000);
    if (bad is not null) return Results.BadRequest(new { error = $"Ogiltig ändring: {bad.Key}" });
    // En annan databas än telefonen synkade med sist: börja om från början.
    var cursor = req.DatabaseId == db.DatabaseId ? req.Cursor : 0;
    var (next, outgoing, more) = db.Sync(cursor, changes);
    return Results.Ok(new SyncResponse(db.DatabaseId, next, outgoing, more));
});

// Recepten från nätet. Appen hämtar alla nya så att den kan swipea offline.
api.MapGet("/recipes", (Db db, long? after, int? limit) =>
{
    var (recipes, more) = db.Recipes(after ?? 0, Math.Clamp(limit ?? 500, 1, 1000));
    return new { recipes, more };
});

// Starta en import direkt i stället för att vänta på nästa schemalagda.
api.MapPost("/import", (Importer importer, IHostApplicationLifetime life) =>
{
    if (importer.IsRunning) return Results.Conflict(new { error = "En import pågår redan" });
    _ = Task.Run(() => importer.RunAsync(force: true, life.ApplicationStopping));
    return Results.Accepted();
});

app.Run();

record SyncRequest(string? DatabaseId, long Cursor, Change[]? Changes);

record SyncResponse(string DatabaseId, long Cursor, Change[] Changes, bool More);

public partial class Program;
