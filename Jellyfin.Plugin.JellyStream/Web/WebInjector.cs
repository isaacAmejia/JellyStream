using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyStream.Catalog;
using Jellyfin.Plugin.JellyStream.Seerr;
using Jellyfin.Plugin.JellyStream.Tasks;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyStream.Web;

/// <summary>
/// What the File Transformation plugin passes to <see cref="WebInjector.TransformIndex"/>.
/// </summary>
public class TransformPayload
{
    /// <summary>Gets or sets the file contents.</summary>
    public string? Contents { get; set; }
}

/// <summary>
/// Loads the JellyStream script into Jellyfin's web client automatically, and starts the
/// first sync as soon as Seerr is set up.
/// </summary>
public partial class WebInjector : IHostedService
{
    // the version in the address makes browsers fetch the new script after every update
    private static readonly string Tag = $"<script plugin=\"JellyStream\" defer src=\"../JellyStream/client.js?v={typeof(WebInjector).Assembly.GetName().Version}\"></script>";
    private static readonly Guid TransformId = Guid.Parse("8f1d4a52-6b6c-4bb4-9a3e-2f5c0e7d9a11");

    private readonly IApplicationPaths _paths;
    private readonly ITaskManager _taskManager;
    private readonly AvailabilityStore _store;
    private readonly TrendingService _trending;
    private readonly ILogger<WebInjector> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="WebInjector"/> class.
    /// </summary>
    /// <param name="paths">Application paths.</param>
    /// <param name="taskManager">Task manager.</param>
    /// <param name="store">Availability store.</param>
    /// <param name="trending">Trending lists.</param>
    /// <param name="logger">Logger.</param>
    public WebInjector(IApplicationPaths paths, ITaskManager taskManager, AvailabilityStore store, TrendingService trending, ILogger<WebInjector> logger)
    {
        _paths = paths;
        _taskManager = taskManager;
        _store = store;
        _trending = trending;
        _logger = logger;
    }

    /// <summary>Gets how the script is being loaded: "file-transformation", "index.html" or "manual".</summary>
    public static string Mode { get; private set; } = "manual";

    /// <summary>
    /// Adds the script tag to index.html (called by the File Transformation plugin).
    /// </summary>
    /// <param name="payload">The page.</param>
    /// <returns>The changed page.</returns>
    public static string TransformIndex(TransformPayload payload)
    {
        var html = payload.Contents ?? string.Empty;
        return Insert(html);
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationSaved += OnConfigurationSaved;
        }

        CleanUpOldFolders();

        if (Plugin.Instance?.Configuration.AutoInject != false)
        {
            Inject();
        }

        _trending.Warm();

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken)
    {
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationSaved -= OnConfigurationSaved;
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Jellyfin sometimes can't fully delete an old version's folder after an update and leaves it
    /// behind empty. On the next start it treats that leftover as a plugin of its own and removes the
    /// real install, so clear out any JellyStream_* folder that no longer has a DLL in it.
    /// </summary>
    private void CleanUpOldFolders()
    {
        try
        {
            var current = Path.GetDirectoryName(typeof(WebInjector).Assembly.Location);
            if (string.IsNullOrEmpty(current))
            {
                return;
            }

            var pluginsDir = Path.GetDirectoryName(current);
            if (string.IsNullOrEmpty(pluginsDir) || !Directory.Exists(pluginsDir))
            {
                return;
            }

            foreach (var dir in Directory.EnumerateDirectories(pluginsDir))
            {
                var name = Path.GetFileName(dir);
                var ours = string.Equals(name, "JellyStream", StringComparison.OrdinalIgnoreCase)
                    || name.StartsWith("JellyStream_", StringComparison.OrdinalIgnoreCase);
                if (!ours || string.Equals(Path.GetFullPath(dir), Path.GetFullPath(current), StringComparison.Ordinal))
                {
                    continue;
                }

                if (Directory.EnumerateFiles(dir, "*.dll", SearchOption.AllDirectories).Any())
                {
                    continue; // an older full install; Jellyfin removes those itself
                }

                try
                {
                    Directory.Delete(dir, true);
                    _logger.LogInformation("JellyStream: removed leftover folder {Dir}", dir);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    _logger.LogWarning("JellyStream: couldn't remove leftover folder {Dir}: {Message}. Delete it by hand, or the next update may not load.", dir, ex.Message);
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogDebug(ex, "JellyStream: leftover folder check failed");
        }
    }

    private static string Insert(string html)
    {
        // only ever touch a real HTML page (Jellyfin's chunk files are JavaScript and come back untouched)
        var start = html.TrimStart().TrimStart('\uFEFF').TrimStart();
        var isPage = start.StartsWith("<!doctype", StringComparison.OrdinalIgnoreCase)
            || start.StartsWith("<html", StringComparison.OrdinalIgnoreCase);
        var at = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (!isPage)
        {
            return html;
        }

        if (at < 0)
        {
            return OurTag().Replace(html, string.Empty) + Tag;
        }

        html = OurTag().Replace(html, string.Empty);
        at = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return html.Insert(at, Tag);
    }

    private void Inject()
    {
        if (TryFileTransformation())
        {
            Mode = "file-transformation";
            return;
        }

        if (TryPatchIndex())
        {
            Mode = "index.html";
            return;
        }

        Mode = "manual";
        _logger.LogInformation("JellyStream: couldn't add the script to the web client automatically; use the JavaScript Injector snippet from the settings page");
    }

    private bool TryFileTransformation()
    {
        try
        {
            var ftAssembly = AssemblyLoadContext.All
                .SelectMany(c => c.Assemblies)
                .FirstOrDefault(a => a.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) == true);
            var api = ftAssembly?.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
            var register = api?.GetMethod("RegisterTransformation");
            if (register is null)
            {
                return false;
            }

            // build the JObject with File Transformation's own copy of Newtonsoft
            var jobjectType = register.GetParameters()[0].ParameterType;
            var parse = jobjectType.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, [typeof(string)]);
            if (parse is null)
            {
                return false;
            }

            var json = "{"
                + $"\"id\":\"{TransformId}\","
                // Must be exactly "index.html": File Transformation runs only the group of registrations whose
                // pattern text matches the file exactly, and the other plugins on index.html use this text.
                // The pattern also matches chunk files like "itemDetails-index-html.<hash>.chunk.js";
                // Insert() leaves anything that isn't an HTML page untouched.
                + "\"fileNamePattern\":\"index.html\","
                + $"\"callbackAssembly\":\"{typeof(WebInjector).Assembly.FullName}\","
                + $"\"callbackClass\":\"{typeof(WebInjector).FullName}\","
                + $"\"callbackMethod\":\"{nameof(TransformIndex)}\""
                + "}";
            register.Invoke(null, [parse.Invoke(null, [json])]);
            _logger.LogInformation("JellyStream: loaded into the web client through File Transformation");
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "JellyStream: File Transformation registration failed");
            return false;
        }
    }

    private bool TryPatchIndex()
    {
        try
        {
            var index = Path.Combine(_paths.WebPath, "index.html");
            if (!File.Exists(index))
            {
                return false;
            }

            var html = File.ReadAllText(index);
            var patched = Insert(html);
            if (patched != html)
            {
                File.WriteAllText(index, patched);
            }

            _logger.LogInformation("JellyStream: loaded into the web client (index.html)");
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogDebug(ex, "JellyStream: index.html is read-only");
            return false;
        }
    }

    private void OnConfigurationSaved(object? sender, EventArgs e)
    {
        // first time Seerr works: build the catalog right away instead of waiting for the nightly run
        if (SeerrClient.IsConfigured && _store.LastSyncUtc is null && _store.All.Count == 0)
        {
            _taskManager.QueueScheduledTask<SyncAvailabilityTask>();
        }

        _trending.Warm();
    }

    [GeneratedRegex("<script plugin=\"JellyStream\"[^>]*></script>", RegexOptions.IgnoreCase)]
    private static partial Regex OurTag();
}
