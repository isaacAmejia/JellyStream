using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.JellyStream.Catalog;
using Jellyfin.Plugin.JellyStream.Seerr;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyStream.Tasks;

/// <summary>
/// Checks which streaming services each movie and show in the library is on.
/// </summary>
public class SyncAvailabilityTask : IScheduledTask
{
    private readonly ILibraryManager _libraryManager;
    private readonly SeerrClient _seerr;
    private readonly AvailabilityStore _store;
    private readonly ILogger<SyncAvailabilityTask> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="SyncAvailabilityTask"/> class.
    /// </summary>
    /// <param name="libraryManager">Library manager.</param>
    /// <param name="seerr">Seerr client.</param>
    /// <param name="store">Availability store.</param>
    /// <param name="logger">Logger.</param>
    public SyncAvailabilityTask(ILibraryManager libraryManager, SeerrClient seerr, AvailabilityStore store, ILogger<SyncAvailabilityTask> logger)
    {
        _libraryManager = libraryManager;
        _seerr = seerr;
        _store = store;
        _logger = logger;
    }

    /// <inheritdoc />
    public string Name => "Sync streaming services";

    /// <inheritdoc />
    public string Key => "JellyStreamSync";

    /// <inheritdoc />
    public string Description => "Checks which streaming service each movie and show in your library is on (through Seerr).";

    /// <inheritdoc />
    public string Category => "JellyStream";

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        return
        [
            new TaskTriggerInfo { Type = TaskTriggerInfoType.DailyTrigger, TimeOfDayTicks = TimeSpan.FromHours(4).Ticks },
            new TaskTriggerInfo { Type = TaskTriggerInfoType.StartupTrigger }
        ];
    }

    /// <inheritdoc />
    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        if (!SeerrClient.IsConfigured)
        {
            _logger.LogInformation("JellyStream: Seerr is not set up yet, skipping sync");
            return;
        }

        var config = Plugin.Instance!.Configuration;
        var items = _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
            Recursive = true,
            IsVirtualItem = false,
        });

        var present = new HashSet<Guid>();
        var todo = new List<(BaseItem Item, int TmdbId, string Type)>();
        var staleBefore = DateTime.UtcNow.AddDays(-Math.Max(0, config.RefreshDays));
        foreach (var item in items)
        {
            if (!int.TryParse(item.GetProviderId(MetadataProvider.Tmdb), out var tmdbId) || tmdbId <= 0)
            {
                continue;
            }

            present.Add(item.Id);
            var type = item is MediaBrowser.Controller.Entities.TV.Series ? "tv" : "movie";
            var existing = _store.Get(item.Id);
            if (existing is not null && existing.TmdbId == tmdbId && existing.CheckedUtc > staleBefore)
            {
                continue;
            }

            todo.Add((item, tmdbId, type));
        }

        _store.RemoveMissing(present);
        _logger.LogInformation("JellyStream: checking {Count} of {Total} titles", todo.Count, present.Count);

        var done = 0;
        var failures = 0;
        var options = new ParallelOptions
        {
            MaxDegreeOfParallelism = Math.Clamp(config.SyncConcurrency, 1, 16),
            CancellationToken = cancellationToken
        };

        await Parallel.ForEachAsync(todo, options, async (job, ct) =>
        {
            try
            {
                var details = await _seerr.GetDetailsAsync(job.Type, job.TmdbId, ct).ConfigureAwait(false);
                var region = details?.WatchProviders?.FirstOrDefault(w =>
                    string.Equals(w.Region, config.Region, StringComparison.OrdinalIgnoreCase));
                _store.Set(new AvailabilityEntry
                {
                    ItemId = job.Item.Id,
                    TmdbId = job.TmdbId,
                    Type = job.Type,
                    Flatrate = region?.Flatrate?.Select(p => p.Id).Distinct().ToArray() ?? [],
                    Buy = region?.Buy?.Select(p => p.Id).Distinct().ToArray() ?? [],
                    CheckedUtc = DateTime.UtcNow
                });
            }
            catch (HttpRequestException ex)
            {
                if (Interlocked.Increment(ref failures) <= 5)
                {
                    _logger.LogWarning(ex, "JellyStream: could not check {Name}", job.Item.Name);
                }
            }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested)
            {
                // a single slow lookup timed out; it will be retried next sync
                Interlocked.Increment(ref failures);
            }

            var n = Interlocked.Increment(ref done);
            progress.Report(n * 100.0 / Math.Max(1, todo.Count));
            if (n % 200 == 0)
            {
                await _store.SaveAsync().ConfigureAwait(false);
            }
        }).ConfigureAwait(false);

        _store.LastSyncUtc = DateTime.UtcNow;
        await _store.SaveAsync().ConfigureAwait(false);
        _logger.LogInformation("JellyStream: sync finished ({Done} checked, {Failed} failed)", done, failures);
    }
}
