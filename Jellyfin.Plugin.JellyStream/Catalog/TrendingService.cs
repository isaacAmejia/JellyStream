using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyStream.Configuration;
using Jellyfin.Plugin.JellyStream.Seerr;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyStream.Catalog;

/// <summary>
/// What's trending today / this week, with where each title streams, so each service can get
/// its own current Top 10 (TMDB's trending list isn't filterable by service).
/// </summary>
public class TrendingService
{
    private readonly SeerrClient _seerr;
    private readonly NetflixTop10 _netflix;
    private readonly ILogger<TrendingService> _logger;
    private readonly ConcurrentDictionary<string, TrendingList> _lists = new();
    private readonly ConcurrentDictionary<string, Task> _building = new();
    private readonly ConcurrentDictionary<string, (DateTime At, string Error)> _failures = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="TrendingService"/> class.
    /// </summary>
    /// <param name="seerr">Seerr client.</param>
    /// <param name="netflix">Netflix's official Top 10.</param>
    /// <param name="logger">Logger.</param>
    public TrendingService(SeerrClient seerr, NetflixTop10 netflix, ILogger<TrendingService> logger)
    {
        _seerr = seerr;
        _netflix = netflix;
        _logger = logger;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationSaved += (_, _) => _lists.Clear();
        }
    }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    /// <summary>
    /// Gets the trending titles on a service, in trending order. Returns null while the list is
    /// still being built (the first time after startup or a settings change).
    /// </summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="window">"day" or "week".</param>
    /// <param name="service">The service.</param>
    /// <returns>Titles, or null if not ready yet.</returns>
    public List<SeerrTitle>? GetOnService(string type, string window, ServiceEntry service)
    {
        var key = Key(type, window);
        var ttl = window == "day" ? TimeSpan.FromHours(3) : TimeSpan.FromHours(12);
        _lists.TryGetValue(key, out var list);
        if (list is null || DateTime.UtcNow - list.Built > ttl)
        {
            StartBuild(type, window);
        }

        // a slightly old list is still better than none while the new one builds
        return list?.Titles
            .Where(t => t.Flatrate.Any(id => service.ProviderIds.Contains(id)))
            .Select(t => t.Title)
            .ToList();
    }

    /// <summary>
    /// Gets a service's Top list: the service's own published ranking where there is one (Netflix),
    /// followed by what's trending on it; null when neither is ready.
    /// </summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="service">The service.</param>
    /// <returns>Titles, best first, or null.</returns>
    public List<SeerrTitle>? GetTop(string type, ServiceEntry service)
    {
        var official = NetflixTop10.IsNetflix(service) ? _netflix.Get(type, service) : null;
        var trending = Config.TopSource is "day" or "week" ? GetOnService(type, Config.TopSource, service) : null;
        if (official is null)
        {
            return trending;
        }

        var ids = official.Select(t => t.Id).ToHashSet();
        return official.Concat((trending ?? []).Where(t => !ids.Contains(t.Id))).ToList();
    }

    /// <summary>Builds the lists in the background (at startup).</summary>
    public void Warm()
    {
        var netflix = Config.Services.FirstOrDefault(s => s.Enabled && NetflixTop10.IsNetflix(s));
        if (netflix is not null)
        {
            _netflix.Warm(netflix);
        }

        if (!SeerrClient.IsConfigured || Config.TopSource == "popular")
        {
            return;
        }

        StartBuild("movie", Config.TopSource);
        StartBuild("tv", Config.TopSource);
    }

    /// <summary>Gets Netflix's official Top 10 loader (for its status).</summary>
    public NetflixTop10 Netflix => _netflix;

    /// <summary>When a trending list last built, how many streaming titles it has, and its last error.</summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="window">"day" or "week".</param>
    /// <returns>The status.</returns>
    public (DateTime? Built, int Titles, bool Building, DateTime? FailedAt, string? Error) Status(string type, string window)
    {
        var key = Key(type, window);
        _lists.TryGetValue(key, out var list);
        _failures.TryGetValue(key, out var fail);
        var failed = fail.Error is not null && (list is null || fail.At > list.Built);
        return (list?.Built, list?.Titles.Count ?? 0, _building.ContainsKey(key), failed ? fail.At : null, failed ? fail.Error : null);
    }

    private static string Key(string type, string window) => $"{type}:{window}:{Config.Region}";

    private void StartBuild(string type, string window)
    {
        var key = Key(type, window);
        _building.GetOrAdd(key, k => Task.Run(async () =>
        {
            try
            {
                await BuildAsync(type, window, key).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _failures[key] = (DateTime.UtcNow, ex.Message);
                _logger.LogWarning(ex, "JellyStream: could not build the trending {Type} list", type);
            }
            finally
            {
                _building.TryRemove(key, out _);
            }
        }));
    }

    private async Task BuildAsync(string type, string window, string key)
    {
        var config = Config;
        var pages = Math.Clamp(config.TrendingPages, 1, 25);
        var titles = new List<SeerrTitle>();
        var seen = new HashSet<int>();
        for (var page = 1; page <= pages; page++)
        {
            var result = await _seerr.TrendingPageAsync(type, window, page, CancellationToken.None).ConfigureAwait(false);
            if (result?.Results is null || result.Results.Count == 0)
            {
                break;
            }

            foreach (var t in result.Results)
            {
                // pages can overlap when the ranking moves while we page through it
                if ((t.MediaType is null || t.MediaType == type) && !string.IsNullOrEmpty(t.PosterPath) && seen.Add(t.Id))
                {
                    titles.Add(t);
                }
            }
            if (page >= result.TotalPages)
            {
                break;
            }
        }

        var entries = new TrendingEntry?[titles.Count];
        var options = new ParallelOptions { MaxDegreeOfParallelism = Math.Clamp(config.SyncConcurrency, 1, 16) };
        await Parallel.ForEachAsync(Enumerable.Range(0, titles.Count), options, async (i, ct) =>
        {
            try
            {
                var details = await _seerr.GetDetailsCachedAsync(type, titles[i].Id, ct).ConfigureAwait(false);
                var region = details?.WatchProviders?.FirstOrDefault(w =>
                    string.Equals(w.Region, config.Region, StringComparison.OrdinalIgnoreCase));
                var flat = region?.Flatrate?.Select(p => p.Id).ToArray() ?? [];
                if (flat.Length > 0)
                {
                    entries[i] = new TrendingEntry(titles[i], flat);
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                // skip this one
            }
        }).ConfigureAwait(false);

        _lists[key] = new TrendingList(DateTime.UtcNow, entries.Where(e => e is not null).Select(e => e!).ToList());
        _logger.LogInformation("JellyStream: trending {Type} ({Window}) list ready, {Count} streaming titles", type, window, _lists[key].Titles.Count);
    }

    private sealed record TrendingEntry(SeerrTitle Title, int[] Flatrate);

    private sealed record TrendingList(DateTime Built, List<TrendingEntry> Titles);
}
