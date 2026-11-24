using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyStream.Configuration;
using Jellyfin.Plugin.JellyStream.Seerr;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyStream.Catalog;

/// <summary>
/// Netflix's own weekly Top 10 for a country, from the data files Netflix publishes for its Top 10
/// site. Each title is matched to TMDB through Seerr and kept only when TMDB agrees it streams on
/// Netflix in that country, so a wrong match never shows. Weekly only: Netflix publishes nothing daily.
/// </summary>
public class NetflixTop10
{
    // Netflix has moved the files before; try each place in turn
    private static readonly string[] Sources =
    [
        "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv",
        "https://top10.netflix.com/data/all-weeks-countries.tsv",
    ];

    private readonly IHttpClientFactory _http;
    private readonly SeerrClient _seerr;
    private readonly ILogger<NetflixTop10> _logger;
    private readonly ConcurrentDictionary<string, Week> _weeks = new();
    private readonly ConcurrentDictionary<string, Task> _building = new();
    private readonly ConcurrentDictionary<string, (DateTime At, string Error)> _failures = new();
    private readonly ConcurrentDictionary<string, Week> _lastGood = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="NetflixTop10"/> class.
    /// </summary>
    /// <param name="http">HTTP client factory.</param>
    /// <param name="seerr">Seerr client.</param>
    /// <param name="logger">Logger.</param>
    public NetflixTop10(IHttpClientFactory http, SeerrClient seerr, ILogger<NetflixTop10> logger)
    {
        _http = http;
        _seerr = seerr;
        _logger = logger;
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationSaved += (_, _) => _weeks.Clear();
        }
    }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    /// <summary>Checks whether a service is Netflix.</summary>
    /// <param name="service">The service.</param>
    /// <returns>True for Netflix.</returns>
    public static bool IsNetflix(ServiceEntry service) =>
        string.Equals(service.Key, "netflix", StringComparison.OrdinalIgnoreCase)
        || service.Name.Contains("netflix", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Gets Netflix's latest official Top 10 for the configured country, best first. Returns null
    /// while it loads, when it's turned off, or when Netflix's files can't be read (callers fall back).
    /// </summary>
    /// <param name="type">"movie" or "tv".</param>
    /// <param name="service">The Netflix service entry (its provider ids confirm each match).</param>
    /// <returns>Titles, or null.</returns>
    public List<SeerrTitle>? Get(string type, ServiceEntry service)
    {
        var config = Config;
        if (!config.OfficialNetflixTop10 || !SeerrClient.IsConfigured)
        {
            return null;
        }

        var key = config.Region.ToUpperInvariant();
        _weeks.TryGetValue(key, out var week);
        var age = week is null ? TimeSpan.MaxValue : DateTime.UtcNow - week.Built;

        // Netflix posts the new week on Tuesdays; look again every 6 hours (an hour after a failure)
        if (week is null || age > (week.Failed ? TimeSpan.FromHours(1) : TimeSpan.FromHours(6)))
        {
            Start(key, service);
        }

        if (week is null || week.Failed)
        {
            return null;
        }

        // a list more than three weeks old means Netflix stopped publishing for this country
        if (DateTime.UtcNow - week.Ending > TimeSpan.FromDays(21))
        {
            return null;
        }

        var list = type == "tv" ? week.Tv : week.Movies;
        return list.Count > 0 ? list : null;
    }

    /// <summary>The last successful load for the configured country, and the last error since then.</summary>
    /// <returns>The status.</returns>
    public (DateTime? Updated, DateTime? WeekEnding, int Movies, int Tv, bool Loading, DateTime? FailedAt, string? Error) Status()
    {
        var key = Config.Region.ToUpperInvariant();
        _lastGood.TryGetValue(key, out var good);
        _failures.TryGetValue(key, out var fail);
        return (good?.Built, good?.Ending, good?.Movies.Count ?? 0, good?.Tv.Count ?? 0, _building.ContainsKey(key), fail.Error is null ? null : fail.At, fail.Error);
    }

    /// <summary>Loads the list in the background (at startup).</summary>
    /// <param name="service">The Netflix service entry.</param>
    public void Warm(ServiceEntry service)
    {
        if (Config.OfficialNetflixTop10 && SeerrClient.IsConfigured)
        {
            Start(Config.Region.ToUpperInvariant(), service);
        }
    }

    private void Start(string country, ServiceEntry service)
    {
        _building.GetOrAdd(country, k => Task.Run(async () =>
        {
            try
            {
                _weeks[country] = await BuildAsync(country, service).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "JellyStream: could not load Netflix's official Top 10 for {Country}; using trending instead", country);
                _failures[country] = (DateTime.UtcNow, ex.Message);
                _weeks[country] = Week.Failure();
            }
            finally
            {
                _building.TryRemove(country, out _);
            }
        }));
    }

    private async Task<Week> BuildAsync(string country, ServiceEntry service)
    {
        var rows = await ReadCountryAsync(country).ConfigureAwait(false);
        if (rows.Count == 0)
        {
            _logger.LogInformation("JellyStream: Netflix publishes no Top 10 for {Country}; using trending instead", country);
            _failures[country] = (DateTime.UtcNow, $"Netflix's Top 10 files have no list for {country}.");
            return Week.Failure();
        }

        var latest = rows.Max(r => r.Week);
        var thisWeek = rows.Where(r => r.Week == latest).ToList();
        var movies = await MatchAsync(thisWeek.Where(r => !r.IsTv), "movie", service).ConfigureAwait(false);
        var tv = await MatchAsync(thisWeek.Where(r => r.IsTv), "tv", service).ConfigureAwait(false);
        _logger.LogInformation(
            "JellyStream: Netflix Top 10 for {Country}, week ending {Week:yyyy-MM-dd}: {Movies} films and {Tv} shows matched",
            country,
            latest,
            movies.Count,
            tv.Count);
        _failures.TryRemove(country, out _);
        _lastGood[country] = new Week(DateTime.UtcNow, latest, movies, tv, false);
        return _lastGood[country];
    }

    // Columns (by name, so a reordered file still reads): country_iso2, week, category ("Films"/"TV"),
    // weekly_rank, show_title, season_title.
    private async Task<List<Row>> ReadCountryAsync(string country)
    {
        Exception? last = null;
        foreach (var url in Sources)
        {
            try
            {
                using var client = _http.CreateClient("JellyStream");
                client.Timeout = TimeSpan.FromSeconds(90);
                client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (JellyStream Jellyfin plugin)");
                using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
                using var reader = new StreamReader(stream, Encoding.UTF8);

                var header = (await reader.ReadLineAsync().ConfigureAwait(false))?.Split('\t');
                if (header is null)
                {
                    continue;
                }

                int Col(string name) => Array.FindIndex(header, h => string.Equals(h.Trim(), name, StringComparison.OrdinalIgnoreCase));
                int cIso = Col("country_iso2"), cWeek = Col("week"), cCat = Col("category"), cRank = Col("weekly_rank"), cShow = Col("show_title");
                if (cIso < 0 || cWeek < 0 || cCat < 0 || cRank < 0 || cShow < 0)
                {
                    throw new InvalidDataException("Netflix's Top 10 file has unexpected columns: " + string.Join(", ", header));
                }

                var need = new[] { cIso, cWeek, cCat, cRank, cShow }.Max();
                var rows = new List<Row>();
                string? line;
                while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) is not null)
                {
                    var f = line.Split('\t');
                    if (f.Length <= need || !string.Equals(f[cIso].Trim(), country, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    if (DateTime.TryParse(f[cWeek].Trim(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var week)
                        && int.TryParse(f[cRank].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var rank)
                        && !string.IsNullOrWhiteSpace(f[cShow]))
                    {
                        rows.Add(new Row(week, f[cCat].Trim().StartsWith("TV", StringComparison.OrdinalIgnoreCase), rank, f[cShow].Trim()));
                    }
                }

                return rows;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidDataException or IOException)
            {
                last = ex;
            }
        }

        throw last ?? new InvalidDataException("No Netflix Top 10 source answered.");
    }

    private async Task<List<SeerrTitle>> MatchAsync(IEnumerable<Row> rows, string type, ServiceEntry service)
    {
        var region = Config.Region;
        var result = new List<SeerrTitle>();
        var seen = new HashSet<int>();

        // several seasons of one show can chart at once: keep the show once, at its best rank
        foreach (var row in rows.OrderBy(r => r.Rank).DistinctBy(r => Normalize(r.Title)))
        {
            try
            {
                var match = await FindAsync(row.Title, type, service, region).ConfigureAwait(false);
                if (match is not null && seen.Add(match.Id))
                {
                    result.Add(match);
                }
                else if (match is null)
                {
                    _logger.LogDebug("JellyStream: no Netflix match on TMDB for \"{Title}\" ({Type})", row.Title, type);
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException or System.Text.Json.JsonException)
            {
                // leave this title out
            }
        }

        return result;
    }

    // The TMDB entry for a Netflix title: among the search results of the right type, the first that
    // TMDB lists on Netflix in this country, preferring exact name matches.
    private async Task<SeerrTitle?> FindAsync(string title, string type, ServiceEntry service, string region)
    {
        var found = await _seerr.SearchAsync(title, CancellationToken.None).ConfigureAwait(false);
        var want = Normalize(title);
        var candidates = found
            .Where(t => t.MediaType == type)
            .Take(8)
            .OrderBy(t => Normalize(t.DisplayName) == want ? 0 : 1)
            .ToList();

        foreach (var t in candidates)
        {
            var details = await _seerr.GetDetailsCachedAsync(type, t.Id, CancellationToken.None).ConfigureAwait(false);
            var providers = details?.WatchProviders?.FirstOrDefault(w => string.Equals(w.Region, region, StringComparison.OrdinalIgnoreCase));
            if (providers?.Flatrate?.Any(p => service.ProviderIds.Contains(p.Id)) == true)
            {
                // keep the search result's fields (poster etc.), which the cards already use
                t.MediaType = type;
                return t;
            }
        }

        return null;
    }

    private static string Normalize(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s.Normalize(NormalizationForm.FormD))
        {
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(char.ToLowerInvariant(ch));
            }
        }

        return sb.ToString();
    }

    private sealed record Row(DateTime Week, bool IsTv, int Rank, string Title);

    private sealed record Week(DateTime Built, DateTime Ending, List<SeerrTitle> Movies, List<SeerrTitle> Tv, bool Failed)
    {
        public static Week Failure() => new(DateTime.UtcNow, DateTime.MinValue, [], [], true);
    }
}
