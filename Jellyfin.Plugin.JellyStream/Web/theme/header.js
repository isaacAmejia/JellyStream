/* JellyStream: glass Top 10 header and panel for JellyStream's Top 10 rows (based on the header theme script). */
(() => {
  if (window.__jstHeader) return;
  window.__jstHeader = true;
  const SECTIONS = {};
  const SIZE = 30;          // desktop title size in px
  const PANEL_X = 14;       // desktop: px between the screen edge and the panel's sides
  const FADE = 56;          // desktop: px over which posters fade at the panel edges

  const M_SIZE = 22;        // phone title size in px
  const M_FADE = 24;        // phone: px over which posters fade at the screen edges
  const M_BREAKPOINT = 640; // screens this wide or narrower get the phone layout

  const fadeMask = (x, f) => `linear-gradient(90deg,
    transparent 0, transparent ${x}px,
    #000 ${x + f}px, #000 calc(100% - ${x + f}px),
    transparent calc(100% - ${x}px), transparent 100%)`;

  // phone overrides, written once and applied by screen width or Jellyfin's mobile layout
  const mobile = (p) => `
    ${p}.jst-feature { margin-top: 1em !important; margin-bottom: 1em !important; }
    ${p}.jst-feature::before {
      top: -0.5em; bottom: -0.3em; left: 0; right: 0;
      border-radius: 0;
      border-left: none; border-right: none;
      border-color: rgba(255,255,255,.06);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
    }
    ${p}.jst-fade {
      -webkit-mask-image: ${fadeMask(0, M_FADE)};
      mask-image: ${fadeMask(0, M_FADE)};
    }
    ${p}.jst-hdr-new { gap: ${M_SIZE * 0.32}px; padding: ${M_SIZE * 0.2}px 0 ${M_SIZE * 0.15}px; }
    ${p}.jst-eyebrow { font-size: 10px; letter-spacing: 0.2em; gap: 8px; }
    ${p}.jst-eyebrow::before { width: 5px; height: 5px; }
    ${p}.jst-eyebrow::after { display: none; }
    ${p}.jst-title { font-size: ${M_SIZE}px; gap: ${M_SIZE * 0.24}px; }
  `;

  document.getElementById('jst-hdr-css')?.remove();
  const css = document.createElement('style');
  css.id = 'jst-hdr-css';
  css.textContent = `
    @keyframes jst-pulse {
      0%, 100% { opacity: 1;  box-shadow: 0 0 0 3px rgba(255,255,255,.12), 0 0 8px rgba(255,255,255,.5); }
      50%      { opacity: .5; box-shadow: 0 0 0 5px rgba(255,255,255,.03), 0 0 3px rgba(255,255,255,.15); }
    }

    /* frosted panel behind the whole row */
    .jst-feature { position: relative; isolation: isolate; margin-top: 1.4em !important; margin-bottom: 1.4em !important; }
    .jst-feature::before {
      content: "";
      position: absolute;
      top: -0.8em;
      bottom: -0.4em;
      left: ${PANEL_X}px;
      right: ${PANEL_X}px;
      border-radius: 26px;
      background: linear-gradient(180deg, rgba(255,255,255,.05) 0%, rgba(255,255,255,.012) 100%);
      border: 1px solid rgba(255,255,255,.07);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 20px 50px rgba(0,0,0,.22);
      pointer-events: none;
      z-index: -1;
    }

    /* posters fade out at the panel edges instead of sliding past them */
    .jst-fade {
      -webkit-mask-image: ${fadeMask(PANEL_X, FADE)};
      mask-image: ${fadeMask(PANEL_X, FADE)};
    }

    /* hide the original title text, keep it on the page for scripts and screen readers */
    .jst-hdr {
      font-size: 0 !important;
      color: transparent !important;
      text-shadow: none !important;
      display: flex !important;
      align-items: flex-end;
      flex: 1 1 auto;
      min-width: 0;
    }
    .jst-hdr > :not(.jst-hdr-new) { display: none !important; }

    .jst-hdr-new {
      display: flex;
      flex-direction: column;
      gap: ${SIZE * 0.3}px;
      flex: 1 1 auto;
      min-width: 0;
      padding: ${SIZE * 0.25}px 0 ${SIZE * 0.2}px;
      font-family: "Manrope", "SF Pro Display", "Inter", system-ui, sans-serif;
      line-height: 1;
    }

    /* top line: dot + label + fading rule */
    .jst-eyebrow {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: ${Math.round(SIZE * 0.37)}px;
      font-weight: 700;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: rgba(255,255,255,.55);
    }
    .jst-eyebrow::before {
      content: "";
      flex: none;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #fff;
      animation: jst-pulse 2.6s ease-in-out infinite;
    }
    .jst-eyebrow::after {
      content: "";
      flex: 1 1 auto;
      max-width: 320px;
      height: 1px;
      margin-left: 6px;
      background: linear-gradient(90deg, rgba(255,255,255,.28), rgba(255,255,255,0));
    }

    /* main title: Top (light) 10 (glass) Label (bold) */
    .jst-title {
      display: flex;
      align-items: baseline;
      gap: ${SIZE * 0.26}px;
      font-size: ${SIZE}px;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }
    .jst-t1 {
      font-weight: 300;
      color: rgba(255,255,255,.62);
    }
    .jst-t10 {
      font-weight: 800;
      font-size: 1.12em;
      letter-spacing: -0.05em;
      background: linear-gradient(180deg, #ffffff 0%, #e8edf3 50%, #aeb8c6 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 14px rgba(255,255,255,.14)) drop-shadow(0 2px 6px rgba(0,0,0,.35));
    }
    .jst-t2 {
      font-weight: 800;
      color: #f5f7fa;
      text-shadow: 0 2px 10px rgba(0,0,0,.3);
    }

    /* phone layout */
    @media (max-width: ${M_BREAKPOINT}px) { ${mobile('')} }
    ${mobile('.layout-mobile ')}
  `;
  document.head.appendChild(css);

  const tag = () => {
    document.querySelectorAll('.sectionTitle, h2').forEach(t => {
      if (t.classList.contains('jst-hdr')) return;
      const text = t.textContent.trim();
      const sec = t.closest('.verticalSection');
      const custom = sec?.dataset.jstTop10
        ? { label: sec.dataset.jstLabel || 'Titles', eyebrow: sec.dataset.jstEyebrow || 'Trending today' }
        : null;
      const key = custom ? text : Object.keys(SECTIONS).find(k => text.startsWith(k));
      if (!key) return;
      if (t.querySelector('.sectionTitle, h2')) return; // innermost title element only

      // wrap the original text so it can be hidden but stays first for the top 10 script
      [...t.childNodes].forEach(n => {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const s = document.createElement('span');
          s.className = 'jst-hdr-orig';
          n.replaceWith(s);
          s.appendChild(n);
        }
      });

      const { label, eyebrow } = custom || SECTIONS[key];
      const el = document.createElement('span');
      el.className = 'jst-hdr-new';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `
        <span class="jst-eyebrow">${eyebrow}</span>
        <span class="jst-title">
          <span class="jst-t1">Top</span><span class="jst-t10">10</span><span class="jst-t2">${label}</span>
        </span>`;
      t.appendChild(el);
      t.setAttribute('aria-label', key);
      t.classList.add('jst-hdr');

      t.closest('.verticalSection')?.classList.add('jst-feature');
    });

    // apply the edge fade to each feature row's scrolling strip (it can render after the title)
    document.querySelectorAll('.jst-feature').forEach(sec => {
      const strip = sec.querySelector('.emby-scroller') || sec.querySelector('.itemsContainer')?.parentElement;
      if (strip && !strip.classList.contains('jst-fade')) strip.classList.add('jst-fade');
    });
  };

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; tag(); });
  }).observe(document.body, { childList: true, subtree: true });
  tag();
})();