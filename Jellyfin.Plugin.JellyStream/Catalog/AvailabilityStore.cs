using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyStream.Configuration;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyStream.Catalog;

/// <summary>
/// Where one library title streams.
/// </summary>
public class AvailabilityEntry
{
    /// <summary>Gets or sets the Jellyfin item id.</summary>
    public Guid ItemId { get; set; }

    /// <summary>Gets or sets the TMDB id.</summary>
    public int TmdbId { get; set; }

    /// <summary>Gets or sets "movie" or "tv".</summary>
    public string Type { get; set; } = "movie";

    /// <summary>Gets or sets the subscription provider ids.</summary>
    public int[] Flatrate { get; set; } = [];

    /// <summary>Gets or sets the purchase provider ids.</summary>
    public int[] Buy { get; set; } = [];

    /// <summary>Gets or sets when this was last checked (UTC).</summary>
    public DateTime CheckedUtc { get; set; }
}

/// <summary>
/// Remembers which service each library title is on, saved between restarts.
/// </summary>
public class AvailabilityStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    private readonly string _path;
    private readonly ILogger<AvailabilityStore> _logger;
    private readonly SemaphoreSlim _saveLock = new(1, 1);
    private readonly ConcurrentDictionary<Guid, AvailabilityEntry> _entries = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="AvailabilityStore"/> class.
    /// </summary>
    /// <param name="paths">Application paths.</param>
    /// <param name="logger">Logger.</param>
    public AvailabilityStore(IApplicationPaths paths, ILogger<AvailabilityStore> logger)
    {
        _logger = logger;
        var dir = Path.Combine(paths.PluginConfigurationsPath, "JellyStream");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "availability.json");
        Load();
    }

    /// <summary>Gets or sets when the last full sync finished (UTC).</summary>
    public DateTime? LastSyncUtc { get; set; }

    /// <summary>Gets all entries.</summary>
    public ICollection<AvailabilityEntry> All => _entries.Values;

    /// <summary>Gets the entry for an item.</summary>
    /// <param name="itemId">Item id.</param>
    /// <returns>The entry, or null.</returns>
    public AvailabilityEntry? Get(Guid itemId) => _entries.TryGetValue(itemId, out var e) ? e : null;

    /// <summary>Adds or replaces an entry.</summary>
    /// <param name="entry">The entry.</param>
    public void Set(AvailabilityEntry entry) => _entries[entry.ItemId] = entry;

    /// <summary>Removes entries for items no longer in the library.</summary>
    /// <param name="keep">Item ids still present.</param>
    public void RemoveMissing(ISet<Guid> keep)
    {
        foreach (var id in _entries.Keys.Where(id => !keep.Contains(id)).ToList())
        {
            _entries.TryRemove(id, out _);
        }
    }

    /// <summary>
    /// Builds a lookup from (type, TMDB id) to library item.
    /// </summary>
    /// <returns>The lookup.</returns>
    public Dictionary<(string Type, int TmdbId), Guid> TmdbIndex()
    {
        var map = new Dictionary<(string, int), Guid>();
        foreach (var e in _entries.Values)
        {
            map.TryAdd((e.Type, e.TmdbId), e.ItemId);
        }

        return map;
    }

    /// <summary>
    /// Checks whether a title counts toward a service under the current rules.
    /// </summary>
    /// <param name="e">The title.</param>
    /// <param name="service">The service.</param>
    /// <param name="config">Settings.</param>
    /// <returns>True if it counts.</returns>
    public static bool IsOn(AvailabilityEntry e, ServiceEntry service, PluginConfiguration config)
    {
        if (e.Flatrate.Any(id => service.ProviderIds.Contains(id)))
        {
            return true;
        }

        if (config.RentBuy == RentBuyRule.Off || service.RentBuyProviderIds.Length == 0)
        {
            return false;
        }

        if (!e.Buy.Any(id => service.RentBuyProviderIds.Contains(id)))
        {
            return false;
        }

        if (config.RentBuy == RentBuyRule.NotOnAnySubscription)
        {
            return e.Flatrate.Length == 0;
        }

        // NotOnMyServices: only when none of the enabled services include it
        return !config.Services
            .Where(s => s.Enabled)
            .Any(s => e.Flatrate.Any(id => s.ProviderIds.Contains(id)));
    }

    /// <summary>Saves to disk.</summary>
    /// <returns>A task.</returns>
    public async Task SaveAsync()
    {
        await _saveLock.WaitAsync().ConfigureAwait(false);
        try
        {
            var data = new StoreFile { LastSyncUtc = LastSyncUtc, Entries = _entries.Values.ToList() };
            var tmp = _path + ".tmp";
            await using (var fs = File.Create(tmp))
            {
                await JsonSerializer.SerializeAsync(fs, data, JsonOptions).ConfigureAwait(false);
            }

            File.Move(tmp, _path, true);
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Could not save JellyStream availability data");
        }
        finally
        {
            _saveLock.Release();
        }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_path))
            {
                return;
            }

            var data = JsonSerializer.Deserialize<StoreFile>(File.ReadAllText(_path), JsonOptions);
            if (data?.Entries is null)
            {
                return;
            }

            LastSyncUtc = data.LastSyncUtc;
            foreach (var e in data.Entries)
            {
                _entries[e.ItemId] = e;
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogWarning(ex, "Could not read JellyStream availability data; it will be rebuilt on the next sync");
        }
    }

    internal sealed class StoreFile
    {
        public DateTime? LastSyncUtc { get; set; }

        public List<AvailabilityEntry> Entries { get; set; } = [];
    }
}
