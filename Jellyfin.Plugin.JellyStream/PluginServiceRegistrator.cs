using Jellyfin.Plugin.JellyStream.Catalog;
using Jellyfin.Plugin.JellyStream.Seerr;
using Jellyfin.Plugin.JellyStream.Web;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.JellyStream;

/// <summary>
/// Registers JellyStream's services.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddHttpClient("JellyStream");
        serviceCollection.AddSingleton<SeerrClient>();
        serviceCollection.AddSingleton<AvailabilityStore>();
        serviceCollection.AddHostedService<WebInjector>();
    }
}
