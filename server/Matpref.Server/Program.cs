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

var api = app.MapGroup("/api");

api.MapGet("/health", (Db db, Importer importer) => new
{
    ok = true,
    recipes = db.CountBySource(),
    importing = importer.IsRunning,
});

// Appen är local first: den sparar allt lokalt och synkar hit när den kan. Se Db.Sync.
api.MapPost("/sync", (Db db, SyncRequest req) =>
{
    var changes = req.Changes ?? [];
    if (changes.Length > 5000) return Results.BadRequest(new { error = "För många ändringar på en gång" });
    var bad = changes.FirstOrDefault(ch => !Db.ValidKey(ch.Key) || ch.Device is not { Length: > 0 and <= 64 }
        || ch.Value.ValueKind == System.Text.Json.JsonValueKind.Undefined || ch.Value.GetRawText().Length > 2000);
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
