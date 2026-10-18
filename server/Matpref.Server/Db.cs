using Microsoft.Data.Sqlite;

namespace Matpref.Server;

public record Card(
    long Id,
    string Source,
    string Url,
    string Title,
    string? Description,
    string? Image,
    int? TotalMinutes,
    int? Servings,
    string Category);

public record MatchItem(Card Recipe, string MatchedAt);

public record Deck(Card[] Cards, int Remaining);

/// <summary>Allt som sparas ligger i en SQLite-fil. Två personer, några tusen recept: inget behov av mer än så.</summary>
public class Db
{
    public static readonly string[] Users = ["a", "b"];

    readonly string _connectionString;

    public Db(string path)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(path));
        if (dir is not null) Directory.CreateDirectory(dir);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = path, Pooling = true }.ToString();
        Migrate();
    }

    public static string Partner(string user) => user == "a" ? "b" : "a";

    SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        Exec(c, "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
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
            CREATE INDEX IF NOT EXISTS recipes_rank ON recipes(rank);
            -- Sidor importen redan har tittat på (recept eller inte), så att de inte hämtas igen.
            CREATE TABLE IF NOT EXISTS seen_urls (
                url TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                checked_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS swipes (
                user TEXT NOT NULL,
                recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                liked INTEGER NOT NULL,
                at TEXT NOT NULL,
                PRIMARY KEY (user, recipe_id)
            );
            CREATE TABLE IF NOT EXISTS matches (
                recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
                matched_at TEXT NOT NULL
            );
            """);
    }

    const string CardColumns = "r.id, r.source, r.url, r.title, r.description, r.image, r.total_minutes, r.servings, r.category";

    static Card ReadCard(SqliteDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3),
        r.IsDBNull(4) ? null : r.GetString(4),
        r.IsDBNull(5) ? null : r.GetString(5),
        r.IsDBNull(6) ? null : r.GetInt32(6),
        r.IsDBNull(7) ? null : r.GetInt32(7),
        r.GetString(8));

    /// <summary>
    /// Nästa kort för en person. Ordningen bestäms här så att båda ser samma lek: först det partnern redan har gillat
    /// (där kan det bli match direkt), sedan resten i en gemensam slumpad ordning. Det partnern har sagt nej till visas inte.
    /// </summary>
    public Deck Deck(string user, int limit, string? category)
    {
        using var c = Open();
        const string from = """
            FROM recipes r
            LEFT JOIN swipes mine ON mine.recipe_id = r.id AND mine.user = $user
            LEFT JOIN swipes theirs ON theirs.recipe_id = r.id AND theirs.user = $partner
            WHERE mine.recipe_id IS NULL AND (theirs.liked IS NULL OR theirs.liked = 1)
              AND ($category IS NULL OR r.category = $category)
            """;
        var args = new Dictionary<string, object?> { ["$user"] = user, ["$partner"] = Partner(user), ["$category"] = category, ["$limit"] = limit };
        var cards = Query(c, $"SELECT {CardColumns} {from} ORDER BY theirs.liked IS NULL, theirs.at, r.rank LIMIT $limit", args, ReadCard);
        var remaining = Convert.ToInt32(Scalar(c, $"SELECT COUNT(*) {from}", args));
        return new Deck(cards.ToArray(), remaining);
    }

    /// <summary>Sparar en swipe. Returnerar receptet om det blev match.</summary>
    public (bool Found, Card? Match) Swipe(string user, long recipeId, bool liked)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        var now = Now();
        if (Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM recipes WHERE id = $id", new() { ["$id"] = recipeId })) == 0) return (false, null);
        Exec(c, """
            INSERT INTO swipes (user, recipe_id, liked, at) VALUES ($user, $id, $liked, $now)
            ON CONFLICT (user, recipe_id) DO UPDATE SET liked = excluded.liked, at = excluded.at
            """, new() { ["$user"] = user, ["$id"] = recipeId, ["$liked"] = liked, ["$now"] = now });
        Card? match = null;
        var partnerLiked = Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM swipes WHERE user = $p AND recipe_id = $id AND liked = 1",
            new() { ["$p"] = Partner(user), ["$id"] = recipeId })) > 0;
        if (liked && partnerLiked)
        {
            Exec(c, "INSERT OR IGNORE INTO matches (recipe_id, matched_at) VALUES ($id, $now)", new() { ["$id"] = recipeId, ["$now"] = now });
            match = Query(c, $"SELECT {CardColumns} FROM recipes r WHERE r.id = $id", new() { ["$id"] = recipeId }, ReadCard).Single();
        }
        else
        {
            Exec(c, "DELETE FROM matches WHERE recipe_id = $id", new() { ["$id"] = recipeId });
        }
        tx.Commit();
        return (true, match);
    }

    /// <summary>Ångra en swipe. En match på receptet försvinner också.</summary>
    public void Undo(string user, long recipeId)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        var args = new Dictionary<string, object?> { ["$user"] = user, ["$id"] = recipeId };
        Exec(c, "DELETE FROM swipes WHERE user = $user AND recipe_id = $id", args);
        Exec(c, "DELETE FROM matches WHERE recipe_id = $id", args);
        tx.Commit();
    }

    public MatchItem[] Matches()
    {
        using var c = Open();
        return Query(c, $"SELECT {CardColumns}, m.matched_at FROM matches m JOIN recipes r ON r.id = m.recipe_id ORDER BY m.matched_at DESC",
            [], r => new MatchItem(ReadCard(r), r.GetString(9))).ToArray();
    }

    /// <summary>Tar bort en match från listan. Swipesen ligger kvar, så receptet kommer inte tillbaka i leken.</summary>
    public bool RemoveMatch(long recipeId)
    {
        using var c = Open();
        return Exec(c, "DELETE FROM matches WHERE recipe_id = $id", new() { ["$id"] = recipeId }) > 0;
    }

    /// <summary>Antal recept som minst en av er inte har swipat. Styr om importen behöver hämta fler.</summary>
    public int UnswipedCount()
    {
        using var c = Open();
        return Convert.ToInt32(Scalar(c, "SELECT COUNT(*) FROM recipes r WHERE (SELECT COUNT(*) FROM swipes s WHERE s.recipe_id = r.id) < 2", []));
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
            new() { ["$url"] = url, ["$s"] = source, ["$status"] = status, ["$now"] = Now() });
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
            ["$now"] = Now(),
        }) > 0;
    }

    static string Now() => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

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
