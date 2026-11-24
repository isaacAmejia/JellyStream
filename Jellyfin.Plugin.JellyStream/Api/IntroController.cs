using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.JellyStream.Catalog;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JellyStream.Api;

/// <summary>
/// Intro videos that play when a service opens: uploaded on the settings page, played by the web client.
/// </summary>
[ApiController]
[Route("JellyStream")]
public class IntroController : ControllerBase
{
    private readonly IntroStore _intros;
    private readonly ILogger<IntroController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="IntroController"/> class.
    /// </summary>
    /// <param name="intros">Intro store.</param>
    /// <param name="logger">Logger.</param>
    public IntroController(IntroStore intros, ILogger<IntroController> logger)
    {
        _intros = intros;
        _logger = logger;
    }

    /// <summary>
    /// A service's intro video. Public (a video element can't send Jellyfin's auth header); the address
    /// carries the file's version, so browsers may keep it for good.
    /// </summary>
    /// <param name="key">Service key.</param>
    /// <param name="variant">"" for TV / desktop, "mobile" for phones.</param>
    /// <returns>The video.</returns>
    [HttpGet("Intro/{key}")]
    [AllowAnonymous]
    public ActionResult GetIntro([FromRoute, Required] string key, [FromQuery] string? variant = null)
    {
        var file = _intros.Find(key, variant);
        var type = file is null ? null : IntroStore.TypeFor(file.Extension);
        if (file is null || type is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return PhysicalFile(file.FullName, type, enableRangeProcessing: true);
    }

    /// <summary>Which services have intros (TV / desktop under the key, phone under "key:mobile").</summary>
    /// <returns>Key to size and upload time.</returns>
    [HttpGet("Admin/Intros")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public ActionResult<Dictionary<string, IntroInfo>> ListIntros()
    {
        var config = Plugin.Instance!.Configuration;
        var result = new Dictionary<string, IntroInfo>(StringComparer.OrdinalIgnoreCase);
        // Jellyfin's own intro (switching back to Jellyfin) sits alongside the services'
        foreach (var key in config.Services.Select(s => s.Key).Prepend("jellyfin").Where(IntroStore.IsValidKey).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            foreach (var variant in new[] { string.Empty, "mobile" })
            {
                var file = _intros.Find(key, variant);
                if (file is not null)
                {
                    result[variant.Length == 0 ? key : key + ":" + variant] = new IntroInfo(file.Length, file.LastWriteTimeUtc, _intros.VersionOf(key, variant)!);
                }
            }
        }

        return result;
    }

    /// <summary>Uploads (or replaces) a service's intro video.</summary>
    /// <param name="key">Service key.</param>
    /// <param name="file">The video (mp4, m4v, webm or mov).</param>
    /// <param name="variant">"" for TV / desktop, "mobile" for phones.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The stored intro.</returns>
    [HttpPost("Admin/Intro/{key}")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [RequestSizeLimit(IntroStore.MaxBytes + (1024 * 1024))]
    [RequestFormLimits(MultipartBodyLengthLimit = IntroStore.MaxBytes + (1024 * 1024))]
    public async Task<ActionResult<IntroInfo>> UploadIntro([FromRoute, Required] string key, IFormFile? file, [FromQuery] string? variant, CancellationToken ct)
    {
        if (!IntroStore.IsValidKey(key) || !IntroStore.IsValidVariant(variant))
        {
            return BadRequest("That service key can't be used.");
        }

        if (file is null || file.Length == 0)
        {
            return BadRequest("No video was sent.");
        }

        if (file.Length > IntroStore.MaxBytes)
        {
            return BadRequest("That video is too large (200 MB at most).");
        }

        var ext = Path.GetExtension(file.FileName ?? string.Empty);
        if (IntroStore.TypeFor(ext) is null)
        {
            return BadRequest("Use an MP4, M4V, WebM or MOV video.");
        }

        var target = _intros.Create(key, variant, ext);
        await using (target.ConfigureAwait(false))
        {
            await file.CopyToAsync(target, ct).ConfigureAwait(false);
        }

        _logger.LogInformation("JellyStream: {Which} intro video saved for {Key} ({Bytes} bytes)", string.IsNullOrEmpty(variant) ? "TV / desktop" : "phone", key, file.Length);
        var stored = _intros.Find(key, variant)!;
        return new IntroInfo(stored.Length, stored.LastWriteTimeUtc, _intros.VersionOf(key, variant)!);
    }

    /// <summary>Removes a service's intro video.</summary>
    /// <param name="key">Service key.</param>
    /// <param name="variant">"" for TV / desktop, "mobile" for phones.</param>
    /// <returns>No content.</returns>
    [HttpDelete("Admin/Intro/{key}")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public ActionResult DeleteIntro([FromRoute, Required] string key, [FromQuery] string? variant = null)
    {
        if (!IntroStore.IsValidKey(key) || !IntroStore.IsValidVariant(variant))
        {
            return BadRequest();
        }

        _intros.Delete(key, variant);
        return NoContent();
    }
}

/// <summary>A stored intro video.</summary>
/// <param name="Size">Size in bytes.</param>
/// <param name="Updated">When it was uploaded.</param>
/// <param name="Version">Version used in its address.</param>
public record IntroInfo(long Size, DateTime Updated, string Version);
