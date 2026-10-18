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

    // Säkra tecken i själva namnet på att det inte är middag. "Kaka" saknas med flit: pannkaka är middag.
    static readonly string[] NotDinnerNames =
    [
        "muffins", "cookies", "cupcake", "kladdkaka", "chokladboll", "smoothie", "drink", "lemonad", "saft", "glass", "sorbet",
        "cheesecake", "brownie", "kanelbulle", "semla", "tryffel", "marmelad",
    ];

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
        var categories = Tokens(r.Categories);
        if (categories.Any(t => NotDinnerCategories.Any(k => t == k || (k.Length >= 5 && t.Contains(k))))) return false;
        var name = r.Title.ToLowerInvariant();
        return !NotDinnerNames.Any(name.Contains);
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
