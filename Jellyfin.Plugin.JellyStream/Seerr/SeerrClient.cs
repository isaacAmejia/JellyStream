using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyStream.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyStream.Seerr;

/// <summary>
/// The result of a request sent to Seerr.
/// </summary>
/// <param name="Ok">Whether the request was accepted.</param>
/// <param name="Status">The resulting status for the UI: "requested", "exists" or "error".</param>
/// <param name="Message">A short message for the user.</param>
public record RequestResult(bool Ok, string Status, string Message);

/// <summary>
/// Talks to Seerr (Jellyseerr / Overseerr).
/// </summary>
public class SeerrClient
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SeerrClient> _logger;
    private readonly ConcurrentDictionary<string, (DateTime Expires, object Value)> _cache = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="SeerrClient"/> class.
    /// </summary>
    /// <param name="httpClientFactory">HTTP client factory.</param>
    /// <param name="logger">Logger.</param>
    public SeerrClient(IHttpClientFactory httpClientFactory, ILogger<SeerrClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationSaved += (_, _) => ClearCache();
        }
    }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    /// <summary>Gets a value indicating whether Seerr is set up.</summary>
    public static bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Config.SeerrUrl) && !string.IsNullOrWhiteSpace(Config.SeerrApiKey);

    /// <summary>Clears cached responses (after settings change).</summary>
    public void ClearCache() => _cache.Clear();

    /// <summary>Gets Seerr's version, or throws if it can't be reached with the key.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The version string.</returns>
    public async Task<string> TestAsync(CancellationToken ct)
    {
        using var client = CreateClient();
        // /auth/me needs a valid key, so this checks both the address and the key
        using var me = await client.GetAsync("api/v1/auth/me", ct).ConfigureAwait(false);
        me.EnsureSuccessStatusCode();
        var status = await client.GetFromJsonAsync<SeerrStatus>("api/v1/status", JsonOptions, ct).ConfigureAwait(false);
        return status?.Version ?? "unknown";
    }

    /// <summary>Gets all streaming providers for movies and shows in the configured region.</summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Providers, most popular first.</returns>
    public Task<List<SeerrProvider>> GetProvidersAsync(CancellationToken ct) =>
        Cached("providers:" + Config.Region, TimeSpan.FromHours(12), async () =>
        {
            using var client = CreateClient();
            var region = Uri.EscapeDataString(Config.Region);
            var movies = await client.GetFromJsonAsync<List<SeerrProvider>>($"api/v1/watchproviders/movies?watchRegion={region}", JsonOptions, ct).ConfigureAwait(false) ?? [];
            var tv = await client.GetFromJsonAsync<List<SeerrProvider>>($"api/v1/watchproviders/tv?watchRegion={region}", JsonOptions, ct).ConfigureAwait(false) ?? [];
            return movies.Concat(tv)
                .GroupBy(p => p.Id)
                .Select(g => g.OrderBy(p => p.DisplayPriority).First())
                .OrderBy(p => p.DisplayPriority)
                .ToList();
        });

    /// <summary>Gets full details for a title, including where it streams.</summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="tmdbId">TMDB id.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The title, or null if Seerr doesn't know it.</returns>
    public async Task<SeerrTitle?> GetDetailsAsync(string type, int tmdbId, CancellationToken ct)
    {
        using var client = CreateClient();
        using var res = await client.GetAsync($"api/v1/{type}/{tmdbId.ToString(CultureInfo.InvariantCulture)}", ct).ConfigureAwait(false);
        if (res.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<SeerrTitle>(JsonOptions, ct).ConfigureAwait(false);
    }

    /// <summary>Gets cached details for the panel shown on titles you don't have.</summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="tmdbId">TMDB id.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The title.</returns>
    public Task<SeerrTitle?> GetDetailsCachedAsync(string type, int tmdbId, CancellationToken ct) =>
        Cached($"details:{type}:{tmdbId}", TimeSpan.FromHours(6), () => GetDetailsAsync(type, tmdbId, ct));

    /// <summary>Gets the most popular titles on the given providers.</summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="providerIds">TMDB provider ids (any of them).</param>
    /// <param name="pages">How many pages of 20 to read.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Titles, most popular first.</returns>
    public Task<List<SeerrTitle>> DiscoverPopularAsync(string type, IReadOnlyCollection<int> providerIds, int pages, CancellationToken ct)
    {
        var ids = string.Join('|', providerIds.Select(i => i.ToString(CultureInfo.InvariantCulture)));
        var key = $"discover:{type}:{ids}:{Config.Region}:{pages}";
        return Cached(key, TimeSpan.FromHours(3), async () =>
        {
            using var client = CreateClient();
            var list = new List<SeerrTitle>();
            var path = type == "tv" ? "tv" : "movies";
            for (var page = 1; page <= pages; page++)
            {
                var url = $"api/v1/discover/{path}?page={page}&sortBy=popularity.desc"
                    + $"&watchRegion={Uri.EscapeDataString(Config.Region)}&watchProviders={Uri.EscapeDataString(ids)}";
                var result = await client.GetFromJsonAsync<SeerrPage>(url, JsonOptions, ct).ConfigureAwait(false);
                if (result?.Results is null)
                {
                    break;
                }

                foreach (var t in result.Results)
                {
                    t.MediaType ??= type;
                }

                list.AddRange(result.Results);
                if (page >= result.TotalPages)
                {
                    break;
                }
            }

            return list;
        });
    }

    /// <summary>Gets one page of TMDB trending titles.</summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="window">"day" or "week".</param>
    /// <param name="page">Page number (1-based).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The page.</returns>
    public async Task<SeerrPage?> TrendingPageAsync(string type, string window, int page, CancellationToken ct)
    {
        using var client = CreateClient();
        var url = $"api/v1/discover/trending?mediaType={type}&timeWindow={window}&page={page.ToString(CultureInfo.InvariantCulture)}";
        var result = await client.GetFromJsonAsync<SeerrPage>(url, JsonOptions, ct).ConfigureAwait(false);
        foreach (var t in result?.Results ?? [])
        {
            t.MediaType ??= type;
        }

        return result;
    }

    /// <summary>Requests a title with Seerr's default settings.</summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="tmdbId">TMDB id.</param>
    /// <param name="jellyfinUserId">The Jellyfin user asking, to request as their Seerr user.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The outcome.</returns>
    public async Task<RequestResult> RequestAsync(string type, int tmdbId, Guid jellyfinUserId, CancellationToken ct)
    {
        using var client = CreateClient();
        if (Config.RequestAsUser)
        {
            var seerrUser = await FindSeerrUserAsync(jellyfinUserId, ct).ConfigureAwait(false);
            if (seerrUser is not null)
            {
                client.DefaultRequestHeaders.Add("X-API-User", seerrUser.Value.ToString(CultureInfo.InvariantCulture));
            }
        }

        object body = type == "tv"
            ? new { mediaType = "tv", mediaId = tmdbId, seasons = "all" }
            : new { mediaType = "movie", mediaId = tmdbId };

        using var res = await client.PostAsJsonAsync("api/v1/request", body, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

        // these titles changed state, so drop cached lists that show it
        foreach (var k in _cache.Keys.Where(k => k.StartsWith("discover:", StringComparison.Ordinal)))
        {
            _cache.TryRemove(k, out _);
        }

        if (res.IsSuccessStatusCode && res.StatusCode != HttpStatusCode.Accepted)
        {
            return new RequestResult(true, "requested", "Requested");
        }

        var message = ReadMessage(text);
        if (res.StatusCode == HttpStatusCode.Conflict)
        {
            return new RequestResult(true, "requested", "Already requested");
        }

        if (res.StatusCode == HttpStatusCode.Accepted)
        {
            return new RequestResult(true, "requested", message ?? "Nothing left to request");
        }

        _logger.LogWarning("Seerr request for {Type} {Id} failed: {Status} {Body}", type, tmdbId, (int)res.StatusCode, text);
        return new RequestResult(false, "error", message ?? "Request failed");
    }

    private async Task<int?> FindSeerrUserAsync(Guid jellyfinUserId, CancellationToken ct)
    {
        var users = await Cached("users", TimeSpan.FromMinutes(10), async () =>
        {
            using var client = CreateClient();
            var page = await client.GetFromJsonAsync<SeerrUserPage>("api/v1/user?take=1000", JsonOptions, ct).ConfigureAwait(false);
            return page?.Results ?? [];
        }).ConfigureAwait(false);

        var want = jellyfinUserId.ToString("N", CultureInfo.InvariantCulture);
        foreach (var u in users)
        {
            var id = u.JellyfinUserId?.Replace("-", string.Empty, StringComparison.Ordinal);
            if (string.Equals(id, want, StringComparison.OrdinalIgnoreCase))
            {
                return u.Id;
            }
        }

        return null;
    }

    /// <summary>
    /// Looks for Seerr on the usual addresses (this machine, Docker names and the local network)
    /// by asking each for its public status.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The first address that answers, or null.</returns>
    public static async Task<string?> FindAsync(CancellationToken ct)
    {
        var hosts = new List<string> { "localhost", "127.0.0.1", "host.docker.internal", "jellyseerr", "seerr", "overseerr", "172.17.0.1" };
        try
        {
            foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
            {
                foreach (var a in ni.GetIPProperties().UnicastAddresses)
                {
                    if (a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !IPAddress.IsLoopback(a.Address))
                    {
                        hosts.Add(a.Address.ToString());
                    }
                }

                foreach (var g in ni.GetIPProperties().GatewayAddresses)
                {
                    if (g.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        hosts.Add(g.Address.ToString());
                    }
                }
            }
        }
        catch (System.Net.NetworkInformation.NetworkInformationException)
        {
            // fall back to the fixed names
        }

        var candidates = hosts.Distinct().Select(h => $"http://{h}:5055").ToList();
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var probes = candidates.Select(async url =>
        {
            try
            {
                var status = await client.GetFromJsonAsync<SeerrStatus>(url + "/api/v1/status", JsonOptions, cts.Token).ConfigureAwait(false);
                return string.IsNullOrEmpty(status?.Version) ? null : url;
            }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or NotSupportedException or ObjectDisposedException)
            {
                return null;
            }
        }).ToList();

        while (probes.Count > 0)
        {
            var done = await Task.WhenAny(probes).ConfigureAwait(false);
            probes.Remove(done);
            var found = await done.ConfigureAwait(false);
            if (found is not null)
            {
                await cts.CancelAsync().ConfigureAwait(false);
                return found;
            }
        }

        return null;
    }

    private static string? ReadMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private HttpClient CreateClient()
    {
        var config = Config;
        if (string.IsNullOrWhiteSpace(config.SeerrUrl) || string.IsNullOrWhiteSpace(config.SeerrApiKey))
        {
            throw new InvalidOperationException("Seerr is not set up. Add its address and API key in the JellyStream settings.");
        }

        var client = _httpClientFactory.CreateClient("JellyStream");
        client.BaseAddress = new Uri(config.SeerrUrl.TrimEnd('/') + "/");
        client.Timeout = TimeSpan.FromSeconds(20);
        client.DefaultRequestHeaders.Add("X-API-Key", config.SeerrApiKey.Trim());
        client.DefaultRequestHeaders.Add("Accept", "application/json");
        return client;
    }

    private async Task<T> Cached<T>(string key, TimeSpan ttl, Func<Task<T>> load)
    {
        if (_cache.TryGetValue(key, out var hit) && hit.Expires > DateTime.UtcNow)
        {
            return (T)hit.Value;
        }

        var value = await load().ConfigureAwait(false);
        if (value is not null)
        {
            _cache[key] = (DateTime.UtcNow + ttl, value);
        }

        return value;
    }
}
