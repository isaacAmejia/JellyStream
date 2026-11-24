using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.JellyStream.Catalog;

/// <summary>
/// The intro videos people upload for their services, kept next to the plugin's settings
/// (plugins/configurations/JellyStream/intros) so they survive plugin updates.
/// </summary>
public partial class IntroStore
{
    /// <summary>The largest intro accepted, in bytes.</summary>
    public const long MaxBytes = 200L * 1024 * 1024;

    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".mp4"] = "video/mp4",
        [".m4v"] = "video/mp4",
        [".webm"] = "video/webm",
        [".mov"] = "video/quicktime",
    };

    private readonly string _dir;

    /// <summary>
    /// Initializes a new instance of the <see cref="IntroStore"/> class.
    /// </summary>
    /// <param name="paths">Application paths.</param>
    public IntroStore(IApplicationPaths paths)
    {
        _dir = Path.Combine(paths.PluginConfigurationsPath, "JellyStream", "intros");
    }

    /// <summary>Gets the file extensions that can be uploaded.</summary>
    public static IEnumerable<string> Extensions => Types.Keys;

    /// <summary>Whether a service key is safe to use as a file name.</summary>
    /// <param name="key">Service key.</param>
    /// <returns>True when it is.</returns>
    public static bool IsValidKey(string? key) => key is not null && KeyPattern().IsMatch(key);

    /// <summary>The content type for an extension, or null when it isn't a supported video.</summary>
    /// <param name="extension">Extension including the dot.</param>
    /// <returns>Content type.</returns>
    public static string? TypeFor(string extension) => Types.GetValueOrDefault(extension);

    /// <summary>Whether a variant name is known: "" (TV / desktop) or "mobile" (phones).</summary>
    /// <param name="variant">Variant.</param>
    /// <returns>True when it is.</returns>
    public static bool IsValidVariant(string? variant) => string.IsNullOrEmpty(variant) || variant == "mobile";

    private static string Stem(string key, string? variant) =>
        key.ToLowerInvariant() + (string.IsNullOrEmpty(variant) ? string.Empty : "." + variant);

    /// <summary>Finds a service's intro.</summary>
    /// <param name="key">Service key.</param>
    /// <param name="variant">"" for TV / desktop, "mobile" for phones.</param>
    /// <returns>The file, or null.</returns>
    public FileInfo? Find(string key, string? variant = null)
    {
        if (!IsValidKey(key) || !IsValidVariant(variant) || !Directory.Exists(_dir))
        {
            return null;
        }

        return Types.Keys
            .Select(ext => new FileInfo(Path.Combine(_dir, Stem(key, variant) + ext)))
            .Where(f => f.Exists)
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .FirstOrDefault();
    }

    /// <summary>A value that changes whenever the intro does (for cache-busting addresses).</summary>
    /// <param name="key">Service key.</param>
    /// <param name="variant">"" for TV / desktop, "mobile" for phones.</param>
    /// <returns>The version, or null when there's no intro.</returns>
    public string? VersionOf(string key, string? variant = null)
    {
        var file = Find(key, variant);
        return file is null ? null : file.LastWriteTimeUtc.Ticks.ToString("x", CultureInfo.InvariantCulture);
    }

    /// <summary>Opens a new intro file for writing, replacing any intro the service had.</summary>
    /// <param name="key">Service key.</param>
    /// <param name="variant">"" for TV / desktop, "mobile" for phones.</param>
    /// <param name="extension">Extension including the dot.</param>
    /// <returns>The stream to write to.</returns>
    public FileStream Create(string key, string? variant, string extension)
    {
        Directory.CreateDirectory(_dir);
        Delete(key, variant);
        return new FileStream(Path.Combine(_dir, Stem(key, variant) + extension.ToLowerInvariant()), FileMode.Create, FileAccess.Write, FileShare.None);
    }

    /// <summary>Removes a service's intro.</summary>
    /// <param name="key">Service key.</param>
    /// <param name="variant">"" for TV / desktop, "mobile" for phones.</param>
    /// <returns>True if there was one.</returns>
    public bool Delete(string key, string? variant = null)
    {
        if (!IsValidKey(key) || !IsValidVariant(variant) || !Directory.Exists(_dir))
        {
            return false;
        }

        var removed = false;
        foreach (var ext in Types.Keys)
        {
            var path = Path.Combine(_dir, Stem(key, variant) + ext);
            if (File.Exists(path))
            {
                File.Delete(path);
                removed = true;
            }
        }

        return removed;
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")]
    private static partial Regex KeyPattern();
}
