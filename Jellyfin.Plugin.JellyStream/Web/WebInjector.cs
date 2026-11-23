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
    private const string Tag = "<script plugin=\"JellyStream\" defer src=\"../JellyStream/client.js\"></script>";
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

    private static string Insert(string html)
    {
        html = OurTag().Replace(html, string.Empty);
        var at = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return at < 0 ? html + Tag : html.Insert(at, Tag);
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
