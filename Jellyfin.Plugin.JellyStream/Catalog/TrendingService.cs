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
    private readonly ILogger<TrendingService> _logger;
    private readonly ConcurrentDictionary<string, TrendingList> _lists = new();
    private readonly ConcurrentDictionary<string, Task> _building = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="TrendingService"/> class.
    /// </summary>
    /// <param name="seerr">Seerr client.</param>
    /// <param name="logger">Logger.</param>
    public TrendingService(SeerrClient seerr, ILogger<TrendingService> logger)
    {
        _seerr = seerr;
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

    /// <summary>Builds the lists in the background (at startup).</summary>
    public void Warm()
    {
        if (!SeerrClient.IsConfigured || Config.TopSource == "popular")
        {
            return;
        }

        StartBuild("movie", Config.TopSource);
        StartBuild("tv", Config.TopSource);
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
        for (var page = 1; page <= pages; page++)
        {
            var result = await _seerr.TrendingPageAsync(type, window, page, CancellationToken.None).ConfigureAwait(false);
            if (result?.Results is null || result.Results.Count == 0)
            {
                break;
            }

            titles.AddRange(result.Results.Where(t => t.MediaType is null || t.MediaType == type));
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
