using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.JellyStream.Seerr;

/// <summary>A streaming provider as Seerr reports it.</summary>
public class SeerrProvider
{
    /// <summary>Gets or sets the TMDB provider id.</summary>
    [JsonPropertyName("id")]
    public int Id { get; set; }

    /// <summary>Gets or sets the name.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>Gets or sets the TMDB logo path.</summary>
    [JsonPropertyName("logoPath")]
    public string? LogoPath { get; set; }

    /// <summary>Gets or sets the display priority (lower is more popular).</summary>
    [JsonPropertyName("displayPriority")]
    public int DisplayPriority { get; set; }
}

/// <summary>Where a title can be watched in one region.</summary>
public class SeerrWatchProviders
{
    /// <summary>Gets or sets the region code.</summary>
    [JsonPropertyName("iso_3166_1")]
    public string? Region { get; set; }

    /// <summary>Gets or sets the subscription providers.</summary>
    [JsonPropertyName("flatrate")]
    public List<SeerrProvider>? Flatrate { get; set; }

    /// <summary>Gets or sets the purchase providers.</summary>
    [JsonPropertyName("buy")]
    public List<SeerrProvider>? Buy { get; set; }
}

/// <summary>A genre.</summary>
public class SeerrGenre
{
    /// <summary>Gets or sets the name.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

/// <summary>Seerr's request/availability info for a title.</summary>
public class SeerrMediaInfo
{
    /// <summary>Gets or sets the status (1 unknown, 2 pending, 3 processing, 4 partial, 5 available).</summary>
    [JsonPropertyName("status")]
    public int Status { get; set; }

    /// <summary>Gets or sets the Jellyfin item id, when Seerr knows it.</summary>
    [JsonPropertyName("jellyfinMediaId")]
    public string? JellyfinMediaId { get; set; }

    /// <summary>Gets or sets the requests.</summary>
    [JsonPropertyName("requests")]
    public List<object>? Requests { get; set; }
}

/// <summary>A movie or show from Seerr (search/discover result or details).</summary>
public class SeerrTitle
{
    /// <summary>Gets or sets the TMDB id.</summary>
    [JsonPropertyName("id")]
    public int Id { get; set; }

    /// <summary>Gets or sets the media type ("movie" or "tv").</summary>
    [JsonPropertyName("mediaType")]
    public string? MediaType { get; set; }

    /// <summary>Gets or sets the movie title.</summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>Gets or sets the show name.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary>Gets or sets the overview.</summary>
    [JsonPropertyName("overview")]
    public string? Overview { get; set; }

    /// <summary>Gets or sets the poster path.</summary>
    [JsonPropertyName("posterPath")]
    public string? PosterPath { get; set; }

    /// <summary>Gets or sets the backdrop path.</summary>
    [JsonPropertyName("backdropPath")]
    public string? BackdropPath { get; set; }

    /// <summary>Gets or sets the movie release date.</summary>
    [JsonPropertyName("releaseDate")]
    public string? ReleaseDate { get; set; }

    /// <summary>Gets or sets the show first air date.</summary>
    [JsonPropertyName("firstAirDate")]
    public string? FirstAirDate { get; set; }

    /// <summary>Gets or sets the show last air date.</summary>
    [JsonPropertyName("lastAirDate")]
    public string? LastAirDate { get; set; }

    /// <summary>Gets or sets the show status (e.g. "Returning Series").</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>Gets or sets the vote average.</summary>
    [JsonPropertyName("voteAverage")]
    public double? VoteAverage { get; set; }

    /// <summary>Gets or sets the runtime in minutes (movies).</summary>
    [JsonPropertyName("runtime")]
    public int? Runtime { get; set; }

    /// <summary>Gets or sets the number of seasons (shows).</summary>
    [JsonPropertyName("numberOfSeasons")]
    public int? NumberOfSeasons { get; set; }

    /// <summary>Gets or sets the genres (details only).</summary>
    [JsonPropertyName("genres")]
    public List<SeerrGenre>? Genres { get; set; }

    /// <summary>Gets or sets the watch providers per region (details only).</summary>
    [JsonPropertyName("watchProviders")]
    public List<SeerrWatchProviders>? WatchProviders { get; set; }

    /// <summary>Gets or sets Seerr's availability info.</summary>
    [JsonPropertyName("mediaInfo")]
    public SeerrMediaInfo? MediaInfo { get; set; }

    /// <summary>Gets the display name for movies or shows.</summary>
    [JsonIgnore]
    public string DisplayName => Title ?? Name ?? string.Empty;

    /// <summary>Gets the release or first air year.</summary>
    [JsonIgnore]
    public int? Year
    {
        get
        {
            var d = ReleaseDate ?? FirstAirDate;
            return d is { Length: >= 4 } && int.TryParse(d.AsSpan(0, 4), out var y) ? y : null;
        }
    }
}

/// <summary>A page of discover results.</summary>
public class SeerrPage
{
    /// <summary>Gets or sets the results.</summary>
    [JsonPropertyName("results")]
    public List<SeerrTitle>? Results { get; set; }

    /// <summary>Gets or sets the total pages.</summary>
    [JsonPropertyName("totalPages")]
    public int TotalPages { get; set; }
}

/// <summary>A Seerr user.</summary>
public class SeerrUser
{
    /// <summary>Gets or sets the Seerr user id.</summary>
    [JsonPropertyName("id")]
    public int Id { get; set; }

    /// <summary>Gets or sets the linked Jellyfin user id.</summary>
    [JsonPropertyName("jellyfinUserId")]
    public string? JellyfinUserId { get; set; }
}

/// <summary>A page of Seerr users.</summary>
public class SeerrUserPage
{
    /// <summary>Gets or sets the users.</summary>
    [JsonPropertyName("results")]
    public List<SeerrUser>? Results { get; set; }
}

/// <summary>Seerr's public status.</summary>
public class SeerrStatus
{
    /// <summary>Gets or sets the version.</summary>
    [JsonPropertyName("version")]
    public string? Version { get; set; }
}
