using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Matpref.Server;

/// <summary>Ett recept från nätet. Rank är platsen i den gemensamma leken: lägst först, samma för er båda.</summary>
public record Card(
    long Id,
    string Source,
    string Url,
    string Title,
    string? Description,
    string? Image,
    int? TotalMinutes,
    int? Servings,
    string Category,
    double Rank);

/// <summary>
/// En ändring av appens data, t.ex. "swipe/a/12" = true eller "favorite/lasagne" = true. Null betyder borttaget.
/// Den senaste ändringen av en nyckel vinner (UpdatedAt, sedan Device), så två telefoner kan ändra offline och synka efteråt.
/// </summary>
public record Change(string Key, JsonElement Value, long UpdatedAt, string Device);

/// <summary>Allt som sparas ligger i en SQLite-fil. Två personer, några tusen recept: inget behov av mer än så.</summary>
public class Db
{
    // Nycklarna appen använder. Allt annat avvisas, så att servern inte blir en allmän lagringsplats.
    static readonly string[] KeyPrefixes = ["name/", "rating/", "favorite/", "cooked/", "swipe/", "hidden/", "recipe/"];

    readonly string _connectionString;

    public Db(string path)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(path));
        if (dir is not null) Directory.CreateDirectory(dir);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = path, Pooling = true }.ToString();
        Migrate();
    }

    /// <summary>Största tillåtna värde i tecken. Recept (ingredienser och steg) får vara större än resten.</summary>
    public static int MaxValueLength(string key) => key.StartsWith("recipe/") ? 20_000 : 2000;

    public static bool ValidKey(string key) =>
        key.Length is > 0 and <= 200 && KeyPrefixes.Any(key.StartsWith) && !key.Any(char.IsControl);

    SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        Exec(c, "PRAGMA busy_timeout = 5000;");
        return c;
    }

    void Migrate()
    {
        using var c = Open();
        Exec(c, """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                description TEXT,
                image TEXT,
                total_minutes INTEGER,
                servings INTEGER,
                category TEXT NOT NULL,
                rank REAL NOT NULL,
                added_at TEXT NOT NULL
            );
            -- Sidor importen redan har tittat på (recept eller inte), så att de inte hämtas igen.
            CREATE TABLE IF NOT EXISTS seen_urls (
                url TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                checked_at TEXT NOT NULL
            );
            -- All data från appen. seq ökar för varje ändring som servern tar emot, så att en telefon kan fråga efter allt nytt sedan sist.
            CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                device TEXT NOT NULL,
                seq INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS kv_seq ON kv(seq);
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT OR IGNORE INTO meta (key, value) VALUES ('database_id', lower(hex(randomblob(8))));
            """);
        DatabaseId = (string)Scalar(c, "SELECT value FROM meta WHERE key = 'database_id'", [])!;
    }

    /// <summary>
    /// Slumpas när databasen skapas. Om den ändras (databasen är ny eller återställd) vet appen att den ska börja om från början
    /// och skicka upp allt den har.
    /// </summary>
    public string DatabaseId { get; private set; } = "";

    /// <summary>
    /// Tar emot ändringar från en telefon och skickar tillbaka allt telefonen inte har sett (seq &gt; cursor).
    /// En ändring sparas bara om den är nyare än det servern redan har.
    /// </summary>
    public (long Cursor, Change[] Changes, bool More) Sync(long cursor, IEnumerable<Change> incoming, int limit = 2000)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        var seq = Convert.ToInt64(Scalar(c, "SELECT COALESCE(MAX(seq), 0) FROM kv", []));
        if (cursor > seq) cursor = 0;
        foreach (var ch in incoming)
        {
            var existing = Query(c, "SELECT updated_at, device FROM kv WHERE key = $key", new() { ["$key"] = ch.Key },
                r => (UpdatedAt: r.GetInt64(0), Device: r.GetString(1))).FirstOrDefault();
            var newer = existing == default || ch.UpdatedAt > existing.UpdatedAt
                || (ch.UpdatedAt == existing.UpdatedAt && string.CompareOrdinal(ch.Device, existing.Device) > 0);
            if (!newer) continue;
            Exec(c, """
                INSERT INTO kv (key, value, updated_at, device, seq) VALUES ($key, $value, $at, $device, $seq)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, device = excluded.device, seq = excluded.seq
                """, new()
            {
                ["$key"] = ch.Key, ["$value"] = ch.Value.GetRawText(), ["$at"] = ch.UpdatedAt, ["$device"] = ch.Device, ["$seq"] = ++seq,
            });
        }
        var changes = Query(c, "SELECT key, value, updated_at, device, seq FROM kv WHERE seq > $cursor ORDER BY seq LIMIT $limit",
            new() { ["$cursor"] = cursor, ["$limit"] = limit + 1 },
            r => (Change: new Change(r.GetString(0), JsonDocument.Parse(r.GetString(1)).RootElement.Clone(), r.GetInt64(2), r.GetString(3)), Seq: r.GetInt64(4)));
        tx.Commit();
        var more = changes.Count > limit;
        var page = changes.Take(limit).ToList();
        return (page.Count > 0 ? page[^1].Seq : cursor, page.Select(p => p.Change).ToArray(), more);
    }

    const string CardColumns = "id, source, url, title, description, image, total_minutes, servings, category, rank";

    static Card ReadCard(SqliteDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3),
        r.IsDBNull(4) ? null : r.GetString(4),
        r.IsDBNull(5) ? null : r.GetString(5),
        r.IsDBNull(6) ? null : r.GetInt32(6),
        r.IsDBNull(7) ? null : r.GetInt32(7),
        r.GetString(8),
        r.GetDouble(9));

    /// <summary>Recept med id större än <paramref name="after"/>. Appen hämtar dem för att kunna swipea offline.</summary>
    public (Card[] Recipes, bool More) Recipes(long after, int limit)
    {
        using var c = Open();
        var list = Query(c, $"SELECT {CardColumns} FROM recipes WHERE id > $after ORDER BY id LIMIT $limit",
            new() { ["$after"] = after, ["$limit"] = limit + 1 }, ReadCard);
        return (list.Take(limit).ToArray(), list.Count > limit);
    }

    /// <summary>Antal recept som minst en av er inte har swipat. Styr om importen behöver hämta fler.</summary>
    public int UnswipedCount()
    {
        using var c = Open();
        return Convert.ToInt32(Scalar(c, """
            SELECT COUNT(*) FROM recipes r
            WHERE (SELECT COUNT(*) FROM kv WHERE key IN ('swipe/a/' || r.id, 'swipe/b/' || r.id) AND value != 'null') < 2
            """, []));
    }

    public Dictionary<string, int> CountBySource()
    {
        using var c = Open();
        return Query(c, "SELECT source, COUNT(*) FROM recipes GROUP BY source", [], r => (r.GetString(0), r.GetInt32(1)))
            .ToDictionary(x => x.Item1, x => x.Item2);
    }

    public HashSet<string> SeenUrls(string source)
    {
        using var c = Open();
        return Query(c, "SELECT url FROM seen_urls WHERE source = $s", new() { ["$s"] = source }, r => r.GetString(0)).ToHashSet();
    }

    public void MarkSeen(string source, string url, string status)
    {
        using var c = Open();
        Exec(c, "INSERT OR REPLACE INTO seen_urls (url, source, status, checked_at) VALUES ($url, $s, $status, $now)",
            new() { ["$url"] = url, ["$s"] = source, ["$status"] = status, ["$now"] = DateTime.UtcNow.ToString("O") });
    }

    /// <summary>Lägger till ett recept på en slumpad plats i leken. Returnerar false om adressen redan finns.</summary>
    public bool AddRecipe(string source, RecipeMeta r, string category)
    {
        using var c = Open();
        return Exec(c, """
            INSERT OR IGNORE INTO recipes (source, url, title, description, image, total_minutes, servings, category, rank, added_at)
            VALUES ($source, $url, $title, $description, $image, $minutes, $servings, $category, $rank, $now)
            """, new()
        {
            ["$source"] = source, ["$url"] = r.Url, ["$title"] = r.Title, ["$description"] = r.Description, ["$image"] = r.Image,
            ["$minutes"] = r.TotalMinutes, ["$servings"] = r.Servings, ["$category"] = category, ["$rank"] = Random.Shared.NextDouble(),
            ["$now"] = DateTime.UtcNow.ToString("O"),
        }) > 0;
    }

    static SqliteCommand Command(SqliteConnection c, string sql, Dictionary<string, object?>? args)
    {
        var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args ?? []) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        return cmd;
    }

    static int Exec(SqliteConnection c, string sql, Dictionary<string, object?>? args = null)
    {
        using var cmd = Command(c, sql, args);
        return cmd.ExecuteNonQuery();
    }

    static object? Scalar(SqliteConnection c, string sql, Dictionary<string, object?> args)
    {
        using var cmd = Command(c, sql, args);
        return cmd.ExecuteScalar();
    }

    static List<T> Query<T>(SqliteConnection c, string sql, Dictionary<string, object?> args, Func<SqliteDataReader, T> read)
    {
        using var cmd = Command(c, sql, args);
        using var r = cmd.ExecuteReader();
        var list = new List<T>();
        while (r.Read()) list.Add(read(r));
        return list;
    }
}
