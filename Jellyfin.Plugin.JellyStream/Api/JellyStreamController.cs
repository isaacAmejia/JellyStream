using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Mime;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.JellyStream.Catalog;
using Jellyfin.Plugin.JellyStream.Configuration;
using Jellyfin.Plugin.JellyStream.Seerr;
using Jellyfin.Plugin.JellyStream.Tasks;
using Jellyfin.Plugin.JellyStream.Web;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using ImageType = MediaBrowser.Model.Entities.ImageType;

namespace Jellyfin.Plugin.JellyStream.Api;

/// <summary>
/// JellyStream's API, used by the web client script and the settings page.
/// </summary>
[ApiController]
[Route("JellyStream")]
[Authorize]
public class JellyStreamController : ControllerBase
{
    private const string TmdbImages = "https://image.tmdb.org/t/p/";

    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;
    private readonly ITaskManager _taskManager;
    private readonly SeerrClient _seerr;
    private readonly AvailabilityStore _store;
    private readonly TrendingService _trending;
    private readonly IntroStore _intros;
    private readonly ILogger<JellyStreamController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="JellyStreamController"/> class.
    /// </summary>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="userManager">User manager.</param>
    /// <param name="taskManager">Task manager.</param>
    /// <param name="seerr">Seerr client.</param>
    /// <param name="store">Availability store.</param>
    /// <param name="trending">Trending lists.</param>
    /// <param name="intros">Intro videos.</param>
    /// <param name="logger">Logger.</param>
    public JellyStreamController(
        ILibraryManager libraryManager,
        IUserManager userManager,
        ITaskManager taskManager,
        SeerrClient seerr,
        AvailabilityStore store,
        TrendingService trending,
        IntroStore intros,
        ILogger<JellyStreamController> logger)
    {
        _libraryManager = libraryManager;
        _userManager = userManager;
        _taskManager = taskManager;
        _seerr = seerr;
        _store = store;
        _trending = trending;
        _intros = intros;
        _logger = logger;
    }

    private static PluginConfiguration Config => Plugin.Instance!.Configuration;

    // ------------------------------------------------------------------ client

    /// <summary>The web client script (loaded by JavaScript Injector).</summary>
    /// <returns>The script.</returns>
    [HttpGet("client.js")]
    [AllowAnonymous]
    public ActionResult GetClientScript()
    {
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Jellyfin.Plugin.JellyStream.Web.client.js");
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-cache";
        return File(stream, "application/javascript; charset=utf-8");
    }

    /// <summary>The Top 10 styling scripts used on service pages.</summary>
    /// <param name="name">Script name.</param>
    /// <returns>The script.</returns>
    [HttpGet("theme/{name}.js")]
    [AllowAnonymous]
    public ActionResult GetThemeScript([FromRoute] string name)
    {
        if (name is not ("top10" or "header" or "expand" or "expandlite"))
        {
            return NotFound();
        }

        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"Jellyfin.Plugin.JellyStream.Web.theme.{name}.js");
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-cache";
        return File(stream, "application/javascript; charset=utf-8");
    }

    /// <summary>Settings the client needs, and the enabled services.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Client settings.</returns>
    [HttpGet("Config")]
    public async Task<ActionResult<ClientConfig>> GetClientConfig(CancellationToken ct)
    {
        var config = Config;
        var logos = await ProviderLogosAsync(ct).ConfigureAwait(false);
        var services = new List<ClientService>();
        foreach (var s in config.Services.Where(s => s.Enabled && s.ProviderIds.Length > 0))
        {
            var entries = _store.All.Where(e => AvailabilityStore.IsOn(e, s, config)).ToList();
            var movies = entries.Count(e => e.Type == "movie");
            var shows = entries.Count - movies;
            if (config.HideEmptyServices && entries.Count == 0)
            {
                continue;
            }

            services.Add(new ClientService(
                KeyOf(s),
                s.Name,
                !string.IsNullOrWhiteSpace(s.LogoUrl) ? s.LogoUrl : s.ProviderIds.Select(id => logos.GetValueOrDefault(id)).FirstOrDefault(l => l is not null),
                s.Accent,
                movies,
                shows,
                _intros.VersionOf(KeyOf(s)),
                _intros.VersionOf(KeyOf(s), "mobile")));
        }

        return new ClientConfig(
            services,
            config.ShowHomeRow,
            config.HomeRowTitle,
            config.HomeRowPosition,
            config.VisualMode,
            config.TopCount,
            config.ShowMissing && SeerrClient.IsConfigured,
            config.AllowRequests && SeerrClient.IsConfigured,
            config.ConfirmRequests,
            config.GenreRows,
            config.ShowContinueWatching,
            config.ShowRecentlyAdded,
            config.ShowPopularMissing && config.ShowMissing && SeerrClient.IsConfigured,
            config.Diagnostics);
    }

    /// <summary>The most popular titles on a service, marked with what you have.</summary>
    /// <param name="key">Service key.</param>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Up to the configured Top count.</returns>
    [HttpGet("Services/{key}/Top")]
    public async Task<ActionResult<List<TitleCard>>> GetTop([FromRoute, Required] string key, [FromQuery] string type = "movie", CancellationToken ct = default)
    {
        var service = FindService(key);
        if (service is null)
        {
            return NotFound();
        }

        var config = Config;
        type = NormalizeType(type);
        var count = Math.Clamp(config.TopCount, 1, 20);
        var cards = new List<TitleCard>();
        if (config.TopSource is "day" or "week" && SeerrClient.IsConfigured)
        {
            var trending = _trending.GetOnService(type, config.TopSource, service);
            if (trending is not null)
            {
                cards = ToCards(trending, type);
            }
        }

        // fill up (or fall back while the trending list builds) with what's popular on the service
        if (cards.Count < count)
        {
            var seen = cards.Select(c => c.TmdbId).ToHashSet();
            var popular = await PopularCardsAsync(service, type, 1, ct).ConfigureAwait(false);
            cards.AddRange(popular.Where(c => seen.Add(c.TmdbId)));
        }

        if (!config.ShowMissing)
        {
            cards = cards.Where(c => c.ItemId is not null).ToList();
        }

        return cards.Take(count).ToList();
    }

    /// <summary>The headline title (backdrop) for each service's home screen tile.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Service key to backdrop/title.</returns>
    [HttpGet("Services/Featured")]
    public async Task<ActionResult<Dictionary<string, FeaturedTitle>>> GetFeatured(CancellationToken ct)
    {
        var config = Config;
        var result = new Dictionary<string, FeaturedTitle>(StringComparer.OrdinalIgnoreCase);
        if (!SeerrClient.IsConfigured)
        {
            return result;
        }

        foreach (var s in config.Services.Where(s => s.Enabled && s.ProviderIds.Length > 0))
        {
            SeerrTitle? pick = null;
            if (config.TopSource is "day" or "week")
            {
                pick = (_trending.GetOnService("movie", config.TopSource, s) ?? [])
                    .Concat(_trending.GetOnService("tv", config.TopSource, s) ?? [])
                    .FirstOrDefault(t => !string.IsNullOrEmpty(t.BackdropPath));
            }

            if (pick is null)
            {
                try
                {
                    var popular = await _seerr.DiscoverPopularAsync("tv", s.ProviderIds, 1, ct).ConfigureAwait(false);
                    pick = popular.FirstOrDefault(t => !string.IsNullOrEmpty(t.BackdropPath));
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
                {
                    // no backdrop for this one
                }
            }

            if (pick is not null)
            {
                result[KeyOf(s)] = new FeaturedTitle(pick.DisplayName, Image(pick.BackdropPath, "w780")!);
            }
        }

        return result;
    }

    /// <summary>Popular titles on a service that aren't in the library.</summary>
    /// <param name="key">Service key.</param>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="limit">Maximum results.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Titles you don't have.</returns>
    [HttpGet("Services/{key}/Missing")]
    public async Task<ActionResult<List<TitleCard>>> GetMissing([FromRoute, Required] string key, [FromQuery] string type = "movie", [FromQuery] int limit = 20, CancellationToken ct = default)
    {
        var service = FindService(key);
        if (service is null)
        {
            return NotFound();
        }

        if (!Config.ShowMissing)
        {
            return new List<TitleCard>();
        }

        type = NormalizeType(type);
        var count = Math.Clamp(Config.TopCount, 1, 20);
        var cards = await PopularCardsAsync(service, type, 3, ct).ConfigureAwait(false);

        // leave out what the Top row already shows
        var inTop = Config.TopSource is "day" or "week"
            ? (_trending.GetOnService(type, Config.TopSource, service) ?? []).Take(count).Select(t => t.Id).ToHashSet()
            : cards.Take(count).Select(c => c.TmdbId).ToHashSet();
        return cards
            .Where(c => c.ItemId is null && !inTop.Contains(c.TmdbId))
            .Take(Math.Clamp(limit, 1, 60))
            .ToList();
    }

    /// <summary>Everything in the library that is on a service (that the user can see).</summary>
    /// <param name="key">Service key.</param>
    /// <param name="type">"movie", "tv" or "all".</param>
    /// <returns>Library titles, newest first.</returns>
    [HttpGet("Services/{key}/Library")]
    public ActionResult<List<LibraryCard>> GetLibrary([FromRoute, Required] string key, [FromQuery] string type = "all")
    {
        var service = FindService(key);
        if (service is null)
        {
            return NotFound();
        }

        var user = CurrentUser();
        if (user is null)
        {
            return Unauthorized();
        }

        var config = Config;
        var ids = _store.All
            .Where(e => (type == "all" || e.Type == NormalizeType(type)) && AvailabilityStore.IsOn(e, service, config))
            .Select(e => e.ItemId)
            .ToArray();
        if (ids.Length == 0)
        {
            return new List<LibraryCard>();
        }

        var items = _libraryManager.GetItemList(new InternalItemsQuery(user)
        {
            ItemIds = ids,
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
            OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)]
        });

        // the user query already applies their library access and parental limits
        return items
            .Select(i => new LibraryCard(
                i.Id,
                i.Name,
                i.ProductionYear,
                i is MediaBrowser.Controller.Entities.TV.Series ? "tv" : "movie",
                i.Genres ?? [],
                i.CommunityRating,
                i.DateCreated,
                ImageTag(i, ImageType.Primary),
                ImageTag(i, ImageType.Backdrop),
                ImageTag(i, ImageType.Logo),
                ImageTag(i, ImageType.Thumb)))
            .ToList();
    }

    /// <summary>Writes a client-side problem to the server log.</summary>
    /// <param name="log">The message.</param>
    /// <returns>No content.</returns>
    [HttpPost("Client/Log")]
    public ActionResult ClientLogMessage([FromBody] ClientLog log)
    {
        var message = log?.Message ?? string.Empty;
        _logger.LogWarning("JellyStream web client: {Message}", message.Length > 60000 ? message[..60000] : message);
        return NoContent();
    }

    // a stable value that changes when the image does, so image URLs can be cached by the browser
    private static string? ImageTag(BaseItem item, ImageType type)
    {
        var info = item.GetImageInfo(type, 0);
        return info is null ? null : info.DateModified.Ticks.ToString("x", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Details for a title you don't have, shaped like a Jellyfin item for the expand panel.</summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="tmdbId">TMDB id.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Item-like details.</returns>
    [HttpGet("Details")]
    public async Task<ActionResult<MissingDetails>> GetDetails([FromQuery, Required] string type, [FromQuery, Required] int tmdbId, CancellationToken ct)
    {
        if (!SeerrClient.IsConfigured)
        {
            return NotFound();
        }

        type = NormalizeType(type);
        try
        {
            var t = await _seerr.GetDetailsCachedAsync(type, tmdbId, ct).ConfigureAwait(false);
            if (t is null)
            {
                return NotFound();
            }

            var series = type == "tv";
            return new MissingDetails(
                t.DisplayName,
                series ? "Series" : "Movie",
                t.Overview,
                t.Year,
                t.Genres?.Select(g => g.Name ?? string.Empty).Where(g => g.Length > 0).ToArray() ?? [],
                t.VoteAverage is > 0 ? Math.Round(t.VoteAverage.Value, 1) : null,
                !series && t.Runtime is > 0 ? TimeSpan.FromMinutes(t.Runtime.Value).Ticks : null,
                series ? t.NumberOfSeasons : null,
                series ? (t.Status is "Returning Series" or "In Production" ? "Continuing" : "Ended") : null,
                series ? t.LastAirDate : null,
                Image(t.BackdropPath, "w1280"),
                Image(t.PosterPath, "w342"),
                StatusOf(t.MediaInfo?.Status ?? 0));
        }
        catch (HttpRequestException ex)
        {
            _logger.LogDebug(ex, "JellyStream: details lookup failed");
            return StatusCode(StatusCodes.Status502BadGateway);
        }
    }

    /// <summary>Requests a title through Seerr with its default settings.</summary>
    /// <param name="body">What to request.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The outcome.</returns>
    [HttpPost("Request")]
    public async Task<ActionResult<RequestResult>> PostRequest([FromBody, Required] RequestBody body, CancellationToken ct)
    {
        if (!Config.AllowRequests || !SeerrClient.IsConfigured)
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        var userId = CurrentUserId();
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        try
        {
            var result = await _seerr.RequestAsync(NormalizeType(body.Type), body.TmdbId, userId, ct).ConfigureAwait(false);
            return result;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "JellyStream: request failed");
            return new RequestResult(false, "error", "Couldn't reach Seerr");
        }
    }

    // ------------------------------------------------------------------ admin

    /// <summary>Connection and sync status for the settings page.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Status.</returns>
    [HttpGet("Admin/Status")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public async Task<ActionResult<AdminStatus>> GetStatus(CancellationToken ct)
    {
        string? version = null;
        string? error = null;
        if (SeerrClient.IsConfigured)
        {
            try
            {
                version = await _seerr.TestAsync(ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or UriFormatException)
            {
                error = ex.Message;
            }
        }
        else
        {
            error = "Not set up";
        }

        var config = Config;
        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in config.Services)
        {
            counts.TryAdd(KeyOf(s), _store.All.Count(e => AvailabilityStore.IsOn(e, s, config)));
        }

        var task = _taskManager.ScheduledTasks.FirstOrDefault(t => t.ScheduledTask is SyncAvailabilityTask);
        var running = task?.State == TaskState.Running;
        return new AdminStatus(
            version is not null,
            version,
            error,
            _store.All.Count,
            _store.LastSyncUtc,
            counts,
            WebInjector.Mode,
            running,
            running ? task!.CurrentProgress : null);
    }

    /// <summary>Looks for Seerr on the usual addresses.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The first address that answers, or null.</returns>
    [HttpGet("Admin/FindSeerr")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public async Task<ActionResult<string?>> FindSeerr(CancellationToken ct)
    {
        var url = await SeerrClient.FindAsync(ct).ConfigureAwait(false);
        return url is null ? NoContent() : Ok(url);
    }

    /// <summary>All streaming providers in the region, for picking services.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Providers.</returns>
    [HttpGet("Admin/Providers")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public async Task<ActionResult<List<ProviderInfo>>> GetProviders(CancellationToken ct)
    {
        try
        {
            var list = await _seerr.GetProvidersAsync(ct).ConfigureAwait(false);
            return list.Select(p => new ProviderInfo(p.Id, p.Name ?? string.Empty, Image(p.LogoPath, "w92"), p.DisplayPriority)).ToList();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or UriFormatException)
        {
            return StatusCode(StatusCodes.Status502BadGateway, ex.Message);
        }
    }

    /// <summary>Starts a sync now.</summary>
    /// <param name="full">Re-check every title, not just stale ones.</param>
    /// <returns>No content.</returns>
    [HttpPost("Admin/Sync")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public ActionResult StartSync([FromQuery] bool full = false)
    {
        if (full)
        {
            foreach (var e in _store.All)
            {
                e.CheckedUtc = DateTime.MinValue;
            }
        }

        _seerr.ClearCache();
        _taskManager.QueueScheduledTask<SyncAvailabilityTask>();
        return NoContent();
    }

    // ------------------------------------------------------------------ helpers

    private async Task<List<TitleCard>> PopularCardsAsync(ServiceEntry service, string type, int pages, CancellationToken ct)
    {
        if (!SeerrClient.IsConfigured)
        {
            return [];
        }

        List<SeerrTitle> titles;
        try
        {
            titles = await _seerr.DiscoverPopularAsync(type, service.ProviderIds, pages, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            _logger.LogDebug(ex, "JellyStream: discover failed");
            return [];
        }

        return ToCards(titles, type);
    }

    private List<TitleCard> ToCards(List<SeerrTitle> titles, string type)
    {
        var user = CurrentUser();
        var index = _store.TmdbIndex();
        var cards = new List<TitleCard>();
        var seenTitles = new HashSet<int>();
        var seenItems = new HashSet<Guid>();
        foreach (var t in titles)
        {
            // TMDB's paged lists can repeat a title when the ranking shifts between pages
            if (!seenTitles.Add(t.Id))
            {
                continue;
            }

            Guid? itemId = null;
            if (index.TryGetValue((type, t.Id), out var found))
            {
                itemId = found;
            }
            else if (Guid.TryParse(t.MediaInfo?.JellyfinMediaId, out var seerrId) && _libraryManager.GetItemById(seerrId) is not null)
            {
                itemId = seerrId;
            }

            if (itemId is not null && user is not null)
            {
                var item = _libraryManager.GetItemById(itemId.Value);
                if (item is null || !item.IsVisibleStandalone(user))
                {
                    itemId = null;
                }
            }

            // two titles linked to the same library item (a remake matched to the original, say):
            // only the first keeps the link, the other shows as its own title
            if (itemId is not null && !seenItems.Add(itemId.Value))
            {
                itemId = null;
            }

            // nothing to show for a title with no poster that isn't in the library
            if (itemId is null && string.IsNullOrEmpty(t.PosterPath))
            {
                continue;
            }

            var status = itemId is not null ? "available" : StatusOf(t.MediaInfo?.Status ?? 0);
            if (status == "available" && itemId is null)
            {
                // Seerr thinks it's here but this user can't see it (or it isn't synced yet)
                status = "missing";
            }

            var owned = itemId is null ? null : _libraryManager.GetItemById(itemId.Value);
            cards.Add(new TitleCard(
                t.Id, type, t.DisplayName, t.Year, Image(t.PosterPath, "w342"), Image(t.BackdropPath, "w780"), status, itemId,
                owned is null ? null : ImageTag(owned, ImageType.Primary),
                owned is null ? null : ImageTag(owned, ImageType.Backdrop),
                owned is null ? null : ImageTag(owned, ImageType.Logo),
                owned is null ? null : ImageTag(owned, ImageType.Thumb)));
        }

        return cards;
    }

    private async Task<Dictionary<int, string?>> ProviderLogosAsync(CancellationToken ct)
    {
        if (!SeerrClient.IsConfigured)
        {
            return [];
        }

        try
        {
            var list = await _seerr.GetProvidersAsync(ct).ConfigureAwait(false);
            return list.ToDictionary(p => p.Id, p => Image(p.LogoPath, "w300"));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or UriFormatException)
        {
            return [];
        }
    }

    private static string StatusOf(int seerrStatus) => seerrStatus switch
    {
        5 => "available",
        4 => "partial",
        2 or 3 => "requested",
        _ => "missing"
    };

    private static string? Image(string? path, string size) =>
        string.IsNullOrEmpty(path) ? null : TmdbImages + size + path;

    private static string NormalizeType(string? type) =>
        string.Equals(type, "tv", StringComparison.OrdinalIgnoreCase)
        || string.Equals(type, "series", StringComparison.OrdinalIgnoreCase)
        || string.Equals(type, "show", StringComparison.OrdinalIgnoreCase)
            ? "tv"
            : "movie";

    private static string KeyOf(ServiceEntry s) =>
        !string.IsNullOrWhiteSpace(s.Key) ? s.Key : "p" + string.Join('-', s.ProviderIds);

    private static ServiceEntry? FindService(string key) =>
        Config.Services.FirstOrDefault(s => s.Enabled && string.Equals(KeyOf(s), key, StringComparison.OrdinalIgnoreCase));

    private Guid CurrentUserId()
    {
        var value = User.FindFirst("Jellyfin-UserId")?.Value;
        return Guid.TryParse(value, out var id) ? id : Guid.Empty;
    }

    private User? CurrentUser()
    {
        var id = CurrentUserId();
        return id == Guid.Empty ? null : _userManager.GetUserById(id);
    }
}
