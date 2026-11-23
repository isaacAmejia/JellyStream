using System;
using System.Collections.Generic;
using Jellyfin.Plugin.JellyStream.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.JellyStream;

/// <summary>
/// JellyStream: browse the library by streaming service.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// The plugin id.
    /// </summary>
    public static readonly Guid PluginId = Guid.Parse("5c4e9982-450c-443e-a4a4-297d618258e5");

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Application paths.</param>
    /// <param name="xmlSerializer">XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>
    /// Gets the running plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "JellyStream";

    /// <inheritdoc />
    public override Guid Id => PluginId;

    /// <inheritdoc />
    public override string Description => "Browse your library by streaming service, with a Top 10 for each.";

    /// <summary>
    /// Raised after the configuration is saved.
    /// </summary>
    public event EventHandler? ConfigurationSaved;

    /// <inheritdoc />
    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        base.UpdateConfiguration(configuration);
        ConfigurationSaved?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return
        [
            new PluginPageInfo
            {
                Name = "JellyStream",
                DisplayName = "JellyStream",
                EmbeddedResourcePath = GetType().Namespace + ".Configuration.configPage.html",
                EnableInMainMenu = true,
                MenuIcon = "live_tv"
            }
        ];
    }
}
