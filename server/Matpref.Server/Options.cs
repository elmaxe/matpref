namespace Matpref.Server;

/// <summary>Inställningar under "Matpref" i appsettings.json eller som miljövariabler (Matpref__Token osv).</summary>
public class MatprefOptions
{
    public string DatabasePath { get; set; } = "/data/matpref.db";

    /// <summary>Om satt måste appen skicka samma värde i X-Matpref-Token. Tomt = ingen kontroll (servern ligger bakom VPN).</summary>
    public string? Token { get; set; }

    /// <summary>Webbadresser som får anropa API:t från en webbläsare (CORS).</summary>
    public string[] AllowedOrigins { get; set; } = [];
}

public class ImportOptions
{
    public bool Enabled { get; set; } = true;

    /// <summary>Hur ofta importen kollar om det behövs fler recept.</summary>
    public double IntervalHours { get; set; } = 12;

    /// <summary>Importen hämtar bara nya recept när färre än så här finns kvar som någon av er inte har swipat.</summary>
    public int TargetUnswiped { get; set; } = 150;

    /// <summary>Max antal nya recept per källa och körning.</summary>
    public int MaxNewPerSource { get; set; } = 40;

    /// <summary>Paus mellan anrop till samma sajt, för att inte belasta den.</summary>
    public int DelayMs { get; set; } = 1500;

    public List<SourceOptions> Sources { get; set; } = [];
}

public class SourceOptions
{
    public string Name { get; set; } = "";

    /// <summary>Sitemaps (eller sitemap-index) som listar receptsidorna.</summary>
    public string[] Sitemaps { get; set; } = [];

    /// <summary>Regex: vilka undersitemaps i ett index som ska följas. Tomt = alla.</summary>
    public string? SitemapPattern { get; set; }

    /// <summary>Regex: vilka adresser i sitemapen som är receptsidor. Tomt = alla.</summary>
    public string? UrlPattern { get; set; }
}
