# JellyStream

Browse your Jellyfin library by streaming service.

JellyStream adds a **Streaming services** row to the home screen. Opening a service (Netflix, Disney+, HBO Max…) gives you a home screen with only what's on that service right now:

- **Top 10 Movies** and **Top 10 Shows** on that service. Titles you don't have show a missing badge, and selecting one requests it in Seerr with your default settings.
- **Continue Watching** and **Recently Added**, limited to that service.
- **Your library by genre**, plus everything A–Z.
- **Popular to request**: popular titles on the service that you don't have yet.

Back returns to your normal home screen.

It's built with Jellyfin's own card markup, so themes, the top 10 / expand scripts in [`extras/theme`](extras/theme) and JellyNav (remote navigation) work on these pages too.

## Requirements

- Jellyfin **12.4** or newer
- [Seerr](https://github.com/seerr-team/seerr) (Jellyseerr / Overseerr) that your Jellyfin server can reach
- The **JavaScript Injector** plugin, to load the home screen part

## Install

1. Download `jellystream_x.x.x.x.zip` from the latest release (or the build artifact) and unzip it.
2. Put `Jellyfin.Plugin.JellyStream.dll` in a new folder `plugins/JellyStream` inside your Jellyfin config folder.
3. Restart Jellyfin.
4. Open **Dashboard → Plugins → JellyStream**:
   - enter your Seerr address and API key, then select **Save & test**
   - select **Sync now**
5. Copy the snippet at the bottom of the settings page into **JavaScript Injector** and save.
6. Reload Jellyfin. The services row appears on the home screen.

## Settings

| Section | What you can change |
| --- | --- |
| Connect to Seerr | Address, API key, region. Shows connection status and sync results. |
| Services | Turn services on or off, reorder them, rename them, add any provider Seerr knows, set a custom logo or accent color. Each service can include several plans (e.g. Netflix + Netflix with ads) and its own rent/buy stores. |
| Rent / buy | Whether rent/buy titles count, and when. The default counts them only when no subscription service includes the title. |
| Home screen | Show or hide the row, its title and position, hide empty services, and the look (automatic, full glass, or lite for low-power devices). |
| Service pages | Top list length, genre rows, Continue Watching, Recently Added, titles you don't have, requests (with optional press-again-to-confirm), and requesting as the matching Seerr user. |

## How it works

- A scheduled task (**Dashboard → Scheduled Tasks → JellyStream → Sync streaming services**) asks Seerr which services each movie and show in your library is on. It runs daily and at startup, and only re-checks titles older than a few days.
- The Top 10 is TMDB's popularity ranking filtered to the service, through Seerr.
- Requests go through the plugin, so your Seerr API key never reaches the browser.

Streaming data comes from TMDB (powered by JustWatch) through Seerr.

## Build

```
dotnet build Jellyfin.Plugin.JellyStream/Jellyfin.Plugin.JellyStream.csproj -c Release
```

GitHub Actions builds every push and attaches the zip to releases for `v*` tags.
