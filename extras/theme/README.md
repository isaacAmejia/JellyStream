# Theme scripts (optional)

Glass Top 10 styling for Jellyfin, loaded through JavaScript Injector in this order:

1. `top10.js`: glass rank numbers on Top 10 rows
2. `top10-header.js`: the "Trending today / Top 10 Movies" header and glass panel
3. **one** of:
   - `top10-expand.js`: desktop; hover (or select with a remote) to expand a poster with details
   - `top10-expand-pi.js`: the same, tuned for Raspberry Pi / JellyNav

They style the "Most Popular Movies/Shows Today" rows and any row marked with `data-mp-top10`, which includes JellyStream's Top 10 rows. On JellyStream pages, titles you don't have get their details from JellyStream.
