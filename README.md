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

## Install

1. In Jellyfin go to **Dashboard → Plugins → Repositories**, add:

   ```
   https://github.com/isaacAmejia/JellyStream/releases/latest/download/manifest.json
   ```

2. Install **JellyStream** from the catalog and restart Jellyfin.
3. Open **Dashboard → Plugins → JellyStream**. It looks for Seerr on its own; paste your Seerr API key and select **Save & connect**.

That's it. The first library check starts automatically, the setup checklist shows its progress, and the services row appears on the home screen after a reload. Updates arrive through the catalog like any other plugin.

<details>
<summary>Manual install / if the row doesn't appear</summary>

- Download `jellystream_x.x.x.x.zip` from the latest release and put `Jellyfin.Plugin.JellyStream.dll` in `plugins/JellyStream` in your Jellyfin config folder, then restart.
- JellyStream adds itself to the web client through the **File Transformation** plugin when it's installed, or by editing Jellyfin's `index.html`. If neither is possible (read-only web folder), the settings page shows a one-line snippet to paste into **JavaScript Injector**.

</details>

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
