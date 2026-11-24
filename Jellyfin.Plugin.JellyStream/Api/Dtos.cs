using System;
using System.Collections.Generic;
using Jellyfin.Plugin.JellyStream.Seerr;

namespace Jellyfin.Plugin.JellyStream.Api;

/// <summary>A service for the client.</summary>
/// <param name="Key">URL key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Logo">Logo URL.</param>
/// <param name="Accent">Accent color.</param>
/// <param name="Movies">Movies in the library on this service.</param>
/// <param name="Shows">Shows in the library on this service.</param>
/// <param name="IntroVersion">Version of the service's TV / desktop intro video, or null when it has none.</param>
/// <param name="MobileIntroVersion">Version of the service's phone intro video, or null when it has none.</param>
public record ClientService(string Key, string Name, string? Logo, string Accent, int Movies, int Shows, string? IntroVersion = null, string? MobileIntroVersion = null);

/// <summary>Client settings.</summary>
/// <param name="Services">Enabled services, in order.</param>
/// <param name="ShowHomeRow">Whether to add the services row to the home screen.</param>
/// <param name="HomeRowTitle">Row title.</param>
/// <param name="HomeRowPosition">"top" or "bottom".</param>
/// <param name="VisualMode">"auto", "full" or "lite".</param>
/// <param name="TopCount">Top list length.</param>
/// <param name="ShowMissing">Whether titles you don't have are shown.</param>
/// <param name="AllowRequests">Whether requests are allowed.</param>
/// <param name="ConfirmRequests">Whether a second press confirms a request.</param>
/// <param name="GenreRows">Genre rows per type.</param>
/// <param name="ShowContinueWatching">Show Continue Watching.</param>
/// <param name="ShowRecentlyAdded">Show Recently Added.</param>
/// <param name="ShowPopularMissing">Show Popular to request.</param>
/// <param name="Diagnostics">Show the diagnostics panel.</param>
public record ClientConfig(
    List<ClientService> Services,
    bool ShowHomeRow,
    string HomeRowTitle,
    string HomeRowPosition,
    string VisualMode,
    int TopCount,
    bool ShowMissing,
    bool AllowRequests,
    bool ConfirmRequests,
    int GenreRows,
    bool ShowContinueWatching,
    bool ShowRecentlyAdded,
    bool ShowPopularMissing,
    bool Diagnostics = false);

/// <summary>A popular title (in the library or not).</summary>
/// <param name="TmdbId">TMDB id.</param>
/// <param name="Type">"movie" or "tv".</param>
/// <param name="Name">Title.</param>
/// <param name="Year">Year.</param>
/// <param name="Poster">Poster URL.</param>
/// <param name="Backdrop">Backdrop URL.</param>
/// <param name="Status">"available", "partial", "requested" or "missing".</param>
/// <param name="ItemId">Jellyfin item id when in the library.</param>
/// <param name="PrimaryTag">Cache tag of the library item's poster.</param>
/// <param name="BackdropTag">Cache tag of the library item's backdrop.</param>
/// <param name="LogoTag">Cache tag of the library item's title logo.</param>
/// <param name="ThumbTag">Cache tag of the library item's landscape thumb.</param>
public record TitleCard(int TmdbId, string Type, string Name, int? Year, string? Poster, string? Backdrop, string Status, Guid? ItemId, string? PrimaryTag = null, string? BackdropTag = null, string? LogoTag = null, string? ThumbTag = null);

/// <summary>A library title on a service.</summary>
/// <param name="Id">Jellyfin item id.</param>
/// <param name="Name">Title.</param>
/// <param name="Year">Year.</param>
/// <param name="Type">"movie" or "tv".</param>
/// <param name="Genres">Genres.</param>
/// <param name="Rating">Community rating.</param>
/// <param name="Added">Date added.</param>
/// <param name="PrimaryTag">Cache tag of the poster (lets the browser keep it).</param>
/// <param name="BackdropTag">Cache tag of the backdrop.</param>
/// <param name="LogoTag">Cache tag of the title logo.</param>
/// <param name="ThumbTag">Cache tag of the landscape thumb (usually art with the title on it).</param>
/// <param name="LastAdded">When something was last added to it (a show's newest episode), for "New Episode" badges.</param>
public record LibraryCard(Guid Id, string Name, int? Year, string Type, IReadOnlyList<string> Genres, float? Rating, DateTime Added, string? PrimaryTag, string? BackdropTag, string? LogoTag, string? ThumbTag, DateTime? LastAdded = null);

/// <summary>A message from the web client for the server log.</summary>
/// <param name="Message">What happened.</param>
public record ClientLog(string Message);

/// <summary>Details for a title you don't have, using Jellyfin's item field names.</summary>
/// <param name="Name">Title.</param>
/// <param name="Type">"Movie" or "Series".</param>
/// <param name="Overview">Overview.</param>
/// <param name="ProductionYear">Year.</param>
/// <param name="Genres">Genres.</param>
/// <param name="CommunityRating">Rating.</param>
/// <param name="RunTimeTicks">Runtime.</param>
/// <param name="ChildCount">Seasons.</param>
/// <param name="Status">"Continuing" or "Ended".</param>
/// <param name="EndDate">Last air date.</param>
/// <param name="BackdropUrl">Backdrop URL.</param>
/// <param name="PosterUrl">Poster URL.</param>
/// <param name="RequestStatus">"available", "partial", "requested" or "missing".</param>
public record MissingDetails(
    string Name,
    string Type,
    string? Overview,
    int? ProductionYear,
    string[] Genres,
    double? CommunityRating,
    long? RunTimeTicks,
    int? ChildCount,
    string? Status,
    string? EndDate,
    string? BackdropUrl,
    string? PosterUrl,
    string RequestStatus);

/// <summary>What to request.</summary>
public class RequestBody
{
    /// <summary>Gets or sets "movie" or "tv".</summary>
    public string Type { get; set; } = "movie";

    /// <summary>Gets or sets the TMDB id.</summary>
    public int TmdbId { get; set; }
}

/// <summary>Status for the settings page.</summary>
/// <param name="Connected">Whether Seerr answered.</param>
/// <param name="Version">Seerr version.</param>
/// <param name="Error">Connection error.</param>
/// <param name="Titles">Titles checked so far.</param>
/// <param name="LastSync">Last finished sync (UTC).</param>
/// <param name="Counts">Titles per service key.</param>
/// <param name="Injection">How the web script is loaded: "file-transformation", "index.html" or "manual".</param>
/// <param name="Syncing">Whether a sync is running now.</param>
/// <param name="SyncProgress">Sync progress (0-100) while running.</param>
public record AdminStatus(bool Connected, string? Version, string? Error, int Titles, DateTime? LastSync, Dictionary<string, int> Counts, string Injection, bool Syncing, double? SyncProgress);

/// <summary>A streaming provider for the settings page.</summary>
/// <param name="Id">TMDB provider id.</param>
/// <param name="Name">Name.</param>
/// <param name="Logo">Logo URL.</param>
/// <param name="Priority">Display priority (lower is more popular).</param>
public record ProviderInfo(int Id, string Name, string? Logo, int Priority);

/// <summary>A service's headline title.</summary>
/// <param name="Name">Title.</param>
/// <param name="Backdrop">Backdrop URL.</param>
public record FeaturedTitle(string Name, string Backdrop);

/// <summary>How one service's Top 10 (movies or shows) is being filled, and when its source last updated.</summary>
/// <param name="Service">Service name.</param>
/// <param name="Type">"Movies" or "Shows".</param>
/// <param name="Source">Where the list comes from right now.</param>
/// <param name="Titles">Titles that source has for this service.</param>
/// <param name="Updated">When that source last loaded successfully (UTC).</param>
/// <param name="Detail">Extra detail (e.g. the week Netflix's list covers).</param>
/// <param name="State">"ok", "warn", "error" or "waiting".</param>
/// <param name="Error">The last error, if the latest attempt failed.</param>
/// <param name="ErrorAt">When that error happened (UTC).</param>
public record TopStatusRow(string Service, string Type, string Source, int Titles, DateTime? Updated, string? Detail, string State, string? Error, DateTime? ErrorAt);
