using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.JellyStream.Configuration;

/// <summary>
/// When a title that is only for rent or purchase counts toward a service.
/// </summary>
public enum RentBuyRule
{
    /// <summary>Only titles included with the subscription count.</summary>
    Off = 0,

    /// <summary>Rent/buy titles count when no subscription service anywhere includes them.</summary>
    NotOnAnySubscription = 1,

    /// <summary>Rent/buy titles count when none of your enabled services include them.</summary>
    NotOnMyServices = 2
}

/// <summary>
/// One streaming service shown in JellyStream.
/// </summary>
public class ServiceEntry
{
    /// <summary>Gets or sets a short, stable key used in URLs (e.g. "netflix").</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Gets or sets the display name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether the service is shown.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the TMDB watch provider ids that count as this service (plans and add-ons).</summary>
    public int[] ProviderIds { get; set; } = [];

    /// <summary>Gets or sets the TMDB rent/buy store ids tied to this service (e.g. Amazon Video for Prime Video).</summary>
    public int[] RentBuyProviderIds { get; set; } = [];

    /// <summary>Gets or sets a custom logo URL; empty uses the TMDB logo.</summary>
    public string LogoUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets an accent color (CSS), empty for automatic.</summary>
    public string Accent { get; set; } = string.Empty;
}

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    // ---- Seerr ----

    /// <summary>Gets or sets the Seerr (Jellyseerr/Overseerr) address the server can reach.</summary>
    public string SeerrUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the Seerr API key.</summary>
    public string SeerrApiKey { get; set; } = string.Empty;

    /// <summary>Gets or sets the streaming region (ISO 3166-1, e.g. US).</summary>
    public string Region { get; set; } = "US";

    // ---- Services ----

    /// <summary>Gets or sets the services, in display order.</summary>
    public ServiceEntry[] Services { get; set; } = DefaultServices();

    /// <summary>Gets or sets when rent/buy titles count toward a service.</summary>
    public RentBuyRule RentBuy { get; set; } = RentBuyRule.NotOnAnySubscription;

    // ---- Content ----

    /// <summary>Gets or sets what the Top lists rank by: "week" (trending this week), "day" (trending today) or "popular".</summary>
    public string TopSource { get; set; } = "week";

    /// <summary>Gets or sets a value indicating whether Netflix's Top 10 uses Netflix's own published weekly list (falls back to trending).</summary>
    public bool OfficialNetflixTop10 { get; set; } = true;

    /// <summary>Gets or sets how many pages (20 titles each) of trending titles are checked per type.</summary>
    public int TrendingPages { get; set; } = 10;

    /// <summary>Gets or sets how many titles the Top lists show.</summary>
    public int TopCount { get; set; } = 10;

    /// <summary>Gets or sets a value indicating whether titles you don't have appear (with a request option).</summary>
    public bool ShowMissing { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether users can request missing titles.</summary>
    public bool AllowRequests { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether a second press is needed to confirm a request.</summary>
    public bool ConfirmRequests { get; set; }

    /// <summary>Gets or sets a value indicating whether requests are made as the matching Seerr user.</summary>
    public bool RequestAsUser { get; set; } = true;

    /// <summary>Gets or sets the maximum number of genre rows per type on a service page.</summary>
    public int GenreRows { get; set; } = 6;

    /// <summary>Gets or sets a value indicating whether the service page shows a Continue Watching row.</summary>
    public bool ShowContinueWatching { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether the service page shows a Recently Added row.</summary>
    public bool ShowRecentlyAdded { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether the service page shows a "Popular to request" row.</summary>
    public bool ShowPopularMissing { get; set; } = true;

    // ---- Home screen ----

    /// <summary>Gets or sets a value indicating whether the services row is added to the home screen.</summary>
    public bool ShowHomeRow { get; set; } = true;

    /// <summary>Gets or sets the services row title.</summary>
    public string HomeRowTitle { get; set; } = "Streaming services";

    /// <summary>Gets or sets where the row goes: "top" or "bottom".</summary>
    public string HomeRowPosition { get; set; } = "top";

    /// <summary>Gets or sets a value indicating whether services with nothing in your library are hidden.</summary>
    public bool HideEmptyServices { get; set; }

    /// <summary>Gets or sets a value indicating whether the web client shows the diagnostics panel.</summary>
    public bool Diagnostics { get; set; }

    /// <summary>Gets or sets the visual mode: "auto", "full" or "lite" (for low-power devices).</summary>
    public string VisualMode { get; set; } = "auto";

    /// <summary>Gets or sets a value indicating whether the script is added to the web client automatically.</summary>
    public bool AutoInject { get; set; } = true;

    // ---- Sync ----

    /// <summary>Gets or sets how many days a title's availability is trusted before it is checked again.</summary>
    public int RefreshDays { get; set; } = 3;

    /// <summary>Gets or sets how many Seerr lookups run at once during sync.</summary>
    public int SyncConcurrency { get; set; } = 4;

    /// <summary>
    /// The default services. Several provider ids per service cover plans and add-ons (ads tiers etc.).
    /// </summary>
    /// <returns>The default list.</returns>
    public static ServiceEntry[] DefaultServices() =>
    [
        new ServiceEntry { Key = "netflix", Name = "Netflix", ProviderIds = [8, 1796] },
        new ServiceEntry { Key = "disney", Name = "Disney+", ProviderIds = [337] },
        new ServiceEntry { Key = "max", Name = "HBO Max", ProviderIds = [1899, 384] },
        new ServiceEntry { Key = "prime", Name = "Prime Video", ProviderIds = [9, 119], RentBuyProviderIds = [10] },
        new ServiceEntry { Key = "hulu", Name = "Hulu", ProviderIds = [15] },
        new ServiceEntry { Key = "apple", Name = "Apple TV+", ProviderIds = [350], RentBuyProviderIds = [2] },
        new ServiceEntry { Key = "paramount", Name = "Paramount+", ProviderIds = [531, 2303, 2616] },
        new ServiceEntry { Key = "peacock", Name = "Peacock", ProviderIds = [386, 387] },
    ];
}
