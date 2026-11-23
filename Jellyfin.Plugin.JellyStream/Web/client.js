/*
 * JellyStream web client
 * Adds a streaming services row to the home screen. Each service opens its own home screen
 * (Top 10s, recently added, your library by genre, titles to request), built from the same
 * markup Jellyfin uses so themes, the top 10 / expand scripts and JellyNav all work on it.
 */
(() => {
  if (window.__jellyStream) return;
  window.__jellyStream = true;

  const PARAM = 'jellystream';
  const FONT = '"Manrope", "SF Pro Display", "Inter", system-ui, sans-serif';

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (path) => window.ApiClient.getUrl('JellyStream/' + path);
  const getJSON = (path) => window.ApiClient.getJSON(api(path));
  const userId = () => window.ApiClient?.getCurrentUserId?.();
  const serverId = () => window.ApiClient?.serverId?.() || '';
  const visible = (el) => !!el && el.offsetParent !== null && !el.closest('.hide');
  const serviceKey = () => {
    const h = location.hash || '';
    if (!/^#!?\/home(\.html)?(?:[?/]|$)/i.test(h)) return null;
    const q = h.split('?')[1] || '';
    return new URLSearchParams(q).get(PARAM);
  };

  const lite = () => {
    const mode = state.cfg?.VisualMode || 'auto';
    if (mode === 'lite') return true;
    if (mode === 'full') return false;
    return /aarch64|armv7|armv8|arm64|raspbian|CrKey|SMART-TV|Tizen|webOS/i.test(navigator.userAgent)
      || !!document.getElementById('__jf_library_focus_ring__')
      || (navigator.hardwareConcurrency || 8) <= 4;
  };

  // Each service page borrows the look of that service's own app: the billboard at the top, card
  // shape and captions, buttons, type and focus style. Unknown services get a neutral look in their color.
  //   shape:   'landscape' | 'portrait' for library rows (Top 10 rows are always portrait)
  //   caption: 'overlay' (title on the image) | 'below' (left-aligned under it) | 'none' (art only)
  //   num:     Top 10 numbers: 'glass' | 'outline' | 'solid'
  const BRANDS = {
    netflix: {
      c1: '#e50914', c2: '#b20710', numA: '#141414', numB: '#595959', num: 'outline',
      base: '#141414', bg: '#141414', shape: 'landscape', caption: 'overlay',
      font: '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
      labels: { tagMovie: 'FILM', tagTv: 'SERIES', play: 'Play', info: 'More Info', request: 'Request' },
      css: `
        .js-bb { height: min(68vh, 720px) !important; }
        .js-bb-tag { color: #e5e5e5; letter-spacing: .32em; font-weight: 700; font-size: .85em; }
        .js-bb-tag::before { content: "N"; color: #e50914; font-weight: 900; font-size: 1.9em; letter-spacing: 0; margin-right: .3em; vertical-align: -.22em; }
        .js-bb-title { font-weight: 900 !important; letter-spacing: -.02em; text-transform: uppercase; text-shadow: 0 4px 30px rgba(0,0,0,.6); }
        .js-bb-rank::before { content: "TOP\\A 10"; white-space: pre; display: inline-flex; align-items: center; justify-content: center; text-align: center; width: 2.2em; height: 2.2em; font-size: .62em; line-height: .95; font-weight: 900; background: #e50914; color: #fff; border-radius: 3px; margin-right: .6em; vertical-align: middle; }
        .js-bb-btn { border-radius: 4px !important; font-weight: 700 !important; padding: .55em 1.6em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #000 !important; }
        .js-bb-btn.js-secondary { background: rgba(109,109,110,.7) !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 700 !important; font-size: 1.3em !important; color: #e5e5e5 !important; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 4px !important; }
        .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer { transform: scale(1.06); box-shadow: 0 0 0 2px #fff, 0 14px 30px rgba(0,0,0,.8) !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 2px #fff, 0 12px 30px rgba(0,0,0,.7) !important; }
        .js-view .jst-shade { opacity: 0 !important; }
        .js-view .jst-feature::before { background: transparent !important; border: none !important; box-shadow: none !important; }
        .js-view .jst-t10 { background: none !important; -webkit-text-fill-color: #e50914 !important; filter: none !important; }`,
    },
    disney: {
      c1: '#f9f9f9', c2: '#0063e5', num: 'glass',
      base: '#1a1d29', bg: 'radial-gradient(130% 60% at 50% -5%, #2b3a66 0%, transparent 55%), linear-gradient(180deg, #1a1d29 0%, #14172a 100%)',
      shape: 'landscape', caption: 'none',
      font: '"Avenir Next", Avenir, "Nunito Sans", "Inter", sans-serif',
      labels: { tagMovie: 'FEATURED', tagTv: 'FEATURED', play: 'PLAY', info: '', request: 'REQUEST' },
      css: `
        .js-bb { height: min(50vh, 520px) !important; margin: 1em 3.3% 1.6em !important; border-radius: 10px; box-shadow: 0 26px 40px -20px rgba(0,0,0,.8), 0 0 0 1px rgba(249,249,249,.1); }
        .js-bb-tag { color: #cacaca; letter-spacing: .2em; font-size: .75em; font-weight: 700; }
        .js-bb-title { font-weight: 700 !important; }
        .js-bb-btn { border-radius: 4px !important; letter-spacing: .15em; text-transform: uppercase; font-weight: 700 !important; padding: .7em 2em !important; }
        .js-bb-btn.js-primary { background: #f9f9f9 !important; color: #0e0b14 !important; }
        .js-bb-btn.js-secondary { width: 2.9em; padding: 0 !important; border-radius: 50% !important; background: rgba(0,0,0,.6) !important; border: 2px solid #f9f9f9 !important; color: #f9f9f9 !important; }
        .js-view .sectionTitle { font-weight: 600 !important; font-size: 1.2em !important; color: #f9f9f9 !important; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 8px !important; box-shadow: 0 26px 30px -10px rgba(0,0,0,.69), 0 16px 10px -10px rgba(0,0,0,.73), inset 0 0 0 3px rgba(249,249,249,.1) !important; transition: transform .25s cubic-bezier(.25,.46,.45,.94), box-shadow .25s ease; }
        .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer { transform: scale(1.05); box-shadow: 0 40px 58px -16px rgba(0,0,0,.8), 0 30px 22px -10px rgba(0,0,0,.72), inset 0 0 0 4px rgba(249,249,249,.8) !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 4px rgba(249,249,249,.8), 0 24px 40px rgba(0,0,0,.7) !important; }`,
    },
    max: {
      c1: '#ffffff', c2: '#2f5bff', numA: '#ffffff', numB: '#8aa0ff', num: 'solid',
      base: '#000', bg: 'radial-gradient(90% 50% at 100% 0%, rgba(47,91,255,.25), transparent 60%), #000',
      shape: 'portrait', caption: 'none',
      font: '"Inter", "Helvetica Neue", Arial, sans-serif',
      labels: { tagMovie: 'MOVIE', tagTv: 'SERIES', play: 'Play', info: 'More Info', request: 'Request' },
      css: `
        .js-bb { height: min(70vh, 740px) !important; }
        .js-bb-shade { background: linear-gradient(0deg, #000 0%, rgba(0,0,0,.6) 30%, transparent 60%), linear-gradient(90deg, rgba(0,0,0,.75) 0%, transparent 55%) !important; }
        .js-bb-tag { color: #fff; letter-spacing: .3em; font-size: .72em; font-weight: 700; opacity: .8; }
        .js-bb-title { font-weight: 800 !important; letter-spacing: -.02em; }
        .js-bb-btn { border-radius: 999px !important; font-weight: 600 !important; padding: .6em 1.8em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #000 !important; }
        .js-bb-btn.js-secondary { background: transparent !important; border: 1.5px solid rgba(255,255,255,.8) !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 600 !important; letter-spacing: -.01em; color: #fff !important; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 6px !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 2px #fff, 0 0 30px rgba(47,91,255,.45) !important; }`,
    },
    prime: {
      c1: '#1a98ff', c2: '#0f79af', numA: '#1a98ff', numB: '#8fdcff', num: 'solid',
      base: '#0f171e', bg: '#0f171e', shape: 'landscape', caption: 'below',
      font: '"Amazon Ember", Arial, "Helvetica Neue", sans-serif',
      labels: { tagMovie: '✓ Included with Prime', tagTv: '✓ Included with Prime', play: 'Play', info: 'Details', request: 'Request' },
      css: `
        .js-bb { height: min(52vh, 540px) !important; margin: 1em 3.3% 1.6em !important; border-radius: 8px; }
        .js-bb-tag { color: #1a98ff; font-weight: 700; font-size: .9em; }
        .js-bb-title { font-weight: 700 !important; }
        .js-bb-btn { border-radius: 6px !important; font-weight: 700 !important; padding: .65em 1.6em !important; }
        .js-bb-btn.js-primary { background: #1a98ff !important; color: #fff !important; }
        .js-bb-btn.js-secondary { background: rgba(66,82,99,.8) !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 700 !important; color: #fff !important; }
        .js-view .js-section .sectionTitle::before {
          content: "✓" !important; width: 1.15em !important; height: 1.15em !important; border-radius: 50% !important;
          background: #1a98ff !important; color: #0f171e; font-size: .62em; line-height: 1.15em; text-align: center;
          vertical-align: .25em !important; box-shadow: none !important; font-weight: 900;
        }
        .js-view .js-lib .cardImageContainer { border-radius: 8px !important; }
        .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer { transform: scale(1.04); }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 3px #fff, 0 16px 34px rgba(0,0,0,.6) !important; }`,
    },
    hulu: {
      c1: '#1ce783', c2: '#0f9d5a', numA: '#0b0c0f', numB: '#1ce783', num: 'outline',
      base: '#0b0c0f', bg: '#0b0c0f', shape: 'landscape', caption: 'below',
      font: '"Graphik", "Inter", "Helvetica Neue", Arial, sans-serif',
      labels: { tagMovie: 'TRENDING ON HULU', tagTv: 'TRENDING ON HULU', play: 'START WATCHING', info: 'DETAILS', request: 'REQUEST' },
      css: `
        .js-bb { height: min(66vh, 700px) !important; }
        .js-bb-tag { color: #1ce783; letter-spacing: .14em; font-size: .78em; font-weight: 700; }
        .js-bb-title { font-weight: 800 !important; text-transform: uppercase; letter-spacing: .01em; }
        .js-bb-btn { border-radius: 4px !important; letter-spacing: .12em; font-size: .82em !important; font-weight: 700 !important; padding: .8em 1.6em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #0b0c0f !important; }
        .js-bb-btn.js-secondary { background: transparent !important; border: 2px solid rgba(255,255,255,.9) !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 700 !important; text-transform: uppercase; letter-spacing: .12em; font-size: .95em !important; color: #fff !important; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 6px !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 3px #1ce783, 0 16px 34px rgba(0,0,0,.6) !important; }`,
    },
    apple: {
      c1: '#f5f5f7', c2: '#86868b', num: 'glass',
      base: '#000', bg: '#000', shape: 'landscape', caption: 'below',
      font: '-apple-system, "SF Pro Display", "Inter", "Helvetica Neue", sans-serif',
      labels: { tagMovie: 'Movie', tagTv: 'TV Show', play: 'Play', info: 'Details', request: 'Request' },
      css: `
        .js-bb { height: min(72vh, 760px) !important; }
        .js-bb-shade { background: linear-gradient(0deg, #000 0%, rgba(0,0,0,.55) 28%, transparent 55%), linear-gradient(90deg, rgba(0,0,0,.6) 0%, transparent 50%) !important; }
        .js-bb-tag { color: rgba(255,255,255,.7); font-weight: 600; font-size: .85em; }
        .js-bb-title { font-weight: 700 !important; letter-spacing: -.035em; }
        .js-bb-btn { border-radius: 10px !important; font-weight: 600 !important; padding: .65em 1.9em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #000 !important; }
        .js-bb-btn.js-secondary { background: rgba(255,255,255,.16) !important; color: #fff !important; }
        html:not(.js-lite) .js-bb-btn.js-secondary { -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); }
        .js-view .sectionTitle { font-weight: 600 !important; letter-spacing: -.015em; color: #f5f5f7 !important; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 12px !important; }
        .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer { transform: scale(1.04); box-shadow: 0 24px 44px rgba(0,0,0,.85) !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 1px rgba(255,255,255,.4), 0 22px 44px rgba(0,0,0,.8) !important; }`,
    },
    paramount: {
      c1: '#0064ff', c2: '#7fb2ff', numA: '#0064ff', numB: '#9cc4ff', num: 'solid',
      base: '#000a1f', bg: 'radial-gradient(120% 60% at 50% -10%, #0b3fae 0%, transparent 55%), linear-gradient(180deg, #001a4d 0%, #000a1f 60%)',
      shape: 'portrait', caption: 'none',
      font: '"Montserrat", "Inter", "Helvetica Neue", Arial, sans-serif',
      labels: { tagMovie: 'PARAMOUNT+', tagTv: 'PARAMOUNT+', play: 'WATCH NOW', info: 'MORE INFO', request: 'REQUEST' },
      css: `
        .js-bb { height: min(62vh, 660px) !important; }
        .js-bb-shade { background: linear-gradient(90deg, rgba(0,20,61,.95) 0%, rgba(0,20,61,.6) 35%, transparent 65%), linear-gradient(0deg, #000a1f 0%, transparent 40%) !important; }
        .js-bb-tag { color: #7fb2ff; letter-spacing: .25em; font-size: .72em; font-weight: 800; }
        .js-bb-title { font-weight: 800 !important; }
        .js-bb-btn { border-radius: 4px !important; letter-spacing: .1em; font-size: .85em !important; font-weight: 800 !important; padding: .8em 1.7em !important; }
        .js-bb-btn.js-primary { background: #0064ff !important; color: #fff !important; }
        .js-bb-btn.js-secondary { background: rgba(255,255,255,.12) !important; border: 1px solid rgba(255,255,255,.4) !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 800 !important; color: #fff !important; }
        .js-view .js-section .sectionTitle::before { background: #0064ff !important; box-shadow: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 4px !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 3px #fff, 0 0 26px rgba(0,100,255,.6) !important; }`,
    },
    peacock: {
      c1: '#ffb000', c2: '#e5007e', numA: '#ffb000', numB: '#e5007e', num: 'solid',
      base: '#000', bg: '#000', shape: 'landscape', caption: 'overlay',
      font: '"Peacock Sans", "Inter", "Helvetica Neue", Arial, sans-serif',
      labels: { tagMovie: 'MOVIE', tagTv: 'SERIES', play: 'Watch Now', info: 'Details', request: 'Request' },
      css: `
        .js-bb { height: min(64vh, 680px) !important; }
        .js-bb::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: linear-gradient(90deg, #ffb000, #ff6d00, #e5007e, #6f2da8, #0063db, #00b14f); }
        .js-bb-tag { color: #fff; letter-spacing: .2em; font-size: .75em; font-weight: 700; opacity: .85; }
        .js-bb-title { font-weight: 800 !important; }
        .js-bb-btn { border-radius: 999px !important; font-weight: 700 !important; padding: .65em 1.8em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #000 !important; }
        .js-bb-btn.js-secondary { background: transparent !important; border: 2px solid #fff !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 700 !important; color: #fff !important; }
        .js-view .js-section .sectionTitle::before { background: linear-gradient(180deg, #ffb000, #ff6d00, #e5007e, #6f2da8, #0063db, #00b14f) !important; box-shadow: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 8px !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 3px #fff, -6px 0 22px rgba(255,176,0,.45), 6px 0 22px rgba(229,0,126,.45), 0 8px 26px rgba(0,99,219,.45) !important; }`,
    },
  };
  const GENERIC = {
    shape: 'portrait', caption: 'below', base: '#0b0c10',
    labels: { tagMovie: 'MOVIE', tagTv: 'SERIES', play: 'Play', info: 'Details', request: 'Request' },
  };

  // Top 10 numerals, the way each service draws them
  const NUMERALS = {
    netflix: '--js-num-fill: #141414; --js-num-stroke: 4px #595959;',
    disney: '--js-num-fill: transparent; --js-num-stroke: 3px rgba(249,249,249,.85);',
    max: '--js-num-fill: #fff; --js-num-stroke: 0 transparent;',
    prime: '--js-num-fill: #1a98ff; --js-num-stroke: 0 transparent;',
    hulu: '--js-num-fill: #0b0c0f; --js-num-stroke: 3px #1ce783;',
    apple: '--js-num-fill: rgba(255,255,255,.1); --js-num-stroke: 2px rgba(255,255,255,.65);',
    paramount: '--js-num-fill: #0064ff; --js-num-stroke: 3px #7fb2ff;',
    peacock: '--js-num-fill: #000; --js-num-stroke: 3px #ffb000;',
  };

  const brandKeyFor = (svc) => {
    const id = `${svc.Key} ${svc.Name}`.toLowerCase();
    return Object.keys(BRANDS).find((k) => id.includes(k)) || (/hbo/.test(id) ? 'max' : /amazon/.test(id) ? 'prime' : null);
  };

  // scope every brand rule to html[data-js-brand="..."] (commas inside :is(...) stay put)
  const splitSel = (sel) => {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of sel) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  const brandCss = (() => {
    const el = document.createElement('style');
    el.id = 'jellystream-brands';
    el.textContent = Object.entries(BRANDS).map(([k, b]) => {
      const rules = b.css.replace(/(^|})\s*([^{}]+)\{/g, (m, close, sel) =>
        `${close}\n${splitSel(sel).map((x) => `html[data-js-brand="${k}"] ${x}`).join(', ')} {`);
      return `${rules}\nhtml[data-js-brand="${k}"] .js-view { font-family: ${b.font}; ${NUMERALS[k] || ''} }`;
    }).join('\n');
    return el;
  })();

  const applyBrand = (svc) => {
    const html = document.documentElement;
    const root = html.style;
    if (!svc) {
      ['--js-c1', '--js-c2', '--js-bg', '--js-base', '--jst-num', '--jst-num-a', '--jst-num-b'].forEach((v) => root.removeProperty(v));
      delete html.dataset.jsBrand;
      delete html.dataset.jstNum;
      return;
    }
    const set = (b) => {
      root.setProperty('--js-c1', svc.Accent || b.c1);
      root.setProperty('--js-c2', b.c2);
      root.setProperty('--js-bg', b.bg);
      root.setProperty('--jst-num', b.num || 'glass');
      root.setProperty('--jst-num-a', b.numA || b.c1);
      root.setProperty('--jst-num-b', b.numB || b.c2);
      root.setProperty('--js-base', b.base || '#0b0c10');
      html.dataset.jstNum = b.num || 'glass';
    };
    const known = brandKeyFor(svc);
    if (known) {
      html.dataset.jsBrand = known;
      set(BRANDS[known]);
      return;
    }
    delete html.dataset.jsBrand;
    autoAccent(svc).then((accent) => {
      if (serviceKey() !== svc.Key) return;
      const c = svc.Accent || accent || '#8aa0b8';
      set({ c1: c, c2: c, num: 'glass', bg: `radial-gradient(110% 70% at 10% -10%, color-mix(in srgb, ${c} 32%, transparent), transparent 60%), #0b0c10` });
    });
  };

  const state = {
    cfg: null,
    cfgAt: 0,
    data: new Map(),   // service key -> loaded page data
    accents: new Map(), // service key -> auto accent from logo
  };

  // ---------------------------------------------------------------- styles
  const css = document.createElement('style');
  css.id = 'jellystream-css';
  css.textContent = `
    /* service tiles: landscape glass cards. The backdrop is what's trending on that service right now,
       washed in the service's color, with the logo and name on a frosted strip. */
    .js-services .js-svc-card .cardScalable { background: transparent !important; box-shadow: none !important; }
    .js-services .js-svc-card .cardImageContainer {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      display: block !important;
      overflow: hidden;
      border-radius: 16px !important;
      background: linear-gradient(135deg, var(--js-t1, #3a4150), var(--js-t2, #171a21)) !important;
      box-shadow: 0 14px 30px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.1) !important;
      transition: box-shadow .25s ease, transform .25s cubic-bezier(.2,.9,.25,1);
    }
    .js-services .js-tile-bg {
      position: absolute; inset: 0;
      background-size: cover;
      background-position: center 25%;
      opacity: 0;
      transform: scale(1.02);
      transition: opacity .5s ease, transform .6s cubic-bezier(.2,.9,.25,1);
    }
    .js-services .js-tile-bg.on { opacity: 1; }
    .js-services .js-tile-tint {
      position: absolute; inset: 0;
      background:
        linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(8,9,12,.85) 100%),
        linear-gradient(120deg, color-mix(in srgb, var(--js-t1, #3a4150) 55%, transparent) 0%, transparent 55%);
    }
    .js-services .js-tile-sheen {
      position: absolute; inset: 0;
      background: linear-gradient(160deg, rgba(255,255,255,.18) 0%, rgba(255,255,255,0) 32%);
      pointer-events: none;
    }
    .js-services .js-tile-info {
      position: absolute;
      left: .7em; right: .7em; bottom: .7em;
      display: flex; align-items: center; gap: .65em;
      padding: .45em .6em .45em .45em;
      border-radius: 12px;
      background: rgba(18,20,26,.45);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
      font-family: ${FONT};
      color: #fff;
      text-align: left;
    }
    html:not(.js-lite) .js-services .js-tile-info {
      -webkit-backdrop-filter: blur(14px) saturate(160%);
      backdrop-filter: blur(14px) saturate(160%);
    }
    html.js-lite .js-services .js-tile-info { background: rgba(18,20,26,.8); }
    .js-services .js-tile-logo {
      width: 2.5em; height: 2.5em; flex: none;
      border-radius: 22%;
      object-fit: cover;
      box-shadow: 0 4px 12px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.14);
    }
    .js-services .js-tile-text { min-width: 0; line-height: 1.15; }
    .js-services .js-tile-text b {
      display: block; font-weight: 800; font-size: 1.02em; letter-spacing: -.01em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .js-services .js-tile-text small {
      display: block; font-size: .74em; color: rgba(255,255,255,.7);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .js-services .js-tile-dot {
      display: inline-block; width: 6px; height: 6px; border-radius: 50%;
      margin-right: .4em; vertical-align: .1em;
      background: var(--js-t1, #fff); box-shadow: 0 0 8px var(--js-t1, #fff);
    }
    .js-services .js-svc-card:is(:hover, :focus-within, .show-focus, .focused) .cardImageContainer {
      box-shadow: 0 18px 36px rgba(0,0,0,.55), 0 0 0 2px rgba(255,255,255,.9), 0 0 28px color-mix(in srgb, var(--js-t1, #fff) 50%, transparent) !important;
    }
    .js-services .js-svc-card:is(:hover, :focus-within, .show-focus, .focused) .js-tile-bg { transform: scale(1.08); }
    .js-services .cardBox { margin-bottom: .4em !important; }
    .js-services .cardText-secondary { opacity: .6; }

    /* service page */
    .js-hide-native > :not(.js-view) { display: none !important; }
    /* the featured banner (Media Bar etc.) belongs to the normal home screen, and so does the space it reserves */
    html.js-service-open #slides-container,
    html.js-service-open .js-hide-with-service { display: none !important; }
    html.js-service-open .homeSectionsContainer,
    html.js-service-open #homeTab .sections { margin-top: 0 !important; }

    /* the whole page takes the service's look */
    html.js-service-open .backgroundContainer {
      background: var(--js-bg, #0b0c10) !important;
      transition: background .4s ease;
    }
    html.js-service-open .backdropContainer { display: none !important; }

    /* brand accents */
    .js-view .js-section:not(.js-switcher) .sectionTitle::before {
      content: "";
      display: inline-block;
      width: .26em; height: .9em;
      margin-right: .5em;
      border-radius: 3px;
      vertical-align: -.06em;
      background: linear-gradient(180deg, var(--js-c1, #fff), var(--js-c2, #888));
      box-shadow: 0 0 10px color-mix(in srgb, var(--js-c1, #fff) 55%, transparent);
    }
    .js-view .card:is(:hover, :focus, :focus-within, .show-focus, .focused) .cardImageContainer,
    .js-view .jst-top10 .card:is(:hover, :focus, :focus-within, .show-focus, .focused) .cardImageContainer {
      box-shadow:
        0 16px 36px rgba(0,0,0,.5),
        0 0 0 2px var(--js-c1, #fff),
        0 0 26px color-mix(in srgb, var(--js-c1, #fff) 45%, transparent) !important;
    }
    html.js-service-open #__jf_library_focus_ring__ {
      border-color: var(--js-c1, #fff) !important;
      box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 18px color-mix(in srgb, var(--js-c1, #fff) 60%, transparent) !important;
    }
    .js-view .jst-eyebrow::before { background: var(--js-c1, #fff) !important; }
    .js-view .jst-eyebrow::after { background: linear-gradient(90deg, color-mix(in srgb, var(--js-c1, #fff) 60%, transparent), transparent) !important; }
    .js-view .jst-feature::before {
      border-color: color-mix(in srgb, var(--js-c1, #fff) 22%, rgba(255,255,255,.06)) !important;
      background: linear-gradient(180deg, color-mix(in srgb, var(--js-c1, #fff) 9%, rgba(255,255,255,.03)) 0%, rgba(255,255,255,.01) 100%) !important;
    }
    .js-view .jst-x { border-color: color-mix(in srgb, var(--js-c1, #fff) 35%, rgba(255,255,255,.14)) !important; }
    .js-view .jst-x-eb::before { background: var(--js-c1, #fff) !important; }
    .js-view .js-badge {
      background: linear-gradient(180deg, color-mix(in srgb, var(--js-c1, #fff) 70%, transparent), color-mix(in srgb, var(--js-c2, #888) 45%, transparent)), rgba(20,22,28,.6);
    }
    .js-view .js-badge.js-requested { background: linear-gradient(180deg, rgba(255,196,80,.55), rgba(255,170,40,.3)), rgba(20,22,28,.6); }
    .js-switcher .js-current .cardImageContainer {
      box-shadow: 0 0 0 2px var(--js-c1, #fff), 0 0 18px color-mix(in srgb, var(--js-c1, #fff) 45%, transparent) !important;
    }

    /* motion: service pages slide in (view transitions do the morph where supported) */
    @keyframes js-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes js-fade { from { opacity: 0; } to { opacity: 1; } }
    .js-view.js-anim .js-hero { animation: js-in .42s cubic-bezier(.2,.9,.25,1) both; }
    .js-view.js-anim .js-rows > .js-section { animation: js-in .46s cubic-bezier(.2,.9,.25,1) both; }
    .js-view.js-anim .js-rows > .js-section:nth-child(2) { animation-delay: .04s; }
    .js-view.js-anim .js-rows > .js-section:nth-child(3) { animation-delay: .08s; }
    .js-view.js-anim .js-rows > .js-section:nth-child(n+4) { animation-delay: .12s; }
    html.js-lite .js-view.js-anim .js-hero,
    html.js-lite .js-view.js-anim .js-rows > .js-section { animation: js-fade .2s ease-out both; }
    ::view-transition-group(js-logo) { animation-duration: .45s; animation-timing-function: cubic-bezier(.2,.9,.25,1); }
    ::view-transition-old(root), ::view-transition-new(root) { animation-duration: .28s; }
    .js-view { padding-bottom: 2em; }
    .js-hero {
      position: relative;
      display: flex;
      align-items: center;
      gap: 1.2em;
      margin: 1.2em 3.3% 1.6em;
      padding: 1.4em 1.6em;
      border-radius: 24px;
      overflow: hidden;
      font-family: ${FONT};
      background:
        radial-gradient(90% 160% at 0% 0%, color-mix(in srgb, var(--js-c1, #8899aa) 38%, transparent) 0%, transparent 62%),
        radial-gradient(70% 140% at 100% 100%, color-mix(in srgb, var(--js-c2, #556677) 26%, transparent) 0%, transparent 60%),
        linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.015));
      border: 1px solid color-mix(in srgb, var(--js-c1, #fff) 24%, rgba(255,255,255,.08));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 20px 50px rgba(0,0,0,.25);
    }
    .js-hero img {
      width: 72px; height: 72px; border-radius: 18px; object-fit: cover; flex: none;
      box-shadow: 0 10px 26px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.14);
    }
    .js-hero .js-eyebrow {
      display: flex; align-items: center; gap: .6em;
      font-size: .72em; font-weight: 700; letter-spacing: .26em; text-transform: uppercase;
      color: rgba(255,255,255,.6);
    }
    .js-hero .js-eyebrow::before {
      content: ""; width: 6px; height: 6px; border-radius: 50%;
      background: var(--js-c1, #fff);
      box-shadow: 0 0 10px var(--js-c1, #fff);
    }
    .js-hero h1 { margin: .15em 0 .1em; font-size: 2.1em; font-weight: 800; letter-spacing: -.03em; line-height: 1; }
    .js-hero .js-stats { color: rgba(255,255,255,.65); font-size: .95em; }
    .js-hero .js-back {
      margin-left: auto;
      font: 700 .85em ${FONT};
      color: rgba(255,255,255,.85);
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 999px;
      padding: .55em 1.1em;
      cursor: pointer;
    }
    .js-hero .js-back:hover { background: rgba(255,255,255,.14); }
    /* billboard: the service's #1 title, full width, like the top of each service's own app */
    .js-bb {
      position: relative;
      height: min(62vh, 660px);
      min-height: 320px;
      margin: 0 0 1.2em;
      overflow: hidden;
      color: #fff;
      background: var(--js-base, #0b0c10);
    }
    .js-bb-art {
      position: absolute; inset: 0;
      background-size: cover;
      background-position: center 20%;
      opacity: 0;
      transition: opacity .6s ease;
    }
    .js-bb-art.on { opacity: 1; }
    .js-bb-shade {
      position: absolute; inset: 0;
      background:
        linear-gradient(90deg, var(--js-base, #0b0c10) 0%, color-mix(in srgb, var(--js-base, #0b0c10) 70%, transparent) 28%, transparent 62%),
        linear-gradient(0deg, var(--js-base, #0b0c10) 0%, transparent 38%);
    }
    .js-bb-content {
      position: absolute;
      left: 3.3%; bottom: 13%;
      width: min(44%, 640px);
      display: flex; flex-direction: column; gap: .75em;
    }
    .js-bb-tag { text-transform: none; }
    .js-bb-title { margin: 0; font-size: clamp(2em, 4.2vw, 4.4em); line-height: 1; font-weight: 800; }
    .js-bb-rank { font-weight: 700; font-size: 1.05em; display: flex; align-items: center; }
    .js-bb-overview {
      margin: 0; font-size: 1.05em; line-height: 1.45; color: rgba(255,255,255,.88);
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
      text-shadow: 0 2px 8px rgba(0,0,0,.5);
    }
    .js-bb-actions { display: flex; gap: .7em; margin-top: .3em; }
    .js-bb-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: .45em;
      height: 2.9em; box-sizing: border-box;
      border: none; cursor: pointer; text-decoration: none;
      font: inherit; font-size: 1em; white-space: nowrap;
      transition: transform .15s ease, filter .15s ease;
    }
    .js-bb-btn:hover { filter: brightness(.9); transform: scale(1.03); }
    .js-bb-btn .material-icons { font-size: 1.5em; }
    .js-bb .js-hero {
      position: absolute; top: 1.2em; right: 3.3%; left: auto;
      margin: 0 !important; padding: .45em .55em .45em .45em !important;
      gap: .6em !important; border-radius: 999px !important;
      background: rgba(0,0,0,.45) !important; border: 1px solid rgba(255,255,255,.15) !important;
      box-shadow: none !important;
      font-size: .8em;
    }
    .js-bb .js-hero img { width: 2.4em !important; height: 2.4em !important; border-radius: 50% !important; }
    .js-bb .js-hero h1 { font-size: 1.1em !important; margin: 0 !important; color: #fff !important; -webkit-text-fill-color: #fff !important; text-transform: none !important; }
    .js-bb .js-hero .js-eyebrow, .js-bb .js-hero .js-stats { display: none !important; }
    .js-bb .js-hero .js-back { margin-left: .4em; padding: .45em .9em !important; border-radius: 999px !important; background: rgba(255,255,255,.14) !important; color: #fff !important; border: none !important; }
    @media (max-width: 900px) { .js-bb-content { width: 86%; } .js-bb-overview { -webkit-line-clamp: 2; } }

    /* landscape library cards and captions */
    .js-view .js-lib.overflowBackdropCard .cardImageContainer { background-size: cover; background-position: center; }
    .js-view .js-lib .cardImageContainer { transition: transform .25s cubic-bezier(.2,.9,.25,1), box-shadow .25s ease; }
    .js-ovl {
      position: absolute; left: 0; right: 0; bottom: 0;
      padding: 1.6em .7em .55em;
      font-weight: 700; font-size: .95em; color: #fff; text-align: left;
      background: linear-gradient(0deg, rgba(0,0,0,.85), transparent);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      pointer-events: none;
    }
    .js-cap-overlay .cardFooter, .js-cap-none .cardFooter { display: none !important; }
    .js-cap-below .cardText { text-align: left !important; padding-left: .15em; }
    .js-cap-below .cardText-first { font-weight: 600; }

    /* native Top 10 rows */
    .js-view { --js-poster-w: clamp(118px, 10.5vw, 210px); }
    .js-rank-card { width: calc(var(--js-poster-w) * 1.62) !important; flex: 0 0 auto; }
    .js-rank-card .cardBox { margin: 0 .2em !important; }
    .js-rank-box {
      position: relative !important;
      height: calc(var(--js-poster-w) * 1.5) !important;
      overflow: visible !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    .js-rank-num {
      position: absolute;
      left: 0; bottom: -.11em;
      z-index: 0;
      font-family: var(--js-num-font, inherit);
      font-size: calc(var(--js-poster-w) * 1.42);
      font-weight: 900;
      line-height: 1;
      letter-spacing: -.09em;
      color: var(--js-num-fill, #141414);
      -webkit-text-stroke: var(--js-num-stroke, 4px #595959);
      paint-order: stroke fill;
      user-select: none;
      pointer-events: none;
    }
    .js-rank-card:last-child .js-rank-num { letter-spacing: -.16em; }
    .js-rank-poster {
      position: absolute !important;
      top: 0; bottom: 0; right: 0; left: auto !important;
      width: var(--js-poster-w) !important;
      height: 100% !important;
      z-index: 1;
      background-size: cover;
      background-position: center;
      border-radius: 4px;
      box-shadow: -8px 0 18px rgba(0,0,0,.45);
    }
    .js-rank-card .js-badge { z-index: 2; }
    .js-rank-card .cardFooter { display: none !important; }
    .js-view .js-rank-card:is(:hover,:focus-within,.show-focus,.focused) .js-rank-poster { transform: scale(1.04); }
    .js-rank-poster { transition: transform .22s cubic-bezier(.2,.9,.25,1), box-shadow .22s ease; }

    /* service switcher: Home + every service, reachable with a remote */
    .js-switcher .js-sw-card { width: clamp(84px, 7.5vw, 124px) !important; }
    .js-switcher .cardPadder { padding-bottom: 100% !important; }
    .js-switcher .cardImageContainer {
      display: flex !important; align-items: center; justify-content: center;
      border-radius: 22% !important; overflow: hidden;
      background: linear-gradient(160deg, rgba(255,255,255,.14), rgba(255,255,255,.03)), rgba(22,24,30,.9) !important;
      border: 1px solid rgba(255,255,255,.12);
    }
    .js-switcher .cardImageContainer img { width: 100%; height: 100%; object-fit: cover; }
    .js-switcher .cardImageContainer .material-icons { font-size: 2.4em; color: rgba(255,255,255,.85); }
    .js-switcher .js-current .cardImageContainer { box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 0 18px rgba(255,255,255,.25); }
    .js-switcher .js-sw-card:not(.js-current) .cardImageContainer img { opacity: .8; }
    .js-switcher .cardText { font-size: .85em; }
    .js-empty { margin: 0 3.3% 1.5em; color: rgba(255,255,255,.6); font-family: ${FONT}; }

    /* scrolling rows (plain markup, so no Jellyfin scroller upgrade is needed) */
    .js-view .emby-scroller.js-scroller, .js-services .emby-scroller.js-scroller {
      overflow-x: auto !important;
      overflow-y: hidden !important;
      scrollbar-width: none;
      scroll-behavior: smooth;
      margin: 0 !important;
      padding: 14px 3.3% 18px !important;
      overscroll-behavior-x: contain;
    }
    .js-rowwrap { position: relative; margin-top: -8px; }
    .js-arrow {
      position: absolute;
      top: 14px; bottom: 18px;
      z-index: 8;
      width: 3.3%;
      min-width: 44px;
      display: flex; align-items: center; justify-content: center;
      border: none;
      padding: 0;
      cursor: pointer;
      color: #fff;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease;
    }
    .js-arrow .material-icons {
      font-size: 2.2em;
      width: 1.5em; height: 1.5em;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%;
      background: rgba(20,22,28,.72);
      border: 1px solid rgba(255,255,255,.18);
      box-shadow: 0 6px 18px rgba(0,0,0,.5);
      transition: transform .15s ease, background .15s ease;
    }
    .js-arrow:hover .material-icons { transform: scale(1.1); background: rgba(40,44,54,.9); }
    .js-prev { left: 0; background: linear-gradient(90deg, rgba(0,0,0,.45), transparent); }
    .js-next { right: 0; background: linear-gradient(270deg, rgba(0,0,0,.45), transparent); }
    @media (hover: hover) {
      .js-rowwrap:hover .js-arrow.on { opacity: 1; pointer-events: auto; }
    }
    .js-scroller::-webkit-scrollbar { display: none; }
    .js-scroller > .itemsContainer { display: flex; flex-wrap: nowrap; }
    .js-scroller .card { flex: 0 0 auto; }
    .js-view .sectionTitleContainer, .js-services .sectionTitleContainer { padding-left: 3.3%; }

    /* posters load as they come into view */
    .js-img { background-size: cover; background-position: center; background-color: rgba(255,255,255,.05); }

    /* titles you don't have */
    .js-badge {
      position: absolute;
      top: .5em; right: .5em;
      z-index: 4;
      display: inline-flex;
      align-items: center;
      gap: .3em;
      height: 1.9em;
      min-width: 1.9em;
      padding: 0 .45em;
      box-sizing: border-box;
      justify-content: center;
      border-radius: 999px;
      font: 700 .72em ${FONT};
      color: #fff;
      background: linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.08)), rgba(20,22,28,.55);
      border: 1px solid rgba(255,255,255,.22);
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
      pointer-events: none;
    }
    .js-badge .material-icons { font-size: 1.35em; }
    .js-badge.js-requested { background: linear-gradient(180deg, rgba(255,196,80,.5), rgba(255,170,40,.25)), rgba(20,22,28,.6); }
    .js-badge.js-armed { background: linear-gradient(180deg, rgba(80,170,255,.55), rgba(40,120,255,.3)), rgba(20,22,28,.6); }
    .js-missing .cardImageContainer { filter: saturate(.75) brightness(.85); }
    .js-missing:is(:hover, :focus-within) .cardImageContainer { filter: none; }

    /* glass effects that cost GPU time are skipped in lite mode */
    html:not(.js-lite) .js-badge, html:not(.js-lite) .js-hero {
      -webkit-backdrop-filter: blur(10px) saturate(160%);
      backdrop-filter: blur(10px) saturate(160%);
    }

    /* toast */
    .js-toast {
      position: fixed;
      left: 50%; bottom: 6vh;
      z-index: 99999;
      transform: translate(-50%, 20px);
      opacity: 0;
      padding: .8em 1.3em;
      border-radius: 999px;
      font: 700 1em ${FONT};
      color: #fff;
      background: linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.05)), rgba(18,20,26,.92);
      border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 14px 40px rgba(0,0,0,.45);
      transition: opacity .2s ease, transform .25s ease;
      pointer-events: none;
    }
    .js-toast.on { opacity: 1; transform: translate(-50%, 0); }
  `;
  document.head.appendChild(css);
  document.head.appendChild(brandCss);

  let toastTimer;
  const toast = (msg) => {
    let t = document.querySelector('.js-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'js-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  };

  // ---------------------------------------------------------------- lazy images
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      io.unobserve(el);
      if (el.dataset.src) el.style.backgroundImage = bgOf(el.dataset.src);
    }
  }, { rootMargin: '400px 600px' }) : null;
  // "a|b" = show a, with b underneath in case a is missing
  const bgOf = (src) => src.split('|').filter(Boolean).map((u) => `url("${u}")`).join(', ');
  const lazy = (root) => root.querySelectorAll('.js-img[data-src]').forEach((el) => {
    if (io) io.observe(el); else el.style.backgroundImage = bgOf(el.dataset.src);
  });

  // ---------------------------------------------------------------- cards
  const imgUrl = (id) => window.ApiClient.getImageUrl(id, { type: 'Primary', maxHeight: 480, quality: 90 });
  const wideUrl = (id) => `${window.ApiClient.getImageUrl(id, { type: 'Backdrop', maxWidth: 720, quality: 85 })}|${imgUrl(id)}`;

  // the look of the open service (cards are built after applyBrand runs)
  const look = () => {
    const k = document.documentElement.dataset.jsBrand;
    return (k && BRANDS[k]) || GENERIC;
  };

  const card = ({ id, name, sub, img, href, cls = '', attrs = '', badge = '', type = '', shape = 'portrait', caption = 'below' }) => `
    <div class="card ${shape === 'landscape' ? 'overflowBackdropCard' : 'overflowPortraitCard'} card-hoverable js-card js-cap-${caption} ${cls}" ${id ? `data-id="${esc(id)}" data-serverid="${esc(serverId())}"` : ''} ${type ? `data-type="${type}"` : ''} ${attrs}>
      <div class="cardBox cardBox-bottompadded">
        <div class="cardScalable">
          <div class="cardPadder ${shape === 'landscape' ? 'cardPadder-overflowBackdrop' : 'cardPadder-overflowPortrait'}"></div>
          <a class="cardImageContainer coveredImage cardContent itemAction js-img" href="${esc(href)}" aria-label="${esc(name)}" ${img ? `data-src="${esc(img)}"` : ''}>${caption === 'overlay' ? `<span class="js-ovl">${esc(name)}</span>` : ''}</a>
          ${badge}
        </div>
        <div class="cardFooter">
          <div class="cardText cardTextCentered cardText-first"><bdi>${esc(name)}</bdi></div>
          <div class="cardText cardTextCentered cardText-secondary"><bdi>${esc(sub ?? '')}</bdi></div>
        </div>
      </div>
    </div>`;

  const detailsHref = (id) => `#/details?id=${id}&serverId=${serverId()}`;

  // library rows follow the service's own card shape
  const libraryCard = (it) => {
    const l = look();
    return card({
      id: it.Id,
      name: it.Name,
      sub: it.Year || '',
      img: l.shape === 'landscape' ? wideUrl(it.Id) : imgUrl(it.Id),
      href: detailsHref(it.Id),
      type: it.Type === 'tv' ? 'Series' : 'Movie',
      cls: 'js-lib',
      shape: l.shape,
      caption: l.caption,
    });
  };

  const BADGES = {
    missing: '<span class="js-badge" title="Not in your library"><span class="material-icons">add</span></span>',
    requested: '<span class="js-badge js-requested" title="Requested"><span class="material-icons">schedule</span></span>',
    partial: '<span class="js-badge" title="Partly available"><span class="material-icons">timelapse</span></span>',
  };

  // Top 10 card: a big rank numeral with the poster tucked against it, styled per service
  const rankCard = (t, i) => {
    const owned = !!t.ItemId;
    const status = owned ? '' : (t.Status === 'available' ? 'missing' : t.Status);
    return `
    <div class="card js-card js-rank-card${owned ? '' : ' js-missing'}" ${owned ? `data-id="${esc(t.ItemId)}" data-serverid="${esc(serverId())}" data-type="${t.Type === 'tv' ? 'Series' : 'Movie'}"` : `data-jstmdb="${t.TmdbId}" data-jstype="${t.Type}" data-jsstatus="${status}"`}>
      <div class="cardBox">
        <div class="cardScalable js-rank-box">
          <span class="js-rank-num" aria-hidden="true">${i + 1}</span>
          <a class="cardImageContainer cardContent itemAction js-img js-rank-poster" href="${owned ? esc(detailsHref(t.ItemId)) : '#'}" aria-label="${esc(t.Name)}" data-src="${esc(owned ? imgUrl(t.ItemId) : (t.Poster || ''))}"></a>
          ${owned ? (t.Status === 'partial' ? BADGES.partial : '') : (BADGES[status] || BADGES.missing)}
        </div>
        <div class="cardFooter"><div class="cardText cardText-first"><bdi>${esc(t.Name)}</bdi></div></div>
      </div>
    </div>`;
  };

  // wide = use the service's card shape (request rows); Top 10 rows stay portrait
  const titleCard = (t, wide = false) => {
    const l = look();
    const landscape = wide && l.shape === 'landscape';
    const caption = wide ? l.caption : 'below';
    if (t.ItemId) {
      return card({
        id: t.ItemId, name: t.Name, sub: t.Year || '',
        img: landscape ? wideUrl(t.ItemId) : imgUrl(t.ItemId),
        href: detailsHref(t.ItemId), type: t.Type === 'tv' ? 'Series' : 'Movie',
        badge: t.Status === 'partial' ? BADGES.partial : '',
        cls: wide ? 'js-lib' : '', shape: landscape ? 'landscape' : 'portrait', caption,
      });
    }
    const status = t.Status === 'available' ? 'missing' : t.Status;
    return card({
      name: t.Name,
      sub: t.Year || '',
      img: landscape ? `${t.Backdrop || ''}|${t.Poster || ''}` : t.Poster,
      href: '#',
      cls: `js-missing${wide ? ' js-lib' : ''}`,
      attrs: `data-jstmdb="${t.TmdbId}" data-jstype="${t.Type}" data-jsstatus="${status}"`,
      badge: BADGES[status] || BADGES.missing,
      shape: landscape ? 'landscape' : 'portrait',
      caption,
    });
  };

  const section = ({ title, cards, attrs = '', cls = '' }) => cards.length ? `
    <div class="verticalSection js-section ${cls}" ${attrs}>
      <div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
        <h2 class="sectionTitle sectionTitle-cards">${esc(title)}</h2>
      </div>
      <div class="js-rowwrap">
        <button type="button" class="js-arrow js-prev" tabindex="-1" aria-label="Scroll left"><span class="material-icons">chevron_left</span></button>
        <div class="emby-scroller js-scroller">
          <div class="itemsContainer scrollSlider focuscontainer-x">${cards.join('')}</div>
        </div>
        <button type="button" class="js-arrow js-next" tabindex="-1" aria-label="Scroll right"><span class="material-icons">chevron_right</span></button>
      </div>
    </div>` : '';

  // Jellyfin pauses/resumes every .itemsContainer on the home screen when you leave or return.
  // Ours are plain elements, so give them the two methods; without them leaving the page threw an error.
  const stubRows = (root) => root.querySelectorAll('.js-section .itemsContainer').forEach((el) => {
    if (!el.pause) el.pause = () => {};
    if (!el.resume) el.resume = () => Promise.resolve();
  });

  // arrows show only when there's more to see in that direction
  const updateArrows = (sc) => {
    const wrap = sc.parentElement;
    if (!wrap?.classList.contains('js-rowwrap')) return;
    const max = sc.scrollWidth - sc.clientWidth;
    wrap.querySelector('.js-prev')?.classList.toggle('on', sc.scrollLeft > 4);
    wrap.querySelector('.js-next')?.classList.toggle('on', sc.scrollLeft < max - 4);
  };
  const updateAllArrows = (root = document) => root.querySelectorAll('.js-scroller').forEach(updateArrows);
  document.addEventListener('scroll', (e) => {
    if (e.target.classList?.contains('js-scroller')) updateArrows(e.target);
  }, { capture: true, passive: true });
  addEventListener('resize', () => updateAllArrows());
  document.addEventListener('mouseover', (e) => {
    const wrap = e.target.closest?.('.js-rowwrap');
    if (wrap) updateArrows(wrap.querySelector('.js-scroller'));
  }, { passive: true });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.js-arrow');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const sc = btn.parentElement.querySelector('.js-scroller');
    sc.scrollBy({ left: (btn.classList.contains('js-prev') ? -1 : 1) * sc.clientWidth * 0.85, behavior: 'smooth' });
  }, true);
  // Shift + mouse wheel scrolls a row sideways (trackpads scroll sideways on their own)
  document.addEventListener('wheel', (e) => {
    const sc = e.target.closest?.('.js-scroller');
    if (!sc || !e.shiftKey || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    sc.scrollBy({ left: e.deltaY, behavior: 'auto' });
    e.preventDefault();
  }, { passive: false });

  // ---------------------------------------------------------------- config
  const loadConfig = async (force) => {
    if (!force && state.cfg && Date.now() - state.cfgAt < 10 * 60 * 1000) return state.cfg;
    try {
      state.cfg = await getJSON('Config');
      state.cfgAt = Date.now();
      document.documentElement.classList.toggle('js-lite', lite());
    } catch {
      state.cfg = state.cfg || null;
    }
    return state.cfg;
  };

  // accent color from the logo, when none is set
  const autoAccent = (svc) => new Promise((res) => {
    if (svc.Accent) return res(svc.Accent);
    if (state.accents.has(svc.Key)) return res(state.accents.get(svc.Key));
    if (!svc.Logo) return res('');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 16, 16);
        const d = x.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
          if (max - min < 40 || max < 50) continue; // skip greys, black and white
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        const col = n ? `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})` : '';
        state.accents.set(svc.Key, col);
        res(col);
      } catch { res(''); }
    };
    img.onerror = () => res('');
    img.src = svc.Logo;
  });

  // ---------------------------------------------------------------- home row
  const homeSections = () => {
    const tab = document.querySelector('#homeTab');
    const root = tab && visible(tab) ? tab : [...document.querySelectorAll('.homePage, #indexPage')].find(visible);
    return root?.querySelector('.sections') || null;
  };

  const renderHomeRow = (sections) => {
    const cfg = state.cfg;
    let row = sections.querySelector(':scope > .js-services');
    if (!cfg?.ShowHomeRow || !cfg.Services.length) { row?.remove(); return; }
    if (row && row.dataset.v === String(state.cfgAt)) {
      // keep it in place if Jellyfin re-ordered the sections
      const want = cfg.HomeRowPosition === 'bottom' ? sections.lastElementChild : sections.firstElementChild;
      if (want !== row) cfg.HomeRowPosition === 'bottom' ? sections.appendChild(row) : sections.prepend(row);
      return;
    }
    row?.remove();

    const tiles = cfg.Services.map((s) => {
      const n = s.Movies + s.Shows;
      const known = brandKeyFor(s);
      const b = known ? BRANDS[known] : null;
      const t1 = s.Accent || (b && b.c1 !== '#ffffff' && b.c1 !== '#f9f9f9' && b.c1 !== '#f5f5f7' ? b.c1 : b?.c2) || '';
      const t2 = b ? b.c2 : '';
      const style = [t1 && `--js-t1:${t1}`, t2 && `--js-t2:${t2}`].filter(Boolean).join(';');
      return `
      <div class="card overflowBackdropCard card-hoverable js-svc-card" data-jskey="${esc(s.Key)}" style="${esc(style)}">
        <div class="cardBox">
          <div class="cardScalable">
            <div class="cardPadder cardPadder-overflowBackdrop"></div>
            <a class="cardImageContainer cardContent itemAction" href="#/home?${PARAM}=${encodeURIComponent(s.Key)}" aria-label="${esc(s.Name)}">
              <span class="js-tile-bg"></span>
              <span class="js-tile-tint"></span>
              <span class="js-tile-sheen"></span>
              <span class="js-tile-info">
                ${s.Logo ? `<img class="js-tile-logo js-logo" src="${esc(s.Logo)}" alt="" loading="lazy">` : ''}
                <span class="js-tile-text">
                  <b>${esc(s.Name)}</b>
                  <small class="js-tile-sub">${n ? `${n} title${n === 1 ? '' : 's'} in your library` : 'Browse'}</small>
                </span>
              </span>
            </a>
          </div>
        </div>
      </div>`;
    });

    const wrap = document.createElement('div');
    wrap.innerHTML = section({ title: cfg.HomeRowTitle || 'Streaming services', cards: tiles, cls: 'js-services' });
    row = wrap.firstElementChild;
    row.dataset.v = String(state.cfgAt);
    if (cfg.HomeRowPosition === 'bottom') sections.appendChild(row); else sections.prepend(row);
    stubRows(row);
    requestAnimationFrame(() => updateAllArrows(row));

    cfg.Services.forEach((s) => {
      if (s.Accent || brandKeyFor(s)) return;
      autoAccent(s).then((col) => {
        const tile = row.querySelector(`[data-jskey="${CSS.escape(s.Key)}"]`);
        if (col && tile) { tile.style.setProperty('--js-t1', col); tile.style.setProperty('--js-t2', '#15171d'); }
      });
    });
    loadFeatured().then((map) => {
      for (const [key, f] of Object.entries(map || {})) {
        const tile = row.querySelector(`[data-jskey="${CSS.escape(key)}"]`);
        const bg = tile?.querySelector('.js-tile-bg');
        if (!bg || !f?.Backdrop) continue;
        const img = new Image();
        img.onload = () => { bg.style.backgroundImage = `url("${f.Backdrop}")`; bg.classList.add('on'); };
        img.src = f.Backdrop;
        const sub = tile.querySelector('.js-tile-sub');
        if (sub && f.Name) sub.innerHTML = `<span class="js-tile-dot"></span>${esc(f.Name)}`;
      }
    });
  };

  // what's trending on each service, for the tile backdrops (cached for half an hour)
  const loadFeatured = async () => {
    if (state.featured && Date.now() - state.featuredAt < 30 * 60 * 1000) return state.featured;
    try {
      state.featured = await getJSON('Services/Featured');
      state.featuredAt = Date.now();
    } catch {
      state.featured = state.featured || {};
    }
    return state.featured;
  };

  // ---------------------------------------------------------------- service page
  const groupByGenre = (items, max) => {
    const counts = new Map();
    for (const it of items) for (const g of it.Genres || []) counts.set(g, (counts.get(g) || 0) + 1);
    return [...counts.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([g]) => ({
        genre: g,
        items: items.filter((it) => (it.Genres || []).includes(g))
          .sort((a, b) => (b.Rating || 0) - (a.Rating || 0))
          .slice(0, 40),
      }));
  };

  const loadService = async (svc) => {
    const cfg = state.cfg;
    const cached = state.data.get(svc.Key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached;

    const safe = (p) => p.catch(() => []);
    const [topMovies, topShows, library, missMovies, missShows, resume] = await Promise.all([
      safe(getJSON(`Services/${encodeURIComponent(svc.Key)}/Top?type=movie`)),
      safe(getJSON(`Services/${encodeURIComponent(svc.Key)}/Top?type=tv`)),
      safe(getJSON(`Services/${encodeURIComponent(svc.Key)}/Library?type=all`)),
      cfg.ShowPopularMissing ? safe(getJSON(`Services/${encodeURIComponent(svc.Key)}/Missing?type=movie&limit=20`)) : [],
      cfg.ShowPopularMissing ? safe(getJSON(`Services/${encodeURIComponent(svc.Key)}/Missing?type=tv&limit=20`)) : [],
      cfg.ShowContinueWatching
        ? safe(window.ApiClient.getResumableItems(userId(), { Limit: 40, Recursive: true, Fields: 'PrimaryImageAspectRatio', EnableImageTypes: 'Primary', MediaTypes: 'Video' }).then((r) => r.Items || []))
        : [],
    ]);
    const data = { at: Date.now(), topMovies, topShows, library, missMovies, missShows, resume };
    state.data.set(svc.Key, data);
    return data;
  };

  const renderService = async (sections, key) => {
    const cfg = state.cfg;
    const svc = cfg?.Services.find((s) => s.Key === key);
    sections.classList.add('js-hide-native');
    let view = sections.querySelector(':scope > .js-view');
    if (view && view.dataset.key === key) return;
    view?.remove();

    view = document.createElement('div');
    view.className = state.vt ? 'js-view' : 'js-view js-anim';
    view.dataset.key = key;
    sections.appendChild(view);

    if (!svc) {
      view.innerHTML = `<div class="js-empty">This service isn't available. <a href="#/home">Back to Home</a></div>`;
      return;
    }

    const n = svc.Movies + svc.Shows;
    view.innerHTML = `
      <div class="js-hero">
        ${svc.Logo ? `<img src="${esc(svc.Logo)}" alt="">` : ''}
        <div>
          <div class="js-eyebrow">Streaming on</div>
          <h1>${esc(svc.Name)}</h1>
          <div class="js-stats">${svc.Movies} movie${svc.Movies === 1 ? '' : 's'} · ${svc.Shows} show${svc.Shows === 1 ? '' : 's'} in your library</div>
        </div>
        <button type="button" class="js-back">Back to Home</button>
      </div>
      <div class="js-rows"><div class="js-empty">Loading…</div></div>`;
    autoAccent(svc).then((col) => col && view.style.setProperty('--js-accent', col));

    const data = await loadService(svc);
    if (!view.isConnected) return;

    const onService = new Set(data.library.map((i) => i.Id.replace(/-/g, '').toLowerCase()));
    const movies = data.library.filter((i) => i.Type === 'movie');
    const shows = data.library.filter((i) => i.Type === 'tv');
    const when = cfg.TopSource === 'day' ? 'Trending today on' : cfg.TopSource === 'week' ? 'Trending this week on' : 'Popular on';
    const span = cfg.TopSource === 'day' ? 'Today' : cfg.TopSource === 'week' ? 'This Week' : '';
    const rows = [];

    // Home + all services, so a remote can switch or leave without a Back key
    const sw = (href, name, inner, current) => `
      <div class="card js-sw-card${current ? ' js-current' : ''}">
        <div class="cardBox">
          <div class="cardScalable">
            <div class="cardPadder"></div>
            <a class="cardImageContainer cardContent itemAction" href="${esc(href)}" aria-label="${esc(name)}">${inner}</a>
          </div>
          <div class="cardFooter"><div class="cardText cardTextCentered cardText-first"><bdi>${esc(name)}</bdi></div></div>
        </div>
      </div>`;
    rows.push(section({
      title: 'Services',
      cls: 'js-switcher',
      cards: [sw('#/home', 'Home', '<span class="material-icons">home</span>', false)].concat(cfg.Services.map((x) =>
        sw(`#/home?${PARAM}=${encodeURIComponent(x.Key)}`, x.Name,
          x.Logo ? `<img src="${esc(x.Logo)}" alt="" loading="lazy">` : `<span class="js-logo-text">${esc(x.Name)}</span>`,
          x.Key === svc.Key))),
    }));

    rows.push(section({ title: `Top ${cfg.TopCount} Movies ${span}`.trim(), cards: data.topMovies.map(rankCard), cls: 'js-top' }));
    rows.push(section({ title: `Top ${cfg.TopCount} Shows ${span}`.trim(), cards: data.topShows.map(rankCard), cls: 'js-top' }));

    if (cfg.ShowContinueWatching) {
      const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();
      const resume = data.resume.filter((it) => onService.has(norm(it.Id)) || onService.has(norm(it.SeriesId)));
      rows.push(section({
        title: 'Continue Watching',
        cards: resume.map((it) => card({
          id: it.Id,
          name: it.SeriesName || it.Name,
          sub: it.SeriesName ? `S${it.ParentIndexNumber ?? '?'}:E${it.IndexNumber ?? '?'} · ${it.Name}` : (it.ProductionYear || ''),
          img: imgUrl(it.SeriesId || it.Id),
          href: detailsHref(it.Id),
          type: it.Type,
        })),
      }));
    }

    if (cfg.ShowRecentlyAdded) {
      rows.push(section({ title: `Recently Added on ${svc.Name}`, cards: data.library.slice(0, 24).map(libraryCard) }));
    }

    for (const g of groupByGenre(movies, cfg.GenreRows)) {
      rows.push(section({ title: `${g.genre} Movies`, cards: g.items.map(libraryCard) }));
    }
    if (movies.length) {
      const az = [...movies].sort((a, b) => a.Name.localeCompare(b.Name)).slice(0, 120);
      rows.push(section({ title: `All Movies (${movies.length})`, cards: az.map(libraryCard) }));
    }

    for (const g of groupByGenre(shows, cfg.GenreRows)) {
      rows.push(section({ title: `${g.genre} Shows`, cards: g.items.map(libraryCard) }));
    }
    if (shows.length) {
      const az = [...shows].sort((a, b) => a.Name.localeCompare(b.Name)).slice(0, 120);
      rows.push(section({ title: `All Shows (${shows.length})`, cards: az.map(libraryCard) }));
    }

    if (cfg.ShowPopularMissing) {
      rows.push(section({ title: 'Popular Movies to Request', cards: data.missMovies.map((t) => titleCard(t, true)) }));
      rows.push(section({ title: 'Popular Shows to Request', cards: data.missShows.map((t) => titleCard(t, true)) }));
    }

    const html = rows.join('');
    renderBillboard(view, svc, data);
    const box = view.querySelector('.js-rows');
    box.innerHTML = html || `<div class="js-empty">Nothing from ${esc(svc.Name)} yet. If you just set JellyStream up, run the sync from its settings page.</div>`;
    lazy(box);
    stubRows(box);
    requestAnimationFrame(() => updateAllArrows(box));
    setTimeout(() => updateAllArrows(box), 600); // after the Top 10 numbers resize their cards
  };

  // the #1 title on the service, presented the way that service's app does
  const renderBillboard = (view, svc, data) => {
    const hero = view.querySelector('.js-hero');
    if (!hero || view.querySelector('.js-bb')) return;
    const l = look();
    const pick = [data.topShows[0], data.topMovies[0]].filter(Boolean)
      .sort((a, b) => (b.ItemId ? 1 : 0) - (a.ItemId ? 1 : 0))[0] || data.topMovies[0] || data.topShows[0];
    const bb = document.createElement('section');
    bb.className = 'js-bb';
    if (!pick) {
      bb.innerHTML = `<div class="js-bb-shade"></div>`;
      bb.style.height = '9em';
      bb.style.minHeight = '0';
    } else {
      const isTv = pick.Type === 'tv';
      const rank = data.topShows[0] === pick ? 'TV Shows' : 'Movies';
      const when = state.cfg.TopSource === 'day' ? 'Today' : state.cfg.TopSource === 'week' ? 'This Week' : '';
      const owned = !!pick.ItemId;
      bb.innerHTML = `
        <div class="js-bb-art"></div>
        <div class="js-bb-shade"></div>
        <div class="js-bb-content">
          <div class="js-bb-tag">${esc(isTv ? l.labels.tagTv : l.labels.tagMovie)}</div>
          <h2 class="js-bb-title">${esc(pick.Name)}</h2>
          <div class="js-bb-rank">#1 in ${rank}${when ? ` ${when}` : ''}</div>
          <p class="js-bb-overview"></p>
          <div class="js-bb-actions">
            ${owned
              ? `<a class="js-bb-btn js-primary" href="${esc(detailsHref(pick.ItemId))}" data-id="${esc(pick.ItemId)}"><span class="material-icons">play_arrow</span>${esc(l.labels.play)}</a>`
              : `<button type="button" class="js-bb-btn js-primary js-bb-request" data-jstmdb="${pick.TmdbId}" data-jstype="${pick.Type}"><span class="material-icons">add</span>${esc(l.labels.request)}</button>`}
            ${owned && l.labels.info
              ? `<a class="js-bb-btn js-secondary" href="${esc(detailsHref(pick.ItemId))}" data-id="${esc(pick.ItemId)}"><span class="material-icons">info_outline</span>${esc(l.labels.info)}</a>`
              : owned ? `<a class="js-bb-btn js-secondary" href="${esc(detailsHref(pick.ItemId))}" data-id="${esc(pick.ItemId)}" aria-label="Details"><span class="material-icons">add</span></a>` : ''}
          </div>
        </div>`;
      const art = bb.querySelector('.js-bb-art');
      const big = (pick.Backdrop || '').replace('/w780/', '/w1280/');
      if (big) {
        const img = new Image();
        img.onload = () => { art.style.backgroundImage = `url("${big}")`; art.classList.add('on'); };
        img.src = big;
      }
      getJSON(`Details?type=${pick.Type}&tmdbId=${pick.TmdbId}`).then((d) => {
        const p = bb.querySelector('.js-bb-overview');
        if (p && d?.Overview) p.textContent = d.Overview;
      }).catch(() => {});
    }
    hero.replaceWith(bb);
    bb.appendChild(hero); // the service chip (logo, name, Back) sits in the corner
  };

  // remove every trace of a service page (used when leaving the home screen)
  const teardown = () => {
    const html = document.documentElement;
    if (!html.classList.contains('js-service-open') && !document.querySelector('.js-view')) return;
    html.classList.remove('js-service-open');
    document.querySelectorAll('.js-view').forEach((v) => v.remove());
    document.querySelectorAll('.js-hide-native').forEach((el) => el.classList.remove('js-hide-native'));
    state.brandKey = null;
    applyBrand(null);
  };

  const closeService = (sections) => {
    sections?.classList.remove('js-hide-native');
    sections?.querySelector(':scope > .js-view')?.remove();
  };

  // ---------------------------------------------------------------- requests
  const armed = new WeakMap();
  const request = async (cardEl) => {
    const cfg = state.cfg;
    const status = cardEl.dataset.jsstatus;
    const name = cardEl.querySelector('.cardText-first')?.textContent.trim() || 'This title';
    if (status === 'requested') { toast(`${name} is already requested`); return; }
    if (!cfg?.AllowRequests) { toast(`${name} isn't in your library`); return; }

    if (cfg.ConfirmRequests && !armed.get(cardEl)) {
      const badge = cardEl.querySelector('.js-badge');
      armed.set(cardEl, setTimeout(() => {
        armed.delete(cardEl);
        badge?.classList.remove('js-armed');
        if (badge) badge.innerHTML = '<span class="material-icons">add</span>';
      }, 3500));
      badge?.classList.add('js-armed');
      if (badge) badge.textContent = 'Press again to request';
      return;
    }
    clearTimeout(armed.get(cardEl));
    armed.delete(cardEl);

    try {
      const res = await window.ApiClient.ajax({
        type: 'POST',
        url: api('Request'),
        data: JSON.stringify({ Type: cardEl.dataset.jstype, TmdbId: +cardEl.dataset.jstmdb }),
        contentType: 'application/json',
        dataType: 'json',
      });
      if (res?.Ok) {
        cardEl.dataset.jsstatus = 'requested';
        const badge = cardEl.querySelector('.js-badge');
        if (badge) badge.outerHTML = BADGES.requested;
        toast(`${res.Message === 'Requested' ? 'Requested' : res.Message}: ${name}`);
        state.data.clear();
      } else {
        toast(res?.Message || 'Request failed');
      }
    } catch {
      toast('Request failed');
    }
  };

  // open a title the way Jellyfin's own cards do (its router), falling back to the link
  const openDetails = (href) => {
    teardown();
    const before = location.href;
    try {
      if (window.Emby?.Page?.show) window.Emby.Page.show(href);
      else location.hash = href;
    } catch {
      location.hash = href;
    }
    // if the router didn't move (it can be waiting on an earlier navigation), use the link itself
    setTimeout(() => { if (location.href === before) location.hash = href; }, 450);
  };

  // clicks: service tiles, back button, and titles you don't have
  document.addEventListener('click', (e) => {
    const bbLink = e.target.closest?.('.js-bb a.js-bb-btn[data-id]');
    if (bbLink) {
      e.preventDefault();
      e.stopPropagation();
      openDetails(bbLink.getAttribute('href'), bbLink);
      return;
    }
    const bbReq = e.target.closest?.('.js-bb-request');
    if (bbReq) {
      e.preventDefault();
      e.stopPropagation();
      const fake = document.createElement('div');
      fake.dataset.jstmdb = bbReq.dataset.jstmdb;
      fake.dataset.jstype = bbReq.dataset.jstype;
      fake.dataset.jsstatus = 'missing';
      fake.innerHTML = `<div class="cardText-first">${esc(bbReq.closest('.js-bb').querySelector('.js-bb-title')?.textContent || '')}</div>`;
      request(fake).then(() => { if (fake.dataset.jsstatus === 'requested') bbReq.innerHTML = '<span class="material-icons">schedule</span>Requested'; });
      return;
    }
    const link = e.target.closest?.('.js-view a.cardImageContainer[href^="#/details"]');
    if (link && !e.target.closest('.jst-x') && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      document.documentElement.classList.remove('js-service-open');
      openDetails(link.getAttribute('href'), link.closest('.card'));
      return;
    }
    const missing = e.target.closest?.('.js-missing');
    if (missing && !e.target.closest('.jst-x')) {
      e.preventDefault();
      e.stopPropagation();
      request(missing);
      return;
    }
  }, true);

  // ---------------------------------------------------------------- top 10 styling (built in)
  let themeLoaded = false;
  const loadTheme = () => {
    if (themeLoaded) return;
    themeLoaded = true;
    for (const name of ['top10', 'header', lite() ? 'expandlite' : 'expand']) {
      const el = document.createElement('script');
      el.src = api(`theme/${name}.js`);
      el.defer = true;
      document.head.appendChild(el);
    }
  };

  // ---------------------------------------------------------------- page transitions
  // Opening a service morphs its logo from the tile into the page header (View Transitions),
  // everything else cross-fades. Lite mode and older browsers just slide the page in.
  const canMorph = () => typeof document.startViewTransition === 'function' && !lite();
  const waitFor = (test, ms = 1200) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (test() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
    tick();
  });
  const clearNames = () => document.querySelectorAll('.js-logo, .js-hero img').forEach((el) => { el.style.viewTransitionName = ''; });

  const navigate = (to) => {
    if (to.back) history.back();
    else if (to.replace) location.replace(to.href);
    else location.hash = to.href;
  };

  // to: { href, key (service opening, or null for home), from (element to morph), fromKey (service being left), back, replace }
  const go = (to) => {
    if (!canMorph()) { navigate(to); return; }
    clearNames();
    if (to.from) to.from.style.viewTransitionName = 'js-logo';
    state.vt = true;
    const t = document.startViewTransition(async () => {
      if (to.from) to.from.style.viewTransitionName = '';
      navigate(to);
      await new Promise((r) => setTimeout(r, 0));
      await sync();
      await waitFor(() => to.key
        ? document.querySelector(`.js-view[data-key="${CSS.escape(to.key)}"] .js-hero`)
        : document.querySelector('.js-services') && !document.querySelector('.js-view'));
      const target = to.key
        ? document.querySelector('.js-view .js-hero img')
        : to.fromKey && document.querySelector(`.js-services [data-jskey="${CSS.escape(to.fromKey)}"] .js-logo`);
      if (target && to.from) target.style.viewTransitionName = 'js-logo';
    });
    t.finished.finally(() => { state.vt = false; clearNames(); });
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('.js-svc-card a, .js-switcher a, .js-back');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const current = serviceKey();
    const heroImg = document.querySelector('.js-view .js-hero img');

    if (a.classList.contains('js-back') || a.getAttribute('href') === '#/home') {
      go({ href: '#/home', key: null, from: heroImg, fromKey: current, back: state.cameFromHome });
      state.cameFromHome = false;
      return;
    }
    const key = new URLSearchParams(a.getAttribute('href').split('?')[1] || '').get(PARAM);
    if (!key || key === current) return;
    if (current) {
      // switching services: replace, so Back still goes home
      go({ href: a.getAttribute('href'), key, from: null, replace: true });
    } else {
      state.cameFromHome = true;
      go({ href: a.getAttribute('href'), key, from: a.querySelector('.js-logo') });
    }
  }, true);

  // ---------------------------------------------------------------- main loop
  let busy = false;
  const sync = async () => {
    if (busy || !window.ApiClient || !userId()) return;
    const h = location.hash || '';
    if (!/^#!?\/home/i.test(h) && h !== '' && h !== '#/') {
      teardown();
      return;
    }
    const sections = homeSections();
    if (!sections) return;

    busy = true;
    try {
      await loadConfig();
      if (!state.cfg) return;
      const key = serviceKey();
      document.documentElement.classList.toggle('js-service-open', !!key);
      const svc = key ? state.cfg.Services.find((x) => x.Key === key) : null;
      if ((svc?.Key || null) !== state.brandKey) {
        state.brandKey = svc?.Key || null;
        applyBrand(svc);
      }
      if (key) {
        sections.querySelector(':scope > .js-services')?.remove();
        await renderService(sections, key);
      } else {
        closeService(sections);
        renderHomeRow(sections);
      }
    } finally {
      busy = false;
    }
  };

  // The home screen re-renders its sections often; a light timer keeps the row/page in place.
  addEventListener('hashchange', () => { sync(); setTimeout(sync, 300); });
  addEventListener('popstate', () => setTimeout(sync, 50));
  document.addEventListener('viewshow', () => setTimeout(sync, 50), true);
  setInterval(sync, 700);

  // refresh after settings change in another tab or a sync finishes
  window.JellyStream = {
    refresh: () => { state.cfgAt = 0; state.data.clear(); document.querySelectorAll('.js-services, .js-view').forEach((e) => e.remove()); sync(); },
  };
})();
