namespace Matpref.Server;

/// <summary>Grova gissningar utifrån receptets namn, kategorier och nyckelord. Appens kategorier är fast, storkok och finmiddag.</summary>
public static class Classifier
{
    // Recept i de här kategorierna är inte middag (efterrätter, bakning, drycker och tillbehör).
    static readonly string[] NotDinnerCategories =
    [
        "efterrätt", "dessert", "bakning", "bakverk", "kaka", "kakor", "tårta", "tårtor", "bullar", "bröd", "dryck", "drink",
        "cocktail", "godis", "konfekt", "sylt", "marmelad", "frukost", "mellanmål", "fika", "glass", "sås", "såser", "dressing",
        "tillbehör", "dipp", "smoothie", "snacks", "pålägg",
    ];

    // Nyckelord som betyder söt eller inte middag. Kortare än listan ovan, eftersom nyckelord på en middag kan vara
    // t.ex. "sås" eller "bröd".
    static readonly string[] SweetKeywords =
    [
        "efterrätt", "dessert", "bakning", "bakverk", "kaka", "kakor", "tårta", "tårtor", "godis", "konfekt", "glass", "fika",
        "dryck", "drink", "cocktail", "smoothie", "mellanmål",
    ];

    // Säkra tecken i namnet på att det inte är middag. Kakor känns igen för sig (se IsSweetName), eftersom pannkaka är middag.
    static readonly string[] NotDinnerNames =
    [
        "muffins", "cookies", "cupcake", "chokladboll", "smoothie", "drink", "lemonad", "saft", "glass", "sorbet", "cheesecake",
        "brownie", "kanelbulle", "semla", "tryffel", "marmelad", "tårt", "maräng", "pavlova", "pannacotta", "panna cotta",
        "tiramisu", "crumble", "smulpaj", "äppelpaj", "parfait", "mazarin", "biskvi", "fudge", "praliner", "bakelse", "efterrätt",
        "dessert", "glögg", "sockerkaka", "toscakaka",
    ];

    // Tecken i beskrivningen, t.ex. "en fantastisk sommartårta" eller "gott till kaffet".
    static readonly string[] NotDinnerDescriptions = ["efterrätt", "dessert", "tårta", "tårtor", "maräng", "bakverk", "fika", "kaffet", "godis"];

    // Kakor som är middag: pannkaka, potatiskakor, fiskkakor och liknande.
    static readonly string[] SavoryCakes = ["pannkak", "potatis", "fisk", "lax", "kött", "kyckling", "grönsak", "sill", "krabb"];

    static readonly string[] Fancy =
    [
        "finmiddag", "fest", "helg", "lyx", "middagsbjudning", "trerätters", "oxfilé", "hummer", "pilgrimsmussl", "ankbröst",
        "lammfilé", "lammracks", "rådjur", "hjortfilé", "kalvfilé", "tryffel", "jul", "nyår", "påsk", "högtid",
    ];

    static readonly string[] BigBatch =
    [
        "storkok", "matlåda", "matlådor", "gryta", "grytor", "soppa", "soppor", "lasagne", "köttfärssås", "chili", "ragu",
        "gratäng", "bolognese", "frys",
    ];

    static readonly string[] Quick = ["snabb", "vardag", "enkel", "minuter", "pasta", "wok"];

    public static bool IsDinner(RecipeMeta r)
    {
        if (Tokens(r.Categories).Any(t => NotDinnerCategories.Any(k => t == k || (k.Length >= 5 && t.Contains(k))))) return false;
        if (Tokens(r.Keywords).Any(t => SweetKeywords.Any(k => t == k || (k.Length >= 5 && t.Contains(k))))) return false;
        return LooksLikeDinner(r.Title, r.Description);
    }

    /// <summary>
    /// Det som går att avgöra av bara namn och beskrivning. Används också för att städa bort recept som redan är importerade,
    /// eftersom databasen inte sparar sajtens kategorier.
    /// </summary>
    public static bool LooksLikeDinner(string title, string? description)
    {
        var name = title.ToLowerInvariant();
        if (NotDinnerNames.Any(name.Contains)) return false;
        // Kakor (kladdkaka, morotskaka, havrekakor), men inte pannkaka eller fiskkakor.
        if (Tokens([title]).Any(t => (t.EndsWith("kaka") || t.EndsWith("kakor")) && !SavoryCakes.Any(t.Contains))) return false;
        return !Matches(Tokens([description ?? ""]), NotDinnerDescriptions);
    }

    public static string GuessCategory(RecipeMeta r)
    {
        var tokens = Tokens([r.Title, .. r.Categories, .. r.Keywords]);
        if (Matches(tokens, Fancy)) return "finmiddag";
        if (Matches(tokens, BigBatch) || r.Servings >= 6 || r.TotalMinutes >= 90) return "storkok";
        if (r.TotalMinutes <= 40 || Matches(tokens, Quick)) return "fast";
        return r.TotalMinutes >= 60 ? "storkok" : "fast";
    }

    // Korta ord måste stå först i ordet ("fest" i "festmat"), långa får stå var som helst ("gryta" i "kycklinggryta").
    static bool Matches(string[] tokens, string[] keywords) =>
        tokens.Any(t => keywords.Any(k => k.Length >= 5 ? t.Contains(k) : t.StartsWith(k)));

    static string[] Tokens(IEnumerable<string> texts) =>
        texts.SelectMany(t => t.ToLowerInvariant().Split((char[])[' ', ',', '-', '/', '&', '(', ')', '.', '!', ':', ';', '"', '\''], StringSplitOptions.RemoveEmptyEntries)).ToArray();
}
