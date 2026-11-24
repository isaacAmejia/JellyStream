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
  const VERSION = '1.23.0';

  // ---------------------------------------------------------------- diagnostics
  // Records route changes, Jellyfin's page events, its router/view logs, errors from any script, and
  // what is actually on screen. Kept across reloads for this tab (sessionStorage). The panel to read,
  // copy or send it shows when "Show the diagnostics panel" is on in the plugin settings (or
  // localStorage 'jellystream-debug' = '1').
  const diag = (() => {
    const KEY = 'jellystream-diag';
    let buf = [];
    try { buf = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { buf = []; }
    let saveTimer;
    let onAdd = null;
    const t0 = Date.now();
    const text = (v) => {
      if (v == null) return String(v);
      if (typeof v === 'string') return v;
      if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
      if (v instanceof Element) return describe(v);
      try {
        const seen = new WeakSet();
        return JSON.stringify(v, (k, x) => {
          if (x && typeof x === 'object') {
            if (seen.has(x)) return '[circular]';
            seen.add(x);
            if (x instanceof Element) return describe(x);
          }
          return typeof x === 'function' ? '[fn]' : x;
        });
      } catch { return String(v); }
    };
    const add = (kind, ...args) => {
      const m = args.map(text).join(' ').slice(0, 900);
      buf.push({ t: Date.now(), k: kind, m });
      if (buf.length > 700) buf = buf.slice(-500);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { try { sessionStorage.setItem(KEY, JSON.stringify(buf.slice(-500))); } catch { /* full */ } }, 200);
      onAdd?.();
    };
    const describe = (el) => {
      if (!el || !el.tagName) return String(el);
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.');
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
    };
    const hidden = (el) => el.classList.contains('hide') || getComputedStyle(el).display === 'none';
    // what is on screen right now
    const snapshot = (why) => {
      const pages = [...document.querySelectorAll('.mainAnimatedPages > *, .skinBody > *')]
        .map((p) => `${describe(p)}${p.dataset?.url ? `[${p.dataset.url}]` : ''}${hidden(p) ? ' (hidden)' : ' (SHOWN)'}`);
      const stack = [];
      for (let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); el && stack.length < 6; el = el.parentElement) stack.push(describe(el));
      const router = window.Emby?.Page;
      add('snap', why, {
        hash: location.hash,
        state: history.state,
        html: document.documentElement.className,
        pages,
        centre: stack.join(' < '),
        jellystream: { view: !!document.querySelector('.js-view'), open: document.documentElement.classList.contains('js-service-open'), intro: !!document.querySelector('.js-intro') },
        routerPending: !!router?.promiseShow,
        scrollY: Math.round(scrollY),
      });
      rowReport();
    };
    // the first Top 10 row on a service page: sizes and the inline styles/variables behind them
    const rowReport = () => {
      const row = document.querySelector('.js-view .js-rank-card')?.parentElement;
      if (!row) return;
      const css = (el, v) => getComputedStyle(el).getPropertyValue(v).trim();
      const sc = row.closest('.js-scroller');
      add('snap', 'top 10 row', {
        version: VERSION,
        viewport: `${innerWidth}x${innerHeight} dpr ${devicePixelRatio}`,
        html: document.documentElement.className,
        brand: document.documentElement.dataset.jsBrand,
        vars: ['--js-poster-w', '--js-rank-cw', '--js-rank-pw', '--js-rank-ph', '--js-port-w'].map((v) => `${v}=${css(row, v)}`).join(' '),
        scroller: sc ? `${describe(sc)} w=${Math.round(sc.clientWidth)} sw=${sc.scrollWidth} sl=${Math.round(sc.scrollLeft)} ${getComputedStyle(sc).overflowX}` : 'none',
        row: `${describe(row)} display=${getComputedStyle(row).display} w=${Math.round(row.getBoundingClientRect().width)}`,
        cards: [...row.children].slice(0, 12).map((c) => {
          const r = c.getBoundingClientRect();
          const cs = getComputedStyle(c);
          return `${describe(c)} x=${Math.round(r.left)} w=${Math.round(r.width)} cw=${cs.width} min=${cs.minWidth} max=${cs.maxWidth} flex=${cs.flex} inline="${(c.getAttribute('style') || '').slice(0, 260)}"`;
        }),
        scripts: [...document.scripts].map((x) => x.src.split('/').slice(-2).join('/')).filter(Boolean).slice(-25),
      });
    };
    // other scripts' errors and Jellyfin's router/view logging
    addEventListener('error', (e) => {
      if (e.target && e.target !== window && e.target.tagName) add('error', 'failed to load', describe(e.target), e.target.src || e.target.href || '');
      else add('error', e.message, `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`, e.error?.stack || '');
    }, true);
    addEventListener('unhandledrejection', (e) => add('error', 'unhandled rejection:', e.reason));
    const INTERESTING = /viewContainer|ViewManager|viewManager|AppRouter|appRouter|RouterHistory|itemDetails|ConnectionRequired|LayoutManager|homesections|Router/i;
    for (const level of ['error', 'warn', 'info', 'log', 'debug']) {
      const orig = console[level]?.bind(console);
      if (!orig) continue;
      console[level] = (...args) => {
        try {
          const first = typeof args[0] === 'string' ? args[0] : '';
          if (first.includes('[RouterHistory]')) {
            const st = args[1] || {};
            add('router', 'history update', st.historyAction, `${st.location?.pathname || ''}${st.location?.search || ''}`, 'navigation:', st.navigation?.state, st.errors ? ['errors', st.errors] : '');
          } else if (level === 'error' || level === 'warn' || INTERESTING.test(first)) {
            if (!first.startsWith('[JellyStream diag]')) add(level === 'error' || level === 'warn' ? level : 'jf', ...args);
          }
        } catch { /* never break logging */ }
        return orig(...args);
      };
    }
    for (const fn of ['pushState', 'replaceState']) {
      const orig = history[fn].bind(history);
      history[fn] = (st, title, url) => {
        add('history', fn, url ?? '(same url)', st);
        return orig(st, title, url);
      };
    }
    addEventListener('hashchange', () => { add('nav', 'hashchange ->', location.hash); setTimeout(() => snapshot('after hashchange'), 400); });
    addEventListener('popstate', (e) => add('nav', 'popstate ->', location.hash, e.state));
    for (const ev of ['viewbeforeshow', 'viewshow', 'viewbeforehide', 'viewhide', 'viewdestroy']) {
      document.addEventListener(ev, (e) => {
        add('view', ev, describe(e.target), e.detail?.params || '');
        if (ev === 'viewshow') setTimeout(() => snapshot('after viewshow'), 300);
      }, true);
    }
    add('load', `--- page loaded (client ${VERSION}) ---`, location.href, navigator.userAgent);
    return {
      add, snapshot, describe,
      dump: () => buf.map((e) => `${new Date(e.t).toISOString().slice(11, 23)} +${((e.t - t0) / 1000).toFixed(2)}s [${e.k}] ${e.m}`).join('\n'),
      clear: () => { buf = []; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } onAdd?.(); },
      set onAdd(fn) { onAdd = fn; },
    };
  })();
  const FONT = '"Manrope", "SF Pro Display", "Inter", system-ui, sans-serif';

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (path) => window.ApiClient.getUrl('JellyStream/' + path);
  const getJSON = (path) => window.ApiClient.getJSON(api(path));
  const userId = () => window.ApiClient?.getCurrentUserId?.();
  const serverId = () => window.ApiClient?.serverId?.() || '';
  const visible = (el) => !!el && el.offsetParent !== null && !el.closest('.hide');
  // Service pages live inside Jellyfin's own home screen and are kept in the browser history entry's
  // state, not in the route. Changing the route (#/home?jellystream=...) made Jellyfin's classic layout
  // build a second, hidden copy of the home screen for every service, and opening a title from that
  // copy is what left people on a stale home screen. Old #/home?jellystream= links still work.
  const onHome = () => {
    const h = location.hash || '';
    return h === '' || h === '#/' || /^#!?\/home(\.html)?(?:[?/]|$)/i.test(h);
  };
  const serviceKey = () => {
    if (!onHome()) return null;
    const st = history.state;
    if (st && typeof st === 'object' && 'jellystream' in st) return st.jellystream || null;
    return new URLSearchParams((location.hash || '').split('?')[1] || '').get(PARAM);
  };

  // Jellyfin itself counts as the main streaming service: a pill of its own, an intro of its own,
  // and the Home tab opens whichever one (a service or Jellyfin) you picked last on this device
  // the Jellyfin icon (jellyfin-ux icon-transparent): outer arch + inner triangle, purple to blue.
  // Each shape gets its own gradient (iPhones dropped the inner one when they shared it).
  const JF_OUT = 'M256,23.3c-61.56,0-259.82,359.43-229.59,420.1s429.34,60,459.24,0S317.61,23.3,256,23.3ZM406.51,390.76c-19.59,39.33-281.08,39.77-300.89,0S215.71,115.48,256.06,115.48,426.1,351.42,406.51,390.76Z';
  const JF_IN = 'M256,201.62c-20.44,0-86.23,119.29-76.2,139.43s142.48,19.92,152.4,0S276.47,201.63,256,201.62Z';
  let jfSeq = 0;
  const jfSvg = (cls = '', bg = true) => {
    const id = `jsjf${++jfSeq}`;
    const grad = (n) => `<linearGradient id="${id}${n}" x1="110.25" y1="213.3" x2="496.14" y2="436.09" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#aa5cc3"/><stop offset="1" stop-color="#00a4dc"/></linearGradient>`;
    return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="${bg ? '-80 -70 672 672' : '0 0 512 512'}" aria-hidden="true"><defs>${grad('a')}${grad('b')}</defs>`
      + (bg ? '<circle cx="256" cy="266" r="336" fill="#101018"/>' : '')
      + `<path class="jf-out" fill-rule="evenodd" fill="url(#${id}a)" stroke="url(#${id}a)" stroke-width="0" pathLength="1" d="${JF_OUT}"/>`
      + `<path class="jf-in" fill="url(#${id}b)" d="${JF_IN}"/></svg>`;
  };
  const JF_LOGO = 'data:image/svg+xml,' + encodeURIComponent(jfSvg().replace(/jsjf\d+/g, 'g'));
  const jellyfin = () => ({
    Key: 'jellyfin', Name: 'Jellyfin', Logo: JF_LOGO, Accent: '#00a4dc', Movies: 0, Shows: 0,
    IntroVersion: state.cfg?.JellyfinIntroVersion || null, MobileIntroVersion: state.cfg?.JellyfinMobileIntroVersion || null,
  });
  const lastKey = () => `jellystream:last:${userId() || ''}`;
  const getLast = () => { try { return localStorage.getItem(lastKey()) || 'jellyfin'; } catch { return 'jellyfin'; } };
  const setLast = (k) => { try { localStorage.setItem(lastKey(), k || 'jellyfin'); } catch { /* private mode */ } };

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
      // TV: deep navy that lightens toward the bottom; phones: black
      base: '#11142a', bg: 'linear-gradient(180deg, #0e1121 0%, #131730 40%, #1b1f43 100%)',
      basePhone: '#000', bgPhone: '#000',
      shape: 'portrait', caption: 'none',
      focusExpand: true, badges: true, headerMark: true,
      nav: 'top', tabs: ['Home', 'Shows', 'Movies'],
      font: '"Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
      labels: { tagMovie: 'Movie', tagTv: 'Show', play: 'Play', info: 'More Info', request: 'Request' },
      css: `
        .js-bb { height: min(60vh, 640px) !important; min-height: 300px; margin: .4em 3.3% 1.4em !important; border-radius: 18px; overflow: hidden; box-shadow: 0 0 0 2px rgba(255,255,255,.14), 0 24px 50px rgba(0,0,0,.45); transition: box-shadow .2s ease; }
        .js-bb:is(:hover, :focus-within) { box-shadow: 0 0 0 3px #fff, 0 24px 50px rgba(0,0,0,.5); }
        .js-bb-shade { background: linear-gradient(0deg, rgba(8,10,22,.92) 0%, rgba(8,10,22,.35) 38%, transparent 60%), linear-gradient(90deg, rgba(8,10,22,.7) 0%, transparent 55%) !important; }
        .js-bb-content { left: 4% !important; bottom: 9% !important; gap: .6em !important; }
        .js-bb-tag { color: #fff; font-weight: 700; font-size: .95em; letter-spacing: 0; }
        .js-bb-tag::before { content: "N"; color: #e50914; font-weight: 900; font-size: 1.6em; margin-right: .35em; vertical-align: -.18em; }
        .js-bb-title { font-weight: 900 !important; letter-spacing: -.01em; text-shadow: 0 4px 30px rgba(0,0,0,.6); }
        .js-bb-rank::before { content: "TOP\\A 10"; white-space: pre; display: inline-flex; align-items: center; justify-content: center; text-align: center; width: 2.2em; height: 2.2em; font-size: .62em; line-height: .95; font-weight: 900; background: #e50914; color: #fff; border-radius: 3px; margin-right: .6em; vertical-align: middle; }
        .js-bb-overview { -webkit-line-clamp: 2 !important; font-size: 1em !important; }
        .js-bb-btn { border-radius: 999px !important; font-weight: 700 !important; padding: .5em 1.5em !important; height: 2.6em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #000 !important; }
        .js-bb-btn.js-secondary { background: rgba(255,255,255,.2) !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 700 !important; font-size: 1.35em !important; color: #fff !important; letter-spacing: -.005em; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 8px !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: none !important; }
        .js-view .jst-shade { opacity: 0 !important; }
        .js-view .jst-feature::before { background: transparent !important; border: none !important; box-shadow: none !important; }
        .js-view .jst-t10 { background: none !important; -webkit-text-fill-color: #e50914 !important; filter: none !important; }`,
    },
    disney: {
      // the 2025 Disney+ app: slate-blue TV pages under a full-bleed banner, near-black on phones
      c1: '#f9f9f9', c2: '#0063e5', num: 'wedge',
      base: '#1b1f33', bg: 'radial-gradient(120% 45% at 50% 0%, #20307a 0%, transparent 60%), linear-gradient(180deg, #1b1f33 0%, #232843 55%, #2a3051 100%)',
      basePhone: '#16161d', bgPhone: 'radial-gradient(130% 35% at 50% 0%, #2a2440 0%, transparent 70%), #16161d',
      shape: 'portrait', caption: 'none',
      focusExpand: true, badges: true, cardMeta: true, cwLandscape: true, bleed: true, rankGutter: 0.06,
      nav: 'pill', tabs: ['For You', 'Series', 'Movies'],
      font: '"Avenir Next", Avenir, "Nunito Sans", "Inter", sans-serif',
      labels: { tagMovie: '', tagTv: '', play: 'DETAILS', info: null, request: 'REQUEST' },
      css: '',
    },
    max: {
      c1: '#ffffff', c2: '#2b5cff', numA: '#ffffff', numB: '#8aa0ff', num: 'solid',
      base: '#020b2e', bg: 'radial-gradient(120% 60% at 50% -10%, #1238c4 0%, transparent 55%), linear-gradient(180deg, #071a63 0%, #020b2e 45%, #01061a 100%)',
      shape: 'portrait', caption: 'none',
      nav: 'rail', tabs: ['Home', 'Series', 'Movies'],
      font: '"Inter", "Helvetica Neue", Arial, sans-serif',
      labels: { tagMovie: 'MOVIE', tagTv: 'SERIES', play: 'Play', info: 'More Info', request: 'Request' },
      css: `
        .js-bb { height: min(70vh, 740px) !important; }
        .js-bb-shade { background: linear-gradient(0deg, #020b2e 0%, rgba(2,11,46,.6) 30%, transparent 60%), linear-gradient(90deg, rgba(2,11,46,.85) 0%, transparent 55%) !important; }
        .js-bb-tag { color: #fff; letter-spacing: .3em; font-size: .72em; font-weight: 700; opacity: .8; }
        .js-bb-title { font-weight: 800 !important; letter-spacing: -.02em; }
        .js-bb-btn { border-radius: 999px !important; font-weight: 600 !important; padding: .6em 1.8em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #000 !important; }
        .js-bb-btn.js-secondary { background: transparent !important; border: 1.5px solid rgba(255,255,255,.8) !important; color: #fff !important; }
        .js-view .sectionTitle { font-weight: 600 !important; letter-spacing: -.01em; color: #fff !important; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 6px !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 3px #fff, 0 0 34px rgba(43,92,255,.6) !important; }`,
    },
    prime: {
      // the Prime Video TV app: deep navy, a banner that shows whatever's selected, wide titled art
      rankShape: 'landscape',
      c1: '#1a98ff', c2: '#0f79af', num: 'solid',
      base: '#0b1626', bg: 'radial-gradient(110% 60% at 70% 0%, #14305c 0%, transparent 60%), linear-gradient(180deg, #0b1626 0%, #0a1422 60%, #08111d 100%)',
      basePhone: '#000611', bgPhone: '#000611',
      shape: 'landscape', shapePhone: 'portrait', caption: 'none',
      badges: true, heroFollow: true, bleed: true, cwLandscape: true,
      nav: 'top', tabs: ['Home', 'Movies', 'TV Shows'],
      font: '"Amazon Ember", "Helvetica Neue", Arial, sans-serif',
      labels: { tagMovie: 'Included with Prime', tagTv: 'Included with Prime', play: 'Watch now', info: 'More details', request: 'Request' },
      css: '',
    },
    hulu: {
      rankShape: 'landscape',
      c1: '#1ce783', c2: '#0f9d5a', numA: '#1a1d29', numB: '#1ce783', num: 'outline',
      base: '#1a1d29', bg: 'radial-gradient(130% 60% at 50% -5%, #1d3b37 0%, transparent 55%), linear-gradient(180deg, #1a1d29 0%, #14172a 100%)',
      shape: 'landscape', caption: 'below', rankCaption: 'below',
      nav: 'pill', tabs: ['For You', 'Series', 'Movies'],
      font: '"Avenir Next", Avenir, "Nunito Sans", "Inter", sans-serif',
      labels: { tagMovie: 'HULU', tagTv: 'HULU', play: 'PLAY', info: '', request: 'REQUEST' },
      css: `
        .js-bb { height: min(50vh, 520px) !important; margin: 1em 3.3% 1.6em !important; border-radius: 10px; box-shadow: 0 26px 40px -20px rgba(0,0,0,.8), 0 0 0 1px rgba(249,249,249,.1); }
        .js-bb-tag { color: #1ce783; letter-spacing: .08em; font-size: 1.1em; font-weight: 900; text-transform: lowercase; }
        .js-bb-title { font-weight: 700 !important; }
        .js-bb-btn { border-radius: 4px !important; letter-spacing: .15em; text-transform: uppercase; font-weight: 700 !important; padding: .7em 2em !important; }
        .js-bb-btn.js-primary { background: #f9f9f9 !important; color: #0e0b14 !important; }
        .js-bb-btn.js-secondary { width: 2.9em; padding: 0 !important; border-radius: 50% !important; background: rgba(0,0,0,.6) !important; border: 2px solid #f9f9f9 !important; color: #f9f9f9 !important; }
        .js-tab.on { background: #1ce783 !important; color: #0b0c0f !important; }
        .js-view .sectionTitle { font-weight: 600 !important; font-size: 1.2em !important; color: #f9f9f9 !important; }
        .js-view .js-section .sectionTitle::before { display: none !important; }
        .js-view .js-lib .cardImageContainer { border-radius: 8px !important; box-shadow: 0 26px 30px -10px rgba(0,0,0,.69), 0 16px 10px -10px rgba(0,0,0,.73), inset 0 0 0 3px rgba(249,249,249,.1) !important; transition: transform .25s cubic-bezier(.25,.46,.45,.94), box-shadow .25s ease; }
        .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer { transform: scale(1.05); box-shadow: 0 40px 58px -16px rgba(0,0,0,.8), inset 0 0 0 4px #1ce783 !important; }
        .js-view .card:is(:hover,:focus,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: 0 0 0 4px #1ce783, 0 24px 40px rgba(0,0,0,.7) !important; }`,
    },
    apple: {
      rankShape: 'landscape',
      c1: '#f5f5f7', c2: '#86868b', num: 'glass',
      base: '#000', bg: '#000', shape: 'landscape', caption: 'below', rankCaption: 'below',
      nav: 'glass', tabs: ['Home', 'TV Shows', 'Movies'],
      font: '-apple-system, "SF Pro Display", "Inter", "Helvetica Neue", sans-serif',
      labels: { tagMovie: 'Movie', tagTv: 'TV Show', play: 'Play', info: 'Details', request: 'Request' },
      css: `
        .js-bb { height: min(72vh, 760px) !important; }
        .js-bb-shade { background: linear-gradient(0deg, #000 0%, rgba(0,0,0,.55) 28%, transparent 55%), linear-gradient(90deg, rgba(0,0,0,.6) 0%, transparent 50%) !important; }
        .js-bb-tag { color: rgba(255,255,255,.7); font-weight: 600; font-size: .85em; }
        .js-bb-title { font-weight: 700 !important; letter-spacing: -.035em; }
        .js-bb-btn { border-radius: 10px !important; font-weight: 600 !important; padding: .65em 1.9em !important; }
        .js-bb-btn.js-primary { background: #fff !important; color: #000 !important; }
        .js-bb-btn.js-primary { box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 8px 24px rgba(0,0,0,.4); }
        .js-bb-btn.js-secondary { background: linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,.1)) !important; color: #fff !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.5), inset 0 -1px 0 rgba(255,255,255,.12), 0 8px 24px rgba(0,0,0,.35); }
        html:not(.js-lite) .js-bb-btn.js-secondary { -webkit-backdrop-filter: blur(24px) saturate(190%); backdrop-filter: blur(24px) saturate(190%); }
        .js-view .js-lib .cardImageContainer { border-radius: 14px !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 10px 26px rgba(0,0,0,.6) !important; }
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
      nav: 'top', tabs: ['Home', 'Shows', 'Movies'],
      font: '"Montserrat", "Inter", "Helvetica Neue", Arial, sans-serif',
      labels: { tagMovie: 'PARAMOUNT+', tagTv: 'PARAMOUNT+', play: 'WATCH NOW', info: 'MORE INFO', request: 'REQUEST' },
      css: `
        .js-bb { height: min(62vh, 660px) !important; }
        .js-bb-shade { background: linear-gradient(90deg, rgba(0,20,61,.95) 0%, rgba(0,20,61,.6) 35%, transparent 65%), linear-gradient(0deg, #000a1f 0%, transparent 40%) !important; }
        .js-tab.on { box-shadow: inset 0 -3px 0 #0064ff !important; }
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
      nav: 'rail', tabs: ['Home', 'TV', 'Movies'],
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
    shape: 'portrait', caption: 'below', base: '#0b0c10', nav: 'top', tabs: ['Home', 'Shows', 'Movies'],
    labels: { tagMovie: 'MOVIE', tagTv: 'SERIES', play: 'Play', info: 'Details', request: 'Request' },
  };

  // Top 10 numerals, the way each service draws them
  const NUMERALS = {
    netflix: '--js-num-fill: #141414; --js-num-stroke: 4px #595959;',
    disney: '--js-num-fill: transparent; --js-num-stroke: 3px rgba(249,249,249,.85);',
    max: '--js-num-fill: #fff; --js-num-stroke: 0 transparent;',
    prime: '--js-num-fill: #e3e8f3; --js-num-stroke: 0 transparent;',
    hulu: '--js-num-fill: #0b0c0f; --js-num-stroke: 3px #1ce783;',
    apple: '--js-num-fill: rgba(255,255,255,.1); --js-num-stroke: 2px rgba(255,255,255,.65);',
    paramount: '--js-num-fill: #0064ff; --js-num-stroke: 3px #7fb2ff;',
    peacock: '--js-num-fill: #000; --js-num-stroke: 3px #ffb000;',
  };

  // row sizing per service: card widths, spacing, and how wide a Top 10 slot is next to its poster
  const LAND = (w, cw) => `--js-rank-pw: ${w}; --js-rank-ph: calc(var(--js-rank-pw) * .5625); --js-rank-cw: ${cw};`;
  const LAYOUT = {
    netflix: '--js-port-w: clamp(170px, 14.6vw, 300px); --js-poster-w: clamp(160px, 13.6vw, 280px); --js-gap: .3em; --js-rank-cw: calc(var(--js-poster-w) * 1.62);',
    disney: '--js-port-w: clamp(180px, 15.4vw, 320px); --js-poster-w: clamp(170px, 14.6vw, 300px); --js-wedge: var(--js-poster-w); --js-gap: .5em; --js-rank-cw: calc(var(--js-poster-w) * 1.06); --js-rank-pw: var(--js-poster-w); --js-rank-ph: calc(var(--js-poster-w) * 1.5); --js-land-w: clamp(250px, 19vw, 380px);',
    max: '--js-port-w: clamp(150px, 12vw, 225px); --js-gap: .45em; --js-rank-cw: calc(var(--js-poster-w) * 1.5);',
    prime: `--js-land-w: clamp(260px, 18.6vw, 370px); --js-gap: .45em; ${LAND('clamp(250px, 17vw, 340px)', 'calc(var(--js-rank-pw) + var(--js-rank-ph) * .78)')}`,
    hulu: `--js-land-w: clamp(260px, 21vw, 370px); --js-gap: .6em; ${LAND('clamp(250px, 20vw, 350px)', 'calc(var(--js-rank-pw) + .9em)')}`,
    apple: `--js-port-w: clamp(140px, 11vw, 205px); --js-gap: .75em; ${LAND('clamp(250px, 20vw, 360px)', 'calc(var(--js-rank-pw) + 1em)')}`,
    paramount: '--js-port-w: clamp(150px, 11.5vw, 210px); --js-gap: .3em; --js-rank-cw: calc(var(--js-poster-w) * 1.6);',
    peacock: '--js-land-w: clamp(250px, 20vw, 345px); --js-gap: .45em; --js-rank-cw: calc(var(--js-poster-w) * 1.56);',
  };

  // each service's Top 10, drawn the way that service draws it
  const RANKS = {
    // Netflix: huge black numerals outlined in gray, the poster tucked against each one
    netflix: `
      .js-rank-num { font-family: "Netflix Sans", "Helvetica Neue", Arial, sans-serif !important; font-weight: 700 !important; color: var(--js-base, #11142a) !important; -webkit-text-stroke: 3px rgba(255,255,255,.92) !important; letter-spacing: -.06em !important; }
      .js-rank-poster { border-radius: 8px !important; box-shadow: none !important; }`,
    // Disney+: portrait art, the rank in a teal quarter-circle tucked into the top-left corner
    disney: `
      .js-rank-num { z-index: 3 !important; top: 0 !important; left: calc(100% - var(--js-rank-pw)) !important; bottom: auto !important; right: auto !important;
        width: calc(var(--js-wedge) * .46); height: calc(var(--js-wedge) * .4); box-sizing: border-box; padding: .06em 0 0 .2em;
        border-top-left-radius: 12px; background: radial-gradient(120% 120% at 0 0, rgba(8,96,120,.95) 0 68%, rgba(8,96,120,0) 69%);
        font-family: "Avenir Next", Avenir, "Nunito Sans", sans-serif !important; font-size: calc(var(--js-wedge) * .27) !important;
        font-weight: 800 !important; letter-spacing: -.04em !important; line-height: 1 !important;
        color: #3ce8f2 !important; -webkit-text-stroke: 0 !important; text-shadow: none !important; }
      .js-rank-card .cardBox { margin: 0 !important; }
      .js-rank-poster { border-radius: 12px !important; box-shadow: none !important; }`,
    // HBO Max: tall, light numerals beside the poster
    max: `
      .js-rank-num { font-weight: 200 !important; letter-spacing: -.07em !important; color: #fff !important; -webkit-text-stroke: 0 !important; bottom: -.08em !important; opacity: .95; }
      .js-rank-poster { border-radius: 6px !important; }`,
    // Prime Video: wide tiles with a chunky light numeral beside each (outlined on phones)
    prime: `
      .js-rank-num { font-family: "Amazon Ember", "Helvetica Neue", Arial, sans-serif !important; font-size: calc(var(--js-rank-ph) * 1.02) !important; bottom: -.1em !important;
        font-weight: 800 !important; letter-spacing: -.05em !important; color: #e3e8f3 !important; -webkit-text-stroke: 0 !important; }
      html.js-phone .js-rank-num { color: transparent !important; -webkit-text-stroke: 2px #fff !important; font-weight: 600 !important; }
      .js-rank-poster { border-radius: 8px !important; box-shadow: none !important; }`,
    // Hulu: wide tiles, the rank in Hulu green leading the title underneath
    hulu: `
      .js-rank-num { display: none !important; }
      .js-rank-card .js-rank-cap { display: flex !important; }
      .js-rank-cap b { color: #1ce783; font-size: 1.9em; font-weight: 900; }
      .js-rank-cap .cardText { color: #f9f9f9 !important; font-weight: 600; }
      .js-rank-poster { border-radius: 8px !important; }`,
    // Apple TV: a chart of wide tiles, the rank leading the caption under each
    apple: `
      .js-rank-num { display: none !important; }
      .js-rank-card .js-rank-cap { display: flex !important; }
      .js-rank-cap b { color: #f5f5f7; font-size: 1.6em; }
      .js-rank-poster { border-radius: 12px !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 10px 26px rgba(0,0,0,.6) !important; }`,
    // Paramount+: dark numerals outlined in Paramount blue, glowing
    paramount: `
      .js-rank-num { color: #000a1f !important; -webkit-text-stroke: 3px #3d8bff !important; font-weight: 800 !important; filter: drop-shadow(0 0 14px rgba(0,100,255,.55)); }
      .js-rank-poster { border-radius: 4px !important; box-shadow: inset 0 -3px 0 #0064ff, -8px 0 18px rgba(0,0,0,.5) !important; }`,
    // Peacock: numerals in the six feather colors
    peacock: `
      .js-rank-num { color: transparent !important; -webkit-text-stroke: 0 !important; background: linear-gradient(160deg, #ffb000 0%, #ff6d00 22%, #e5007e 45%, #6f2da8 65%, #0063db 82%, #00b14f 100%); -webkit-background-clip: text; background-clip: text; font-weight: 800 !important; }
      .js-rank-poster { border-radius: 8px !important; }`,
  };

  // how each service dresses its rows: where the title art sits, captions, focus details
  const ROWS = {
    netflix: `
      .js-tlogo { max-width: 46% !important; max-height: 34% !important; left: 5% !important; bottom: 8% !important; }`,
    disney: `
      .js-tlogo { left: 7% !important; right: auto !important; transform: none; object-position: left bottom !important; max-width: 52% !important; max-height: 34% !important; bottom: 8% !important; }
      .js-tshade { background: linear-gradient(0deg, rgba(0,0,0,.55), transparent 50%) !important; }`,
    max: `
      .js-view .js-section .sectionTitle { font-size: 1.3em !important; letter-spacing: -.015em; }`,
    prime: `
      .js-tlogo { max-width: 50% !important; max-height: 40% !important; left: 5% !important; bottom: 9% !important; }
      .js-tshade { background: linear-gradient(90deg, rgba(0,0,0,.45), transparent 60%) !important; }`,
    hulu: `
      .js-view .js-cap-below .cardText-first { font-weight: 700 !important; color: #fff !important; }
      .js-view .js-cap-below .cardText-secondary { color: rgba(255,255,255,.55) !important; text-transform: uppercase; letter-spacing: .1em; font-size: .72em !important; }`,
    apple: `
      .js-view .js-cap-below .cardText-first { font-weight: 600 !important; color: #f5f5f7 !important; }
      .js-view .js-cap-below .cardText-secondary { color: rgba(235,235,245,.6) !important; }
      .js-view .js-section .sectionTitle { font-size: 1.4em !important; }`,
    paramount: `
      .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer { box-shadow: inset 0 -4px 0 #0064ff, 0 0 0 2px #fff, 0 0 26px rgba(0,100,255,.6) !important; }`,
    peacock: `
      .js-tlogo { max-width: 50% !important; }
      .js-view .js-lib .cardImageContainer::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; opacity: 0; transition: opacity .2s ease;
        background: linear-gradient(90deg, #ffb000, #ff6d00, #e5007e, #6f2da8, #0063db, #00b14f); }
      .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer::after { opacity: 1; }`,
  };

  // Netflix, by device: the TV / desktop app (navy, header tabs as text with a pill on the current one,
  // poster rows whose selected title opens wide) and the phone app (black, a tall poster billboard,
  // chips for tabs, red badges on posters).
  const NF = 'html[data-js-brand="netflix"]';
  const NF_TV = `${NF}:not(.js-phone)`;
  const NF_PH = `${NF}.js-phone`;
  // services whose selected title opens wide (shared movement and framing)
  const FX = 'html:is([data-js-brand="netflix"],[data-js-brand="disney"])';
  const FX_TV = `${FX}:not(.js-phone)`;
  const DS = 'html[data-js-brand="disney"]';
  const DS_TV = `${DS}:not(.js-phone)`;
  const DS_PH = `${DS}.js-phone`;
  const PR = 'html[data-js-brand="prime"]';
  const PR_TV = `${PR}:not(.js-phone)`;
  const PR_PH = `${PR}.js-phone`;
  const NETFLIX_CSS = `
    /* header: Jellyfin's tabs become Netflix's top navigation */
    ${NF}.js-service-open .skinHeader { background: linear-gradient(180deg, rgba(8,10,22,.88) 0%, rgba(8,10,22,.35) 70%, transparent 100%) !important; box-shadow: none !important; }
    ${NF}.js-service-open .headerTabs, ${NF}.js-service-open .headerTabs .emby-tabs-slider, ${NF}.js-service-open .sectionTabs {
      background: none !important; border: 0 !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
    ${NF_TV}.js-service-open .headerTabs .emby-tab-button {
      font-family: "Netflix Sans", "Helvetica Neue", Arial, sans-serif !important; font-weight: 600 !important; font-size: 1.05em !important;
      color: rgba(255,255,255,.88) !important; background: transparent !important; border: 0 !important; box-shadow: none !important;
      border-radius: 999px !important; padding: .5em 1.15em !important; margin: 0 .1em !important; }
    ${NF_TV}.js-service-open .headerTabs .emby-tab-button-active,
    ${NF_TV}.js-service-open .headerTabs .emby-tab-button:is(:hover, :focus-visible) { background: rgba(150,160,215,.5) !important; color: #fff !important; }
    ${NF_PH}.js-service-open .headerTabs .emby-tab-button {
      font-weight: 600 !important; color: #fff !important; background: rgba(255,255,255,.14) !important;
      border: 1px solid rgba(255,255,255,.2) !important; border-radius: 10px !important; box-shadow: none !important;
      padding: .5em 1em !important; margin: 0 .4em 0 0 !important; }
    ${NF_PH}.js-service-open .headerTabs .emby-tab-button-active { background: rgba(255,255,255,.3) !important; }
    ${NF}.js-service-open .headerTabs .emby-tab-button::before, ${NF}.js-service-open .headerTabs .emby-tab-button::after { display: none !important; }
    .js-hdr-mark { display: inline-flex; align-items: center; margin: 0 .5em; }
    .js-hdr-mark img { height: 2.1em; width: auto; border-radius: 6px; }
    ${NF_PH} .js-hdr-mark img { height: 1.9em; }

    /* TV / desktop: the selected title opens wide, framed in white, with badges and its details below */
    ${FX_TV} .js-view .js-lib.overflowPortraitCard { width: var(--js-port-w) !important; min-width: var(--js-port-w) !important; }
    ${FX_TV} .js-view .js-lib.overflowPortraitCard, ${FX_TV} .js-view .js-rank-card { transition: width .28s cubic-bezier(.2,.9,.25,1), min-width .28s cubic-bezier(.2,.9,.25,1); }
    ${FX_TV} .js-view .js-rank-poster { transition: width .28s cubic-bezier(.2,.9,.25,1), box-shadow .2s ease !important; }
    ${FX_TV} .js-view .js-open .cardImageContainer, ${FX_TV} .js-view .js-rank-card.js-open .js-rank-poster {
      border-radius: 12px !important; box-shadow: 0 0 0 3px #fff, 0 18px 40px rgba(0,0,0,.6) !important; transform: none !important; }
    ${FX_TV} .js-view .js-lib:not(.js-open):is(:hover) .cardImageContainer { transform: none !important; }
    .js-nf-wide { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
    /* no theme frames: plain artwork like Netflix */
    ${FX} .js-view .card, ${FX} .js-view .cardBox, ${FX} .js-view .cardScalable { border: 0 !important; outline: 0 !important; box-shadow: none !important; background: transparent !important; }
    ${FX} .js-view .card:not(.js-open) .cardImageContainer, ${FX} .js-view .js-rank-card:not(.js-open) .js-rank-poster { border: 0 !important; outline: 0 !important; box-shadow: none !important; }
    ${FX_TV} .js-view .card:not(.js-open) .cardImageContainer, ${FX_TV} .js-view .js-rank-card:not(.js-open) .js-rank-poster { border-radius: 6px !important; }
    /* movement: nothing scales; the open card only widens while the row slides. The spacer lets the last titles reach the left edge too */
    ${FX_TV} .js-view .js-lib .cardImageContainer, ${FX_TV} .js-view .js-rank-card .js-rank-poster,
    ${FX_TV} .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer,
    ${FX_TV} .js-view .js-rank-card:is(:hover,:focus-within,.show-focus,.focused) .js-rank-poster { transform: none !important; }
    ${FX_TV} .js-view .js-scroller { scroll-behavior: smooth; }
    ${FX_TV} .js-view .js-scroller > .itemsContainer::after { content: ""; flex: 0 0 62vw; }
    ${FX_TV}.js-nf-card-open #__jf_library_focus_ring__ { opacity: 0 !important; }
    ${FX}.js-service-open #__jf_library_focus_ring__ { border-color: #fff !important; box-shadow: 0 0 0 1px rgba(0,0,0,.5) !important; border-radius: 12px !important; }
    .js-nf-info { padding: .1em 3.3% .4em; max-width: min(62%, 900px); min-height: 4.4em; opacity: 0; transition: opacity .2s ease; font-family: "Netflix Sans", "Helvetica Neue", Arial, sans-serif; }
    .js-nf-info.on { opacity: 1; }
    .js-nf-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .1em .5em; font-weight: 700; font-size: .95em; color: #fff; }
    .js-nf-meta i { font-style: normal; opacity: .7; }
    .js-nf-ov { margin: .35em 0 0; font-size: 1.02em; line-height: 1.4; color: rgba(255,255,255,.9);
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

    /* badges */
    .js-nf-pb { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); z-index: 3; white-space: nowrap;
      background: #e50914; color: #fff; font: 700 .72em/1 "Netflix Sans", "Helvetica Neue", Arial, sans-serif; padding: .4em .7em; border-radius: 2px 2px 0 0; pointer-events: none; }
    .js-nf-pb.js-nf-ep { display: flex; flex-direction: column; align-items: stretch; padding: 0; text-align: center; }
    .js-nf-pb.js-nf-ep { padding-top: .4em; }
    .js-nf-pb.js-nf-ep b { display: block; margin-top: .4em; padding: .35em .7em; background: #fff; color: #000; font-weight: 700; }
    .js-nf-top { position: absolute; top: 0; right: 6%; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;
      width: 1.9em; padding: .2em 0 .25em; background: #e50914; color: #fff; font: 800 .5em/1 "Netflix Sans", Arial, sans-serif; letter-spacing: .02em; border-radius: 0 0 2px 2px; pointer-events: none; }
    .js-nf-top b { font-size: 1.9em; line-height: .95; letter-spacing: -.04em; }
    .js-nf-ob { display: none; }
    ${NF_TV} .js-open .js-nf-pb, ${NF_TV} .js-open .js-nf-top { display: none; }
    ${NF_TV} .js-open .js-nf-ob { display: flex; position: absolute; right: 3%; bottom: 5%; gap: .45em; z-index: 3; pointer-events: none; }
    .js-nf-pill { display: inline-flex; align-items: center; gap: .45em; padding: .4em .75em; border-radius: 6px; background: rgba(28,28,34,.86);
      color: #fff; font: 700 .78em/1 "Netflix Sans", "Helvetica Neue", Arial, sans-serif; white-space: nowrap; }
    .js-nf-ico-new { width: .8em; height: .8em; border-radius: 50%; background: #e50914; box-shadow: 0 0 0 2px rgba(229,9,20,.35); }
    .js-nf-ico-top { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; font: 800 .45em/1 Arial, sans-serif; font-style: normal;
      background: #e50914; color: #fff; width: 2.6em; height: 2.6em; border-radius: 2px; }
    .js-nf-ico-top b { font-size: 1.7em; line-height: .9; }

    /* phone: black, a tall poster billboard with centred logo, genre line and two buttons */
    ${NF_PH} .js-view { --js-poster-w: 28vw; --js-port-w: 29.4vw; --js-gap: .95vw; --js-rank-cw: 44.3vw; --js-rank-ph: calc(28vw * 1.42); }
    ${NF_PH} .js-view .emby-scroller.js-scroller { padding-left: 2.6vw !important; padding-right: 2.6vw !important; }
    ${NF_PH} .js-view .js-rank-num { font-size: calc(var(--js-rank-ph) * .82) !important; }
    ${NF_PH} .js-view .js-lib.overflowPortraitCard { width: var(--js-port-w) !important; min-width: var(--js-port-w) !important; }
    ${NF_PH} .js-view .sectionTitle { font-size: 1.32em !important; font-weight: 800 !important; }
    ${NF_PH} .js-view .js-lib .cardImageContainer { border-radius: 4px !important; }
    ${NF_PH} .js-rank-num { color: #000 !important; -webkit-text-stroke: 2.5px #fff !important; }
    ${NF_PH} .js-rank-poster { border-radius: 4px !important; }
    ${NF_PH} .js-bb { height: auto !important; min-height: 0 !important; aspect-ratio: .69; margin: .6em 5% 1.4em !important; border-radius: 16px !important;
      box-shadow: 0 0 0 1px rgba(255,255,255,.18), 0 20px 40px rgba(0,0,0,.5) !important; }
    ${NF_PH} .js-bb-art { display: none !important; }
    ${NF_PH} .js-bb-poster { display: block !important; position: absolute; inset: 0; background-size: cover; background-position: center top; }
    ${NF_PH} .js-bb-shade { background: linear-gradient(0deg, rgba(0,0,0,.88) 0%, rgba(0,0,0,.35) 32%, transparent 52%) !important; }
    ${NF_PH} .js-bb-content { left: 6% !important; right: 6% !important; width: auto !important; bottom: calc(2.5% + 1.4em) !important; align-items: center; text-align: center; gap: .75em !important; }
    ${NF_PH} .js-bb-tag, ${NF_PH} .js-bb-rank, ${NF_PH} .js-bb-overview { display: none !important; }
    ${NF_PH} .js-bb-title { font-size: 2.3em !important; text-align: center; text-transform: none !important; }
    ${NF_PH} .js-bb-logo { max-width: 82%; max-height: 18vh; margin: 0 auto; object-position: center bottom; }
    ${NF_PH} .js-bb-tags { display: flex !important; flex-wrap: wrap; justify-content: center; align-items: center; gap: .15em .5em; color: #fff; font-size: .98em; }
    ${NF_PH} .js-bb-tags .js-strong { font-weight: 700; }
    ${NF_PH} .js-bb-tags i { font-style: normal; opacity: .6; }
    ${NF_PH} .js-bb-actions { display: grid !important; grid-template-columns: 1fr 1fr; gap: .6em; width: 100%; margin: 0 !important; }
    ${NF_PH} .js-bb-btn { width: 100% !important; height: 2.9em !important; border-radius: 8px !important; font-size: 1.02em !important; padding: 0 .5em !important; }
    ${NF_PH} .js-bb-btn.js-secondary { background: rgba(109,109,110,.55) !important; }
  `;

  const DISNEY_CSS = `
    /* header: no bar; on TV Jellyfin's tabs become Disney's pill group at the top, on phones a chip row */
    ${DS}.js-service-open .skinHeader { background: linear-gradient(180deg, rgba(8,10,22,.6) 0%, transparent 100%) !important; box-shadow: none !important; }
    ${DS}.js-service-open .headerTabs, ${DS}.js-service-open .sectionTabs { background: none !important; border: 0 !important; box-shadow: none !important; }
    ${DS}.js-service-open .headerTabs .emby-tab-button::before, ${DS}.js-service-open .headerTabs .emby-tab-button::after { display: none !important; }
    ${DS_TV}.js-service-open .headerTabs { display: flex !important; justify-content: center !important; }
    ${DS_TV}.js-service-open .headerTabs .emby-tabs-slider {
      display: inline-flex !important; gap: .15em; padding: .3em !important; border-radius: 999px !important;
      background: rgba(125,140,205,.32) !important; border: 1px solid rgba(255,255,255,.14) !important;
      -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
    ${DS_TV}.js-service-open .headerTabs .emby-tab-button {
      font-family: "Avenir Next", Avenir, "Nunito Sans", sans-serif !important; font-weight: 600 !important; font-size: 1em !important;
      color: #fff !important; background: transparent !important; border: 0 !important; box-shadow: none !important;
      border-radius: 999px !important; padding: .55em 1.5em !important; margin: 0 !important; }
    ${DS_TV}.js-service-open .headerTabs .emby-tab-button-active,
    ${DS_TV}.js-service-open .headerTabs .emby-tab-button:is(:hover, :focus-visible) { background: rgba(170,185,255,.45) !important; }
    ${DS_PH}.js-service-open .headerTabs .emby-tab-button {
      font-weight: 600 !important; color: #fff !important; background: rgba(255,255,255,.05) !important;
      border: 1px solid rgba(255,255,255,.24) !important; border-radius: 999px !important; box-shadow: none !important;
      padding: .55em 1.3em !important; margin: 0 .5em 0 0 !important; }
    ${DS_PH}.js-service-open .headerTabs .emby-tab-button-active { background: rgba(255,255,255,.2) !important; }
    ${DS}.js-service-open #__jf_library_focus_ring__ { border-radius: 14px !important; }

    /* TV banner: full width under the header, art on the right fading into the page on the left */
    ${DS_TV} .js-bb { height: 86vh !important; min-height: 460px; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
    ${DS_TV} .js-bb-art { left: 26% !important; background-position: center 22% !important; }
    ${DS_TV} .js-bb-shade { background:
      linear-gradient(90deg, var(--js-base) 0%, var(--js-base) 26%, color-mix(in srgb, var(--js-base) 55%, transparent) 40%, transparent 62%),
      linear-gradient(0deg, var(--js-base) 0%, color-mix(in srgb, var(--js-base) 60%, transparent) 22%, transparent 45%) !important; }
    ${DS_TV} .js-bb-content { left: 4.5% !important; bottom: 31% !important; width: min(34%, 560px) !important; gap: .75em !important; }
    ${DS_TV} .js-bb-dots { bottom: 25%; }
    ${DS_TV} .js-rows { position: relative; z-index: 2; margin-top: -21vh; }
    ${DS_TV} .js-bb .js-hero { top: 6em; }
    ${DS} .js-bb-tag { display: none !important; }
    ${DS} .js-bb-rank { order: -1; align-self: flex-start; background: #f4f4f4; color: #111; font: 600 .8em/1 "Avenir Next", Avenir, sans-serif; padding: .4em .7em; border-radius: 6px; }
    ${DS} .js-bb-rank::before { display: none !important; }
    ${DS} .js-bb-title { font-weight: 800 !important; }
    ${DS} .js-bb-meta { display: block !important; font-size: .95em; font-weight: 500; color: rgba(255,255,255,.92); }
    ${DS} .js-bb-overview { -webkit-line-clamp: 2 !important; font-size: 1em !important; font-weight: 600; }
    ${DS} .js-bb-btn .material-icons { display: none; }
    ${DS} .js-bb-btn.js-primary { background: rgba(255,255,255,.16) !important; color: #fff !important; border-radius: 999px !important;
      height: 2.7em !important; padding: 0 1.7em !important; font: 700 .9em/1 "Avenir Next", Avenir, sans-serif !important; letter-spacing: .08em; }
    ${DS} .js-bb-btn.js-primary:is(:hover, :focus, :focus-visible) { background: #f2f3f7 !important; color: #10131f !important; transform: none; }

    /* phone banner: a big rounded poster card, logo and details centered at the bottom; tap it to open */
    ${DS_PH} .js-bb { height: auto !important; min-height: 0 !important; aspect-ratio: .7; margin: .6em 6.5% 1.8em !important; border-radius: 16px !important;
      border: 1px solid rgba(255,255,255,.16); box-shadow: 0 18px 40px rgba(0,0,0,.5) !important; }
    ${DS_PH} .js-bb-art { display: none !important; }
    ${DS_PH} .js-bb-poster { display: block !important; position: absolute; inset: 0; background-size: cover; background-position: center top; }
    ${DS_PH} .js-bb-shade { background: linear-gradient(0deg, rgba(12,12,18,.94) 0%, rgba(12,12,18,.35) 30%, transparent 52%) !important; }
    ${DS_PH} .js-bb-content { left: 6% !important; right: 6% !important; width: auto !important; bottom: 6% !important; align-items: center; text-align: center; gap: .55em !important; }
    ${DS_PH} .js-bb-rank { align-self: center; }
    ${DS_PH} .js-bb-title { font-size: 2.1em !important; text-align: center; }
    ${DS_PH} .js-bb-logo { max-width: 78%; max-height: 16vh; margin: 0 auto; object-position: center bottom; }
    ${DS_PH} .js-bb-overview, ${DS_PH} .js-bb-actions { display: none !important; }
    ${DS_PH} .js-bb-slide:not(:has(.js-bb-link)) .js-bb-actions { display: flex !important; }
    ${DS_PH} .js-bb-dots { bottom: 1.6%; }
    ${DS_PH} .js-bb .js-hero { top: .7em; right: 4%; }

    /* rows */
    ${DS} .js-view .sectionTitle { font-family: "Avenir Next", Avenir, "Nunito Sans", sans-serif !important; font-weight: 600 !important; font-size: 1.22em !important; color: #f2f3f7 !important; letter-spacing: 0 !important; }
    ${DS} .js-view .js-section .sectionTitle::before { display: none !important; }
    ${DS_TV} .js-view .card:not(.js-open) .cardImageContainer, ${DS_TV} .js-view .js-rank-card:not(.js-open) .js-rank-poster { border-radius: 12px !important; }
    ${DS_TV} .js-view .js-open .cardImageContainer, ${DS_TV} .js-view .js-rank-card.js-open .js-rank-poster {
      border-radius: 14px !important; box-shadow: 0 0 0 3px #fff, 0 0 26px rgba(255,255,255,.25), 0 18px 40px rgba(0,0,0,.55) !important; }
    ${DS} .js-dmeta { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 2.4em .5em .6em; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font: 600 .72em/1.2 "Avenir Next", Avenir, sans-serif; color: #fff; background: linear-gradient(0deg, rgba(12,14,26,.85), transparent); border-radius: 0 0 inherit inherit; pointer-events: none; }
    ${DS} .js-cert { display: inline-block; padding: .08em .38em; margin-right: .45em; border-radius: 3px; background: rgba(150,170,225,.35); font-weight: 700; font-style: normal; }
    ${DS_TV} .js-open .js-dmeta { display: none; }
    ${DS} .js-nf-pb { bottom: 2.9em !important; top: auto !important; background: #f4f4f4 !important; color: #111 !important; border-radius: 5px !important;
      font: 600 .64em/1 "Avenir Next", Avenir, sans-serif !important; padding: .35em .6em !important; display: block !important; }
    ${DS} .js-nf-pb b, ${DS} .js-nf-top, ${DS} .js-nf-ob { display: none !important; }
    ${DS} .js-nf-info { min-height: 2em; padding-top: .45em; font-family: "Avenir Next", Avenir, sans-serif; }
    ${DS} .js-nf-meta { font-weight: 600; font-size: .9em; gap: .2em; }
    ${DS} .js-nf-ov { display: none; }

    /* Continue Watching: wide stills with a progress bar */
    .js-prog { display: none; }
    ${DS} .js-cw .js-prog { display: block; position: absolute; left: 6%; right: 6%; bottom: 8%; height: 4px; border-radius: 2px; background: rgba(255,255,255,.28); z-index: 2; }
    ${DS} .js-cw .js-prog i { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, #0a7cff, #34c8f2); }
    ${DS} .js-cw .cardImageContainer { border-radius: 12px !important; }
    ${DS_TV} .js-cw .cardFooter { display: none !important; }
    ${DS} .js-cw .cardText { text-align: left !important; }
    ${DS} .js-cw .cardText-first { font-weight: 700 !important; color: #f2f3f7 !important; }

    /* phones: Disney's sizes (posters about a quarter of the screen, Top 10 cards two-thirds) */
    ${DS_PH} .js-view { --js-poster-w: 66vw; --js-wedge: 66vw; --js-rank-cw: 70vw; --js-rank-pw: 66vw; --js-rank-ph: calc(66vw * 1.5); --js-port-w: 29.6vw; --js-gap: 1.15vw; }
    ${DS_PH} .js-view .emby-scroller.js-scroller { padding-left: 4.2vw !important; padding-right: 4.2vw !important; }
    ${DS_PH} .js-view .js-lib.overflowPortraitCard { width: var(--js-port-w) !important; min-width: var(--js-port-w) !important; }
    ${DS_PH} .js-view .js-lib .cardImageContainer, ${DS_PH} .js-view .js-rank-poster { border-radius: 10px !important; }
    ${DS_PH} .js-view .js-rank-card .js-dmeta { font-size: 1em; }
    ${DS_PH} .js-view .sectionTitle { font-size: 1.4em !important; }
    ${DS_PH} .js-cw .overflowBackdropCard { width: 60vw !important; min-width: 60vw !important; }
  `;

  const PRIME_CSS = `
    /* header: Prime's centered tab bar on TV, dark chips on phones */
    ${PR}.js-service-open .skinHeader { background: linear-gradient(180deg, rgba(5,10,20,.7) 0%, transparent 100%) !important; box-shadow: none !important; }
    ${PR}.js-service-open .headerTabs, ${PR}.js-service-open .headerTabs .emby-tabs-slider, ${PR}.js-service-open .sectionTabs { background: none !important; border: 0 !important; box-shadow: none !important; }
    ${PR}.js-service-open .headerTabs .emby-tab-button::before, ${PR}.js-service-open .headerTabs .emby-tab-button::after { display: none !important; }
    ${PR_TV}.js-service-open .headerTabs { display: flex !important; justify-content: center !important; }
    ${PR_TV}.js-service-open .headerTabs .emby-tab-button {
      font-family: "Amazon Ember", "Helvetica Neue", Arial, sans-serif !important; font-weight: 500 !important; font-size: 1.05em !important;
      color: rgba(255,255,255,.86) !important; background: transparent !important; border: 0 !important; box-shadow: none !important;
      border-radius: 8px !important; padding: .42em .95em !important; margin: 0 .1em !important; }
    ${PR_TV}.js-service-open .headerTabs .emby-tab-button-active,
    ${PR_TV}.js-service-open .headerTabs .emby-tab-button:is(:hover, :focus-visible) { background: rgba(255,255,255,.22) !important; color: #fff !important; }
    ${PR_PH}.js-service-open .headerTabs .emby-tab-button {
      font-weight: 500 !important; color: #fff !important; background: #30343b !important; border: 0 !important; border-radius: 999px !important;
      box-shadow: none !important; padding: .55em 1.3em !important; margin: 0 .5em 0 0 !important; }
    ${PR_PH}.js-service-open .headerTabs .emby-tab-button-active { background: #4a5059 !important; }

    /* banner: full width, art on the right fading into navy; Prime's details stack on the left */
    ${PR_TV} .js-bb { height: 80vh !important; min-height: 440px; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
    ${PR_TV} .js-bb-art { left: 32% !important; background-position: center 20% !important; }
    ${PR_TV} .js-bb-shade { background:
      linear-gradient(90deg, var(--js-base) 0%, var(--js-base) 30%, color-mix(in srgb, var(--js-base) 60%, transparent) 42%, transparent 62%),
      linear-gradient(0deg, var(--js-base) 0%, color-mix(in srgb, var(--js-base) 55%, transparent) 25%, transparent 50%) !important; }
    ${PR_TV} .js-bb-content { left: 5% !important; bottom: 30% !important; width: min(40%, 640px) !important; gap: .55em !important; }
    ${PR_TV} .js-rows { position: relative; z-index: 2; margin-top: -24vh; }
    ${PR_TV} .js-bb-dots { bottom: 25%; }
    ${PR_TV} .js-bb .js-hero { top: 5.5em; }
    ${PR} .js-bb-content::before { content: "prime"; order: 0; font: 800 1.05em/1 "Amazon Ember", Arial, sans-serif; color: #fff; letter-spacing: -.02em; }
    ${PR} .js-bb-title { order: 1; font-weight: 700 !important; font-size: clamp(1.8em, 3.4vw, 3.4em) !important; }
    ${PR} .js-bb-logo { max-height: min(20vh, 190px) !important; }
    ${PR} .js-bb-new { order: 2; align-self: flex-start; padding: .25em .55em; border-radius: 5px; border: 1px solid rgba(255,255,255,.75); color: #fff; font: 600 .78em/1 "Amazon Ember", Arial, sans-serif; text-transform: uppercase; letter-spacing: .03em; }
    ${PR} .js-bb-rank { order: 2; color: #3fe0a8; font-weight: 700; font-size: 1.05em; }
    ${PR} .js-bb-rank:empty { display: none; }
    ${PR} .js-bb-rank::before { content: "↗"; display: inline-flex; align-items: center; justify-content: center; width: 1.2em; height: 1.2em; margin-right: .4em; border: 2px solid #3fe0a8; border-radius: 50%; font-size: .75em; }
    ${PR} .js-bb-meta { order: 3; display: flex !important; align-items: center; gap: 1.2em; font-size: 1.02em; color: #fff; }
    ${PR} .js-bb-meta:empty { display: none !important; }
    ${PR} .js-bb-overview { order: 4; -webkit-line-clamp: 2 !important; font-size: 1em !important; }
    ${PR} .js-bb-tag { order: 5; color: #fff !important; font-size: .88em !important; font-weight: 500; text-transform: none; letter-spacing: 0; }
    ${PR} .js-bb-tag:not(:empty)::before { content: "✓"; display: inline-flex; align-items: center; justify-content: center; width: 1.15em; height: 1.15em; margin-right: .5em; border-radius: 50%; background: #1a98ff; color: #fff; font-size: .75em; font-weight: 900; }
    ${PR} .js-bb-actions { order: 6; flex-direction: column; align-items: flex-start; gap: .5em !important; }
    ${PR} .js-bb-btn { border-radius: 6px !important; height: 2.4em !important; padding: 0 1.5em 0 1em !important; font: 500 .95em/1 "Amazon Ember", Arial, sans-serif !important; min-width: 11em; justify-content: flex-start !important; }
    ${PR} .js-bb-btn .material-icons { font-size: 1.3em !important; }
    ${PR} .js-bb-btn.js-primary { background: rgba(235,240,250,.92) !important; color: #0b1626 !important; }
    ${PR} .js-bb-btn.js-secondary { background: transparent !important; color: #fff !important; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.8) !important; }
    ${PR} .js-bb-btn:is(:hover, :focus-visible) { transform: none; filter: none; box-shadow: 0 0 0 3px #fff !important; }
    ${PR} .js-bb-focus .js-bb-actions { display: none !important; }
    ${PR} .js-bb[data-focus] .js-bb-dots { display: none !important; }
    ${PR} .js-cert { display: inline-block; padding: .1em .4em; border-radius: 4px; background: rgba(140,160,200,.35); color: #fff; font-weight: 700; font-size: .85em; font-style: normal; }
    ${PR} .js-bb-slide.js-bb-focus { transition: opacity .35s ease, visibility 0s linear .35s; }
    ${PR} .js-bb-slide.js-bb-focus.on { transition: opacity .35s ease; }

    /* TV with JellyNav: the banner stays put at the top showing the selection; rows move under it */
    ${PR_TV}.js-hero-fixed .js-bb { position: fixed !important; top: 0; left: 0; right: 0; height: 70vh !important; z-index: 0; margin: 0 !important; }
    ${PR_TV}.js-hero-fixed .js-bb-content { bottom: 18% !important; }
    ${PR_TV}.js-hero-fixed .js-bb-dots { bottom: 12%; }
    ${PR_TV}.js-hero-fixed .js-rows { margin-top: 60vh; position: relative; z-index: 1; padding-bottom: 45vh; }
    ${PR_TV}.js-hero-fixed .js-view .js-section { transition: opacity .25s ease; }
    ${PR_TV}.js-hero-fixed .js-view .js-section.js-above { opacity: 0 !important; pointer-events: none; animation: none !important; }

    /* cards: wide titled art, Prime's white corner labels, a white frame when selected */
    ${PR} .js-view .sectionTitle { font-family: "Amazon Ember", "Helvetica Neue", Arial, sans-serif !important; font-weight: 700 !important; font-size: 1.12em !important; color: #fff !important; letter-spacing: 0 !important; }
    ${PR} .js-view .js-section .sectionTitle::before { display: none !important; }
    ${PR} .js-view .card, ${PR} .js-view .cardBox, ${PR} .js-view .cardScalable { border: 0 !important; outline: 0 !important; background: transparent !important; box-shadow: none !important; }
    ${PR} .js-view .js-lib .cardImageContainer, ${PR} .js-view .js-cw .cardImageContainer { border-radius: 8px !important; box-shadow: none !important; transform: none !important; }
    ${PR} .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer,
    ${PR} .js-view .js-cw .card:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer,
    ${PR} .js-view .js-rank-card:is(:hover,:focus-within,.show-focus,.focused) .js-rank-poster { transform: none !important; box-shadow: 0 0 0 3px #fff, 0 14px 30px rgba(0,0,0,.55) !important; border-radius: 10px !important; }
    ${PR}.js-service-open #__jf_library_focus_ring__ { border-color: #fff !important; border-radius: 10px !important; box-shadow: 0 0 0 1px rgba(0,0,0,.4) !important; }
    ${PR} .js-nf-pb { top: 0 !important; bottom: auto !important; left: auto !important; right: 0 !important; transform: none !important; display: block !important;
      background: #f2f4f8 !important; color: #0b1626 !important; border-radius: 0 8px 0 6px !important; padding: .32em .55em !important;
      font: 700 .6em/1 "Amazon Ember", Arial, sans-serif !important; text-transform: uppercase; letter-spacing: .03em; }
    ${PR} .js-nf-pb b, ${PR} .js-nf-top, ${PR} .js-nf-ob { display: none !important; }
    ${PR} .js-cw .js-prog { display: block; position: absolute; left: 4%; right: 4%; bottom: 5%; height: 3px; border-radius: 2px; background: rgba(255,255,255,.3); z-index: 2; }
    ${PR} .js-cw .js-prog i { display: block; height: 100%; border-radius: 2px; background: #e6e9ef; }
    ${PR_TV} .js-cw .cardFooter { display: none !important; }

    /* phones: black, portrait posters, wide Top 10 cards with outlined numerals */
    ${PR_PH} .js-view { --js-port-w: 31.4vw; --js-gap: 1vw; --js-rank-pw: 66vw; --js-rank-ph: calc(66vw * .5625); --js-rank-cw: calc(66vw + 66vw * .5625 * .62); }
    ${PR_PH} .js-view .js-lib.overflowPortraitCard { width: var(--js-port-w) !important; min-width: var(--js-port-w) !important; }
    ${PR_PH} .js-view .emby-scroller.js-scroller { padding-left: 4vw !important; padding-right: 4vw !important; }
    ${PR_PH} .js-view .sectionTitle { font-weight: 500 !important; font-size: 1.35em !important; color: #c9ced6 !important; }
    ${PR_PH} .js-bb { height: auto !important; min-height: 0 !important; aspect-ratio: .7; margin: .6em 5% 1.6em !important; border-radius: 12px !important; }
    ${PR_PH} .js-bb-art { display: none !important; }
    ${PR_PH} .js-bb-poster { display: block !important; position: absolute; inset: 0; background-size: cover; background-position: center top; }
    ${PR_PH} .js-bb-shade { background: linear-gradient(0deg, rgba(0,6,17,.95) 0%, rgba(0,6,17,.35) 32%, transparent 55%) !important; }
    ${PR_PH} .js-bb-content { left: 6% !important; right: 6% !important; width: auto !important; bottom: calc(2.5% + 1.4em) !important; align-items: center; text-align: center; }
    ${PR_PH} .js-bb-content::before, ${PR_PH} .js-bb-meta, ${PR_PH} .js-bb-overview { display: none !important; }
    ${PR_PH} .js-bb-new, ${PR_PH} .js-bb-rank { align-self: center; }
    ${PR_PH} .js-bb-logo { margin: 0 auto; object-position: center bottom; max-width: 78%; }
    ${PR_PH} .js-bb-actions { flex-direction: row; width: 100%; }
    ${PR_PH} .js-bb-btn { flex: 1; justify-content: center !important; min-width: 0; }
  `;

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
      const rules = (b.css + (RANKS[k] || '') + (ROWS[k] || '')).replace(/(^|})\s*([^{}]+)\{/g, (m, close, sel) =>
        `${close}\n${splitSel(sel).map((x) => `html[data-js-brand="${k}"] ${x}`).join(', ')} {`);
      return `${rules}\nhtml[data-js-brand="${k}"] .js-view { font-family: ${b.font}; ${NUMERALS[k] || ''} ${LAYOUT[k] || ''} }`;
    }).join('\n') + NETFLIX_CSS + DISNEY_CSS + PRIME_CSS;
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
      const phone = isPhone();
      root.setProperty('--js-c1', svc.Accent || b.c1);
      root.setProperty('--js-c2', b.c2);
      root.setProperty('--js-bg', (phone && b.bgPhone) || b.bg);
      root.setProperty('--jst-num', b.num || 'glass');
      root.setProperty('--jst-num-a', b.numA || b.c1);
      root.setProperty('--jst-num-b', b.numB || b.c2);
      root.setProperty('--js-base', (phone && b.basePhone) || b.base || '#0b0c10');
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

  // the service's background on everything that could paint over it (themes color .page, body, ...)
  let painted = [];
  const paintPage = (on) => {
    painted.forEach((el) => { for (const p of ['background', 'background-color', 'background-attachment']) el.style.removeProperty(p); });
    painted = [];
    if (!on) return;
    const view = document.querySelector('.js-view');
    // the service colour goes on the root; everything between it and the rows is cleared, so no theme grey shows through
    const targets = [document.documentElement, document.body, ...document.querySelectorAll('.backgroundContainer, .skinBody')];
    for (let el = view?.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) targets.push(el);
    for (const el of new Set(targets.filter(Boolean))) {
      if (el === document.documentElement) {
        el.style.setProperty('background', 'var(--js-bg, #0b0c10)', 'important');
        el.style.setProperty('background-attachment', 'fixed', 'important');
      } else {
        el.style.setProperty('background', 'transparent', 'important');
      }
      painted.push(el);
    }
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
    .js-services { overflow-x: clip; }
    .js-services .js-svc-card { width: var(--js-tile-w, clamp(220px, 18vw, 330px)) !important; min-width: 0 !important; flex: 0 0 auto !important; }
    .js-services .js-tile-logo { width: 2.3em; height: 2.3em; flex: none; border-radius: 22%; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.14); }
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
      padding: .55em .8em .55em .6em;
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
    .js-services .js-tile-bar {
      width: 4px; align-self: stretch; flex: none; border-radius: 4px;
      background: var(--js-t1, #fff);
      box-shadow: 0 0 10px color-mix(in srgb, var(--js-t1, #fff) 70%, transparent);
    }
    .js-services .js-tile-text { min-width: 0; line-height: 1.15; }
    .js-services .js-tile-text b {
      display: block; font-weight: 800; font-size: 1.12em; letter-spacing: -.01em;
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
    .js-bb-slide { position: absolute; inset: 0; opacity: 0; visibility: hidden; transition: opacity .9s ease, visibility 0s linear .9s; }
    .js-bb-slide.on { opacity: 1; visibility: visible; transition: opacity .9s ease; z-index: 1; }
    .js-bb-slide.on .js-bb-art.on, .js-bb-slide.on .js-bb-poster { animation: js-bb-drift 9s ease-out both; }
    @keyframes js-bb-drift { from { transform: scale(1.07) translate3d(1.2%, .6%, 0); } to { transform: scale(1) translate3d(0, 0, 0); } }
    html.js-lite .js-bb-slide, html.js-lite .js-bb-slide.on { transition: none; }
    html.js-lite .js-bb-slide .js-bb-art, html.js-lite .js-bb-slide .js-bb-poster { animation: none !important; }
    @media (prefers-reduced-motion: reduce) { .js-bb-slide .js-bb-art, .js-bb-slide .js-bb-poster { animation: none !important; } }
    .js-bb-link { position: absolute; inset: 0; z-index: 1; }
    .js-bb-content { z-index: 2; }
    .js-bb-meta:empty, .js-bb-meta { display: none; }
    .js-bb-dots { position: absolute; z-index: 3; left: 0; right: 0; bottom: 4%; display: flex; justify-content: center; gap: .55em; pointer-events: auto; }
    .js-bb-dot { width: .5em; height: .5em; border-radius: 50%; background: rgba(255,255,255,.4); cursor: pointer; transition: background .3s ease, transform .3s ease; }
    .js-bb-dot.on { background: #fff; transform: scale(1.25); }
    .js-bb .js-hero { z-index: 4; }
    .js-bb-new { display: none; }
    .js-view.js-libmode > .js-bb, .js-view.js-libmode > .js-rows { display: none !important; }
    .js-libview { padding: 5.5em 0 4em; min-height: 100vh; }
    /* TV / desktop library: the banner stays put at the top showing the selected title; the grid moves under it */
    html .js-view.js-libmode.js-libhero > .js-libview { padding-top: 0; }
    html .js-view.js-libmode.js-libhero > .js-libview > .js-bb.js-lib-hero { position: fixed !important; top: 0 !important; left: 0; right: 0; height: 56vh !important; min-height: 0 !important;
      margin: 0 !important; z-index: 2; pointer-events: auto; }
    html .js-view.js-libhero .js-lib-hero::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 22%; pointer-events: none;
      background: linear-gradient(to bottom, transparent, var(--js-base, #0b0c10)); }
    html .js-view.js-libhero .js-lib-hero .js-bb-slide { transition: opacity .5s ease; }
    html .js-view.js-libhero .js-lib-hero .js-bb-dots, html .js-view.js-libhero .js-lib-hero .js-bb-actions,
    html .js-view.js-libhero .js-lib-hero .js-bb-rank, html .js-view.js-libhero .js-lib-hero .js-hero { display: none !important; }
    html .js-view.js-libhero .js-lib-hero .js-bb-content { top: auto !important; bottom: 14% !important; }
    html .js-view.js-libhero .js-lib-hero .js-bb-logo { max-height: 14vh !important; max-width: 32vw !important; }
    html .js-view.js-libhero .js-lib-hero .js-bb-title { font-size: clamp(1.6em, 3.2vw, 2.8em) !important; }
    html .js-view.js-libhero .js-lib-hero .js-bb-overview { display: -webkit-box !important; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 42em; }
    html .js-view.js-libmode.js-libhero .js-lib-body { position: relative; z-index: 1; margin-top: 56vh; padding-bottom: 45vh; }
    html .js-view.js-libhero .js-lib-body .js-section { transition: opacity .25s ease; }
    html .js-view.js-libhero .js-lib-body .js-section.js-above { opacity: 0 !important; pointer-events: none; }
    /* the way into the library, at the end of each service home */
    .js-browse { position: relative; margin: 2.4em 3.3% 3em; padding: 2.2em 0 1.4em; border-radius: 22px; overflow: hidden; isolation: isolate;
      background: linear-gradient(120deg, color-mix(in srgb, var(--js-accent, #00a4dc) 30%, #0b0c10), #0b0c10 70%);
      box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 30px 60px rgba(0,0,0,.4); }
    .js-browse-wall { position: absolute; inset: -30% -10% -30% 30%; z-index: -1; display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; transform: rotate(-12deg);
      opacity: .38; -webkit-mask: linear-gradient(90deg, transparent, #000 45%); mask: linear-gradient(90deg, transparent, #000 45%); }
    .js-browse-wall i { aspect-ratio: 2 / 3; border-radius: 8px; background: #222 center / cover no-repeat; }
    html:not(.js-lite) .js-browse-wall { animation: js-browse-drift 60s linear infinite alternate; }
    @keyframes js-browse-drift { to { transform: rotate(-12deg) translateY(-12%); } }
    .js-browse-head { padding: 0 2.2em; max-width: 40em; }
    .js-browse-eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: .78em; font-weight: 700; color: var(--js-accent, #00a4dc); filter: brightness(1.4); }
    .js-browse-title { font-size: 2em; font-weight: 800; line-height: 1.1; margin: .25em 0 .2em; color: #fff; }
    .js-browse-sub { opacity: .75; }
    .js-browse .js-browse-row .js-scroller { padding: .7em 2.2em .4em !important; }
    .js-browse-btn { color: #fff !important; text-decoration: none; gap: .1em;
      background: linear-gradient(150deg, rgba(255,255,255,.16), rgba(255,255,255,.04)) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14);
      transition: transform .2s ease, box-shadow .2s ease, background .2s ease; }
    html:not(.js-lite) .js-browse-btn { -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
    .js-browse-tile:is(:hover, :focus-within, .show-focus, .focused) .js-browse-btn { transform: scale(1.04); box-shadow: inset 0 0 0 2px #fff, 0 12px 30px rgba(0,0,0,.4);
      background: linear-gradient(150deg, color-mix(in srgb, var(--js-accent, #00a4dc) 55%, transparent), rgba(255,255,255,.06)) !important; }
    .js-browse-icon { font-size: 1.9em !important; opacity: .9; margin-bottom: auto; }
    .js-browse-label { font-size: 1.15em; font-weight: 700; white-space: nowrap; }
    .js-browse-count { opacity: .7; font-size: .85em; }
    .js-browse-genres .js-sw-tab { background: rgba(255,255,255,.08) !important; color: #fff !important; }
    html.js-phone .js-browse { margin: 1.6em 4% 2em; padding-top: 1.6em; border-radius: 18px; }
    html.js-phone .js-browse-head { padding: 0 1.2em; }
    html.js-phone .js-browse-title { font-size: 1.45em; }
    html.js-phone .js-browse .js-browse-row .js-scroller { padding: .6em 1.2em .3em !important; }
    html.js-phone .js-browse-btn { width: 9.5em !important; height: 6em !important; }
    html.js-phone .js-libview { padding-top: 1em; }
    .js-lib-head { display: flex; align-items: baseline; gap: .9em; padding: 0 3.3%; margin-bottom: .4em; }
    .js-lib-title { margin: 0; font-size: 1.9em; font-weight: 800; color: #fff; }
    .js-lib-count { opacity: .65; font-size: 1em; }
    .js-libview .js-lib-chips .js-scroller { padding-top: .35em !important; padding-bottom: .35em !important; }
    .js-libview .js-lib-genres .js-sw-tab { height: 2.2em !important; font-size: .9em; }
    .js-libview .js-lib-grid { margin-top: .8em; }
    .js-libview .js-lib-line .js-scroller { padding-top: .45em !important; padding-bottom: .45em !important; overflow: visible !important; }
    .js-libview .js-lib-line .itemsContainer { flex-wrap: nowrap; }
    .js-libview .js-lib-line .itemsContainer::after { content: none !important; }
    [data-seeall] .sectionTitle { cursor: pointer; }
    [data-seeall] .sectionTitle::after { content: "  See all ›"; font-size: .7em; font-weight: 600; opacity: .7; }
    html.js-pending .homeSectionsContainer > :not(.js-view), html.js-pending .homeSectionsContainer > .js-services { visibility: hidden !important; }
    html.js-phone.js-service-open, html.js-phone.js-service-open body { overflow-x: hidden !important; overscroll-behavior-x: none; }
    html.js-phone .js-view, html.js-phone .js-services { touch-action: pan-y pinch-zoom; }
    html.js-phone .js-view .js-scroller, html.js-phone .js-services .js-scroller { touch-action: pan-x pan-y pinch-zoom; overscroll-behavior-x: contain; }
    html[data-js-brand="prime"] .js-bb-new { display: block; }
    html.js-phone .js-bb-dots { bottom: .8em; }
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
    .js-bb-poster, .js-bb-tags { display: none; }
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
    .js-tshade { position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
      background: linear-gradient(0deg, rgba(0,0,0,.6) 0%, rgba(0,0,0,.15) 38%, transparent 60%); }
    .js-tlogo {
      position: absolute; left: 6%; bottom: 9%;
      max-width: 52%; max-height: 36%; width: auto; height: auto;
      object-fit: contain; object-position: left bottom;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,.7));
      pointer-events: none;
    }
    .js-rank-poster .js-ovl, .js-rank-poster .js-tlogo { z-index: 2; }
    .js-bb-logo { display: block; max-width: min(36vw, 520px); max-height: min(24vh, 220px); width: auto; height: auto; object-fit: contain; object-position: left bottom; filter: drop-shadow(0 4px 18px rgba(0,0,0,.6)); }
    .js-cap-below .cardText { text-align: left !important; padding-left: .15em; }
    .js-cap-below .cardText-first { font-weight: 600; }

    /* the app's own navigation: filters the page to shows or movies */
    .js-view[data-f="movie"] .js-section[data-kind="tv"],
    .js-view[data-f="tv"] .js-section[data-kind="movie"] { display: none !important; }
    .js-tabs { position: absolute; z-index: 3; display: flex; gap: .4em; }
    .js-tab {
      border: none; cursor: pointer; font: inherit; color: rgba(255,255,255,.72);
      background: transparent; padding: .45em .9em; border-radius: 6px;
      display: inline-flex; align-items: center; gap: .5em;
      transition: color .15s ease, background .15s ease;
    }
    .js-tab:hover { color: #fff; }
    .js-tab.on { color: #fff; font-weight: 700; }
    /* top: text links across the top (Netflix, Paramount+) */
    .js-nav-top { top: 1.1em; left: calc(3.3% - .9em); }
    .js-nav-top .js-tab { font-size: 1.05em; }
    /* pill: centered tabs (Disney+ with Hulu) */
    .js-nav-pill { top: 1.1em; left: 50%; transform: translateX(-50%); }
    .js-nav-pill .js-tab { border-radius: 999px; padding: .5em 1.2em; background: rgba(249,249,249,.08); font-weight: 600; }
    .js-nav-pill .js-tab.on { background: #f9f9f9; color: #0e0b14; }
    /* rail: icons down the left edge (HBO Max, Prime Video, Peacock) */
    .js-nav-rail { left: 0; top: 0; bottom: 0; flex-direction: column; justify-content: center; padding: 0 .6em; gap: .3em;
      background: linear-gradient(90deg, rgba(0,0,0,.65), transparent); }
    .js-nav-rail .js-tab { flex-direction: column; gap: .15em; font-size: .72em; padding: .6em .5em; min-width: 4.6em; }
    .js-nav-rail .js-tab .material-icons { font-size: 1.9em; }
    .js-nav-rail .js-tab.on { background: rgba(255,255,255,.14); }
    .js-has-rail .js-bb-content { left: calc(3.3% + 4.5em); }
    /* glass: a floating Liquid Glass capsule (Apple TV) */
    .js-nav-glass { top: 1.1em; left: 50%; transform: translateX(-50%); padding: .3em; border-radius: 999px;
      background: linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,.08));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(255,255,255,.12), 0 10px 30px rgba(0,0,0,.4); }
    html:not(.js-lite) .js-nav-glass { -webkit-backdrop-filter: blur(24px) saturate(190%); backdrop-filter: blur(24px) saturate(190%); }
    .js-nav-glass .js-tab { border-radius: 999px; padding: .5em 1.3em; font-weight: 600; }
    .js-nav-glass .js-tab.on { background: rgba(255,255,255,.9); color: #000; }

    /* phones: everything scaled for a small touch screen */
    .js-view a, .js-services a, .js-tab, .js-bb-btn { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    @media (max-width: 760px) {
      .js-view { --js-poster-w: 96px; }
      .js-bb { height: 62vh !important; min-height: 380px; margin: 0 0 1em !important; border-radius: 0 !important; }
      .js-bb-content { left: 5% !important; right: 5%; width: auto !important; bottom: 7% !important; gap: .5em; }
      .js-bb-title { font-size: 2em !important; }
      .js-bb-overview { -webkit-line-clamp: 2; font-size: .92em; }
      .js-bb-btn { height: 2.6em; font-size: .92em; padding: 0 1.1em !important; }
      .js-tabs, .js-nav-rail, .js-nav-pill, .js-nav-glass {
        top: .7em !important; left: 4% !important; right: auto; bottom: auto !important; transform: none !important;
        flex-direction: row !important; padding: .25em !important; background: rgba(0,0,0,.35); border-radius: 999px;
      }
      .js-nav-rail .js-tab { flex-direction: row; min-width: 0; font-size: .82em; padding: .4em .8em; }
      .js-nav-rail .js-tab .material-icons { display: none; }
      .js-tab { font-size: .82em !important; padding: .4em .8em !important; }
      .js-has-rail .js-bb-content { left: 5% !important; }
      .js-bb .js-hero { top: .7em !important; right: 4% !important; font-size: .72em; }
      .js-bb .js-hero h1 { display: none; }
      .js-view .emby-scroller.js-scroller, .js-services .emby-scroller.js-scroller { padding: 10px 4% 12px !important; }
      .js-view .sectionTitleContainer, .js-services .sectionTitleContainer { padding-left: 4%; }
      .js-view .sectionTitle { font-size: 1.05em !important; }
      .js-services .js-svc-card { width: 72vw !important; }
      .js-view .overflowBackdropCard { width: 62vw !important; }
      .js-view .overflowPortraitCard { width: 30vw !important; }
    }

    /* service intro: plays over the screen while the service page loads */
    html.js-intro-on #__jf_library_focus_ring__, html.js-intro-on [id^="__jf_"][id$="_ring__"],
    html.js-intro-on [class*="focus-ring"], html.js-intro-on [class*="focusRing"] { visibility: hidden !important; opacity: 0 !important; }
    .js-intro {
      position: fixed; inset: 0; z-index: 2147482000;
      display: flex; align-items: center; justify-content: center;
      background: var(--js-intro-bg, #000);
      overflow: hidden;
      opacity: 1;
      transition: opacity .35s ease;
    }
    .js-intro.out { opacity: 0; pointer-events: none; }
    .js-intro-logo {
      position: relative; z-index: 2;
      width: min(30vmin, 250px); height: min(30vmin, 250px);
      border-radius: 22%; object-fit: cover;
      box-shadow: 0 20px 60px rgba(0,0,0,.6);
      animation: js-intro-pop 1.1s cubic-bezier(.2,.9,.25,1) both;
    }
    .js-intro-name {
      position: relative; z-index: 2;
      font: 900 clamp(2em, 8vmin, 5em) / 1 ${FONT}; color: #fff; letter-spacing: -.03em;
      animation: js-intro-pop 1.1s cubic-bezier(.2,.9,.25,1) both;
    }
    .js-intro-fx { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
    @keyframes js-intro-pop { 0% { opacity: 0; transform: scale(.6); } 60% { opacity: 1; transform: scale(1.06); } 100% { opacity: 1; transform: scale(1); } }
    @keyframes js-intro-sweep { from { transform: translateX(-120%) skewX(-20deg); } to { transform: translateX(220%) skewX(-20deg); } }
    @keyframes js-intro-ribbons { 0% { transform: scaleX(0); opacity: 0; } 35% { opacity: 1; } 100% { transform: scaleX(1.4); opacity: 0; } }
    @keyframes js-intro-spin { to { transform: rotate(360deg); } }
    @keyframes js-intro-ring { from { transform: scale(.4); opacity: .9; } to { transform: scale(2.6); opacity: 0; } }
    @keyframes js-intro-arc { from { transform: rotate(-150deg); opacity: 0; } 40% { opacity: 1; } to { transform: rotate(10deg); opacity: 1; } }
    @keyframes js-intro-draw { from { width: 0; } to { width: min(30vmin, 260px); } }
    @keyframes js-intro-burst { 0% { transform: translate(0,0) scale(.2); opacity: 0; } 50% { opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0; } }
    @keyframes js-intro-unblur { from { filter: blur(30px); opacity: 0; transform: scale(1.15); } to { filter: blur(0); opacity: 1; transform: scale(1); } }
    /* netflix: ribbons of red light rush out of the logo, then everything zooms through it */
    @keyframes js-intro-zoom { 0% { transform: scale(1); opacity: 1; } 70% { transform: scale(1.04); opacity: 1; } 100% { transform: scale(5); opacity: 0; } }
    .js-intro-netflix .js-intro-fx::before {
      content: ""; position: absolute; inset: 0;
      background: repeating-linear-gradient(90deg,
        transparent 0 1.6vw, #e50914 1.6vw 2.1vw, transparent 2.1vw 3vw, #ff3d6e 3vw 3.25vw,
        transparent 3.25vw 4.2vw, #b20710 4.2vw 4.9vw, transparent 4.9vw 5.6vw, #ff7aa0 5.6vw 5.8vw);
      filter: blur(1px) drop-shadow(0 0 12px rgba(229,9,20,.9));
      animation: js-intro-ribbons 1.5s cubic-bezier(.6,0,.2,1) .1s both;
      -webkit-mask-image: radial-gradient(55% 60% at 50% 50%, #000 0%, transparent 80%);
      mask-image: radial-gradient(55% 60% at 50% 50%, #000 0%, transparent 80%);
    }
    .js-intro-netflix .js-intro-logo { animation: js-intro-pop .7s cubic-bezier(.2,.9,.25,1) both, js-intro-zoom 1.9s cubic-bezier(.7,0,.3,1) .1s both; }
    /* disney+: a glowing arc swings over the logo through a field of sparkles */
    @keyframes js-intro-twinkle { 0%, 100% { opacity: .15; } 50% { opacity: 1; } }
    .js-intro-disney { background: radial-gradient(80% 70% at 50% 40%, #0b3a8c 0%, #040d2e 60%, #01040f 100%) !important; }
    .js-intro-disney .js-intro-fx::after, .js-intro-paramount .js-intro-fx::after {
      content: ""; position: absolute; inset: 0;
      background-image:
        radial-gradient(1.5px 1.5px at 12% 22%, #fff, transparent), radial-gradient(1px 1px at 28% 72%, #fff, transparent),
        radial-gradient(2px 2px at 42% 14%, #bfe6ff, transparent), radial-gradient(1px 1px at 63% 80%, #fff, transparent),
        radial-gradient(1.5px 1.5px at 78% 30%, #fff, transparent), radial-gradient(2px 2px at 88% 64%, #bfe6ff, transparent),
        radial-gradient(1px 1px at 52% 46%, #fff, transparent), radial-gradient(1.5px 1.5px at 8% 84%, #fff, transparent);
      animation: js-intro-twinkle 1.2s ease-in-out infinite;
    }
    .js-intro-disney .js-intro-fx::before, .js-intro-hulu .js-intro-fx::before {
      content: ""; position: absolute; left: 50%; top: 50%;
      width: min(60vmin, 520px); height: min(60vmin, 520px); margin: calc(min(60vmin, 520px) / -2) 0 0 calc(min(60vmin, 520px) / -2);
      border-radius: 50%; border: 4px solid transparent; border-top-color: var(--js-intro-c1);
      filter: drop-shadow(0 0 10px var(--js-intro-c1)) drop-shadow(0 0 28px var(--js-intro-c1)) drop-shadow(0 0 60px var(--js-intro-c1));
      animation: js-intro-arc 1.3s cubic-bezier(.2,.9,.25,1) both;
    }
    /* hulu: a sweep of hulu green wipes across before the logo lands */
    @keyframes js-intro-wipe { 0% { transform: translateX(-100%); } 45% { transform: translateX(0); } 100% { transform: translateX(100%); } }
    .js-intro-hulu .js-intro-fx::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, #1ce783 35%, #0f9d5a 65%, transparent);
      animation: js-intro-wipe 1.1s cubic-bezier(.7,0,.3,1) both;
    }
    .js-intro-hulu .js-intro-logo { animation-delay: .35s; }
    /* hbo max: deep blue light pulsing out in rings */
    .js-intro-max { background: radial-gradient(70% 60% at 50% 50%, #1238c4 0%, #071a63 45%, #020b2e 100%) !important; }
    .js-intro-max .js-intro-fx::before, .js-intro-max .js-intro-fx::after {
      content: ""; position: absolute; left: 50%; top: 50%; width: 40vmin; height: 40vmin; margin: -20vmin 0 0 -20vmin;
      border-radius: 50%; border: 3px solid rgba(140,170,255,.95); box-shadow: 0 0 40px rgba(43,92,255,.9), inset 0 0 30px rgba(43,92,255,.6);
      animation: js-intro-ring 1.4s ease-out infinite;
    }
    .js-intro-max .js-intro-fx::after { animation-delay: .45s; }
    /* prime video: the smile draws itself under the logo */
    .js-intro-prime { background: radial-gradient(70% 60% at 50% 45%, #13324d 0%, #0f171e 70%) !important; }
    .js-intro-prime .js-intro-fx::before {
      content: ""; position: absolute; left: 50%; top: calc(50% + min(17vmin, 145px)); transform: translateX(-50%);
      height: min(6vmin, 48px); width: 0; border-bottom: 6px solid #1a98ff; border-radius: 0 0 50% 50%;
      filter: drop-shadow(0 0 12px rgba(26,152,255,1));
      animation: js-intro-draw .8s cubic-bezier(.6,0,.2,1) .3s both;
    }
    /* apple tv: the logo resolves out of a blur, then a glass highlight crosses it */
    .js-intro-apple .js-intro-logo, .js-intro-apple .js-intro-name { animation: js-intro-unblur 1s cubic-bezier(.2,.9,.25,1) both; }
    .js-intro-apple .js-intro-fx::before {
      content: ""; position: absolute; top: 0; bottom: 0; width: 26%; z-index: 3;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.38), transparent);
      animation: js-intro-sweep 1.2s ease-in-out .5s both;
    }
    /* paramount+: a ring of stars turns around the logo against a starry night */
    .js-intro-paramount { background: radial-gradient(75% 65% at 50% 45%, #0b3fae 0%, #001a4d 50%, #000a1f 100%) !important; }
    .js-intro-paramount .js-intro-fx::before {
      content: ""; position: absolute; left: 50%; top: 50%;
      width: min(52vmin, 450px); height: min(52vmin, 450px); margin: calc(min(52vmin, 450px) / -2) 0 0 calc(min(52vmin, 450px) / -2);
      border-radius: 50%;
      background: repeating-conic-gradient(from 0deg, #fff 0 1.6deg, transparent 1.6deg 14deg);
      -webkit-mask-image: radial-gradient(closest-side, transparent 86%, #000 88%, #000 96%, transparent 98%);
      mask-image: radial-gradient(closest-side, transparent 86%, #000 88%, #000 96%, transparent 98%);
      filter: drop-shadow(0 0 10px #7fb2ff);
      animation: js-intro-spin 3s linear infinite, js-intro-pop .9s ease both;
    }
    /* peacock: the six feathers fan out from the logo */
    .js-intro-peacock .js-intro-fx i {
      position: absolute; left: 50%; top: 50%; width: 7vmin; height: 7vmin; margin: -3.5vmin 0 0 -3.5vmin;
      border-radius: 50%; box-shadow: 0 0 24px currentColor;
      animation: js-intro-burst 1.3s cubic-bezier(.2,.9,.25,1) .15s both;
    }
    /* anything else: a sweep of light in the service's color */
    /* Jellyfin intro: light on black, then a dive through the logo */
    .js-jf { background: transparent !important; flex-direction: column; }
    .js-jf-black { position: absolute; inset: 0; background: #000; }
    .js-jf.diving .js-jf-black { display: none; }
    .js-jf.flying .js-jf-push { animation: none; transform: scale(1.01); }
    .js-jf.flying .jf-sweep { visibility: hidden; }
    .js-switcher .js-current a.js-sw-tab.js-jf-waiting, .js-services a.js-sw-tab.js-jf-waiting { background: #000 !important; box-shadow: 0 0 0 1px rgba(255,255,255,.12) !important; }
    .js-services a.js-jf-waiting .js-sw-logo, .js-services a.js-jf-waiting .js-sw-name { visibility: hidden !important; }
    .js-jf-hole { position: absolute; inset: 0; z-index: 0; display: block; }
    .js-jf-bloom { position: absolute; left: 50%; top: 45%; width: 90vmin; height: 90vmin; margin: -45vmin; border-radius: 50%; pointer-events: none; opacity: 0;
      background: radial-gradient(closest-side, rgba(120,80,210,.28), rgba(0,140,210,.1) 55%, transparent); }
    html.js-lite .js-jf-bloom { display: none; }
    .js-jf-logo { position: relative; z-index: 1; width: clamp(160px, 32vmin, 300px); margin-top: -3vmin; will-change: transform; }
    .js-jf-push { transform: scale(.95); }
    .js-jf-svg { display: block; width: 100%; height: auto; overflow: visible; }
    .js-jf .jf-trace { stroke-dasharray: 1; stroke-dashoffset: 1; stroke-linejoin: round; stroke-linecap: round; opacity: 0; }
    html:not(.js-lite) .js-jf .jf-trace { filter: drop-shadow(0 0 5px rgba(140,170,255,.85)); }
    .js-jf .jf-fill { opacity: 0; }
    .js-jf .jf-core { opacity: 0; transform-box: fill-box; transform-origin: 50% 62%; transform: scale(.7); }
    .js-jf-name { position: relative; z-index: 1; margin-top: 3.4vmin; font-family: "SF Pro Display", "Segoe UI Variable Display", "Helvetica Neue", Inter, Roboto, "Segoe UI", Arial, sans-serif; font-weight: 600; font-size: clamp(26px, 6vmin, 52px); line-height: 1;
      color: #fff; letter-spacing: -.01em; white-space: nowrap; opacity: 0; -webkit-font-smoothing: antialiased;
      -webkit-mask-image: linear-gradient(90deg, #000 42%, transparent 58%); mask-image: linear-gradient(90deg, #000 42%, transparent 58%);
      -webkit-mask-size: 300% 100%; mask-size: 300% 100%; -webkit-mask-position: 100% 0; mask-position: 100% 0; }
    .js-jf.go .jf-trace { animation: js-jf-trace calc(1.05s * var(--jf-k, 1)) cubic-bezier(.65,0,.35,1) calc(0.15s * var(--jf-k, 1)) forwards, js-jf-trace-off calc(0.6s * var(--jf-k, 1)) ease calc(1.2s * var(--jf-k, 1)) forwards; }
    .js-jf.go .jf-fill { animation: js-jf-on calc(0.7s * var(--jf-k, 1)) ease-out calc(1.1s * var(--jf-k, 1)) forwards; }
    .js-jf.go .jf-core { animation: js-jf-core calc(0.9s * var(--jf-k, 1)) cubic-bezier(.2,.8,.2,1) calc(1.28s * var(--jf-k, 1)) forwards; }
    .js-jf.go .jf-sweep { animation: js-jf-sweep calc(1.4s * var(--jf-k, 1)) cubic-bezier(.45,0,.25,1) calc(1.8s * var(--jf-k, 1)) forwards; }
    .js-jf.go .js-jf-bloom { animation: js-jf-bloom calc(1.9s * var(--jf-k, 1)) cubic-bezier(.2,.8,.2,1) calc(1.15s * var(--jf-k, 1)) forwards; }
    .js-jf.go .js-jf-push { animation: js-jf-push calc(4s * var(--jf-k, 1)) linear forwards; }
    .js-jf.go .js-jf-name { animation: js-jf-name calc(1.2s * var(--jf-k, 1)) cubic-bezier(.4,0,.2,1) calc(1.55s * var(--jf-k, 1)) forwards; }
    /* light chatter: specks wander, then pull together into the logo as the voices converge */
    .js-jf-chatter { position: absolute; left: 50%; top: 55%; width: 0; height: 0; pointer-events: none; }
    .js-jf-chatter b { position: absolute; left: 0; top: 0; width: 0; height: 0; transform: rotate(var(--a0)); will-change: transform; }
    /* each speck is a short streak of light trailing behind it as it circles in */
    .js-jf-chatter i { position: absolute; left: -1.5px; top: -28px; width: 3px; height: 30px; border-radius: 3px; opacity: 0; will-change: transform, opacity;
      background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--c) 55%, transparent) 55%, var(--c) 88%, #fff);
      transform-origin: 50% 100%; transform: translateX(var(--r)); }
    html.js-lite .js-jf-chatter i { height: 18px; top: -16px; }
    .js-jf.go .js-jf-chatter b { animation: js-jf-orbit calc(1.2s * var(--jf-k, 1) - var(--d)) cubic-bezier(.3,0,.8,.55) var(--d) forwards; }
    .js-jf.go .js-jf-chatter i { animation: js-jf-inward calc(1.2s * var(--jf-k, 1) - var(--d)) cubic-bezier(.45,0,.85,.45) var(--d) forwards,
      js-jf-speck calc(1.2s * var(--jf-k, 1) - var(--d)) linear var(--d) forwards; }
    @keyframes js-jf-orbit { to { transform: rotate(var(--a1)); } }
    @keyframes js-jf-inward { to { transform: translateX(0) scaleY(.3); } }
    @keyframes js-jf-speck { 0% { opacity: 0; } 14% { opacity: .95; } 92% { opacity: 1; } 100% { opacity: 0; } }
    /* slow beams of light turning behind the logo once it lands */
    .js-jf-rays { position: absolute; left: 50%; top: 55%; width: 420%; aspect-ratio: 1; transform: translate(-50%, -50%) rotate(0deg) scale(.6); pointer-events: none; opacity: 0;
      background: repeating-conic-gradient(from 0deg, rgba(170,140,255,.16) 0deg 2.2deg, transparent 2.2deg 13deg, rgba(0,164,220,.12) 13deg 14.6deg, transparent 14.6deg 24deg);
      -webkit-mask: radial-gradient(closest-side, #000 8%, rgba(0,0,0,.5) 30%, transparent 70%); mask: radial-gradient(closest-side, #000 8%, rgba(0,0,0,.5) 30%, transparent 70%); }
    html.js-lite .js-jf-rays { display: none; }
    .js-jf.go .js-jf-rays { animation: js-jf-rays calc(4.2s * var(--jf-k, 1)) cubic-bezier(.2,.7,.3,1) calc(1.15s * var(--jf-k, 1)) forwards; }
    @keyframes js-jf-rays { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(-8deg) scale(.6); } 25% { opacity: 1; } 100% { opacity: .85; transform: translate(-50%, -50%) rotate(14deg) scale(1); } }
    .js-jf.flying .js-jf-rays, .js-jf.diving .js-jf-rays { opacity: 0 !important; transition: opacity .3s ease; }
    /* the flare when it all lands */
    .js-jf-flare { position: absolute; left: 50%; top: 55%; width: 260%; height: 260%; transform: translate(-50%, -50%) scale(.2); border-radius: 50%; pointer-events: none; opacity: 0;
      background: radial-gradient(closest-side, rgba(255,255,255,.55), rgba(170,140,255,.28) 25%, rgba(0,164,220,.1) 55%, transparent 72%); }
    .js-jf.go .js-jf-flare { animation: js-jf-flare calc(1.3s * var(--jf-k, 1)) cubic-bezier(.1,.7,.2,1) calc(1.18s * var(--jf-k, 1)) forwards; }
    @keyframes js-jf-flare { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.2); } 12% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.3); } }
    @keyframes js-jf-bloom { 0% { opacity: 0; transform: scale(.7); } 100% { opacity: 1; transform: scale(1); } }
    .js-jf.diving .js-jf-name, .js-jf.diving .js-jf-bloom { opacity: 0 !important; transition: opacity .2s ease; }
    .js-jf.diving .jf-core { opacity: 0 !important; transition: opacity .3s ease; }
    @keyframes js-jf-trace { 0% { opacity: 0; stroke-dashoffset: 1; } 10% { opacity: 1; } 100% { opacity: 1; stroke-dashoffset: 0; } }
    @keyframes js-jf-trace-off { to { opacity: 0; } }
    @keyframes js-jf-on { to { opacity: 1; } }
    @keyframes js-jf-core { to { opacity: 1; transform: none; } }
    @keyframes js-jf-sweep { to { transform: translateX(780px); } }
    @keyframes js-jf-push { to { transform: scale(1.01); } }
    @keyframes js-jf-name { 0% { opacity: 1; transform: translateY(.12em); -webkit-mask-position: 100% 0; mask-position: 100% 0; } 100% { opacity: 1; transform: none; -webkit-mask-position: 0 0; mask-position: 0 0; } }
    @media (prefers-reduced-motion: reduce) {
      .js-jf.go * { animation: none !important; }
      .js-jf .jf-fill, .js-jf .jf-core, .js-jf-name { opacity: 1 !important; transform: none !important; -webkit-mask: none !important; mask: none !important; }
    }
    .js-switcher svg.js-sw-logo { display: block; }
    .js-intro-generic .js-intro-fx::before {
      content: ""; position: absolute; top: 0; bottom: 0; width: 35%;
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--js-intro-c1) 60%, transparent), transparent);
      animation: js-intro-sweep 1.2s ease-in-out .15s both;
    }
    @media (prefers-reduced-motion: reduce) { .js-intro-fx { display: none; } .js-intro-logo, .js-intro-name { animation: none; } }

    /* each service sizes and spaces its rows its own way (vars set per brand) */
    @media (min-width: 761px) {
      .js-view .js-lib.overflowBackdropCard { width: var(--js-land-w, clamp(220px, 17vw, 320px)) !important; }
      .js-view .js-lib.overflowPortraitCard { width: var(--js-port-w, clamp(130px, 10.5vw, 200px)) !important; }
    }
    .js-view .js-lib .cardBox { margin-left: var(--js-gap, .3em) !important; margin-right: var(--js-gap, .3em) !important; }
    /* themes that frame or tint every card don't get to on service pages */
    .js-view .cardBox, .js-view .cardScalable, .js-switcher .card, .js-switcher .cardBox, .js-switcher .cardScalable {
      border: 0 !important; outline: 0 !important; background: transparent !important; box-shadow: none !important;
    }
    .js-view .cardBox::before, .js-view .cardBox::after, .js-switcher .card::before, .js-switcher .card::after,
    .js-switcher .cardBox::before, .js-switcher .cardBox::after { display: none !important; }
    .js-view.js-leaving { opacity: .55; transition: opacity .2s ease; pointer-events: none; }

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
      font-size: calc(var(--js-rank-ph, calc(var(--js-poster-w) * 1.5)) * .95);
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
      width: var(--js-rank-pw, var(--js-poster-w)) !important;
      height: 100% !important;
      z-index: 1;
      background-size: cover;
      background-position: center;
      border-radius: 4px;
      box-shadow: -8px 0 18px rgba(0,0,0,.45);
    }
    .js-rank-card .js-badge { z-index: 3; }
    .js-rank-card .cardFooter { display: none !important; }
    .js-rank-cap { align-items: baseline; gap: .45em; padding: .55em .1em 0 calc(100% - var(--js-rank-pw, var(--js-poster-w))); text-align: left; }
    .js-rank-cap b { font-size: 1.5em; font-weight: 700; line-height: 1; }
    .js-rank-cap .cardText { padding: 0 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.75); }
    .js-view .js-rank-card:is(:hover,:focus-within,.show-focus,.focused) .js-rank-poster { transform: scale(1.04); }
    .js-rank-poster { transition: transform .22s cubic-bezier(.2,.9,.25,1), box-shadow .22s ease; }

    /* service switcher: Home + every service as one even row of chips, reachable with a remote */
    .js-switcher .sectionTitleContainer { display: none !important; }
    .js-switcher .js-scroller { padding-top: 6px !important; padding-bottom: 10px !important; }
    .js-switcher .js-sw-card { width: auto !important; min-width: 0 !important; max-width: none !important; }
    .js-switcher .cardBox { margin: 0 .3em 0 0 !important; }
    .js-switcher .cardScalable { position: static !important; padding: 0 !important; }
    .js-switcher .js-sw-tab {
      position: relative !important; inset: auto !important;
      display: inline-flex !important; align-items: center; gap: .6em;
      width: auto !important; height: 3em !important; padding: 0 1.25em 0 .45em !important; box-sizing: border-box;
      border-radius: 999px !important; white-space: nowrap !important; overflow: visible !important; text-decoration: none;
      font: 700 1em/1 ${FONT};
      color: rgba(255,255,255,.85) !important;
      background: rgba(255,255,255,.08) !important;
      border: 1px solid rgba(255,255,255,.14) !important;
      box-shadow: none !important;
      transition: background .15s ease, color .15s ease, box-shadow .15s ease, transform .15s ease;
    }
    .js-switcher .js-sw-logo { width: 2.2em; height: 2.2em; border-radius: 50%; object-fit: cover; flex: none; box-shadow: 0 0 0 1px rgba(255,255,255,.18); }
    .js-switcher .js-sw-icon { width: 2.2em; height: 2.2em; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(255,255,255,.12); font-size: 1.2em; flex: none; }
    .js-switcher .js-sw-dot { width: .7em; height: .7em; margin: 0 .3em 0 .5em; border-radius: 50%; background: var(--js-sw, #fff); flex: none; }
    .js-switcher .js-sw-name { display: inline-block !important; overflow: visible !important; text-overflow: clip !important; }
    .js-switcher .js-sw-card:is(:hover, :focus-within, .show-focus, .focused) .js-sw-tab {
      color: #fff !important; background: rgba(255,255,255,.16) !important;
      box-shadow: 0 0 0 2px rgba(255,255,255,.9) !important; transform: translateY(-1px);
    }
    .js-switcher .js-current .js-sw-tab {
      color: var(--js-sw-ink, #fff) !important; border-color: transparent !important;
      background: var(--js-sw, rgba(255,255,255,.2)) !important;
      box-shadow: 0 6px 18px color-mix(in srgb, var(--js-sw, #000) 45%, transparent) !important;
    }
    @media (max-width: 760px) { .js-switcher .js-sw-tab { height: 2.6em !important; font-size: .9em; } }
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

  // ---------------------------------------------------------------- diagnostics panel
  const diagEnabled = () => {
    try { if (localStorage.getItem('jellystream-debug') === '1') return true; } catch { /* ignore */ }
    return !!state.cfg?.Diagnostics;
  };
  const diagCss = document.createElement('style');
  diagCss.textContent = `
    .jsd-btn { position: fixed; left: 10px; bottom: 10px; z-index: 2147483000; font: 700 12px/1 system-ui, sans-serif;
      padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.3); background: #c62828; color: #fff; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,.5); }
    .jsd-panel { position: fixed; left: 10px; right: 10px; bottom: 50px; top: 12vh; z-index: 2147483000; display: flex; flex-direction: column; gap: 8px;
      padding: 10px; border-radius: 12px; background: rgba(12,12,14,.97); border: 1px solid rgba(255,255,255,.2); color: #fff; font: 13px system-ui, sans-serif; }
    .jsd-panel textarea { flex: 1; width: 100%; box-sizing: border-box; resize: none; background: #000; color: #b9f6ca;
      font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; border: 1px solid #333; border-radius: 6px; padding: 6px; white-space: pre; }
    .jsd-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .jsd-row button { font: 600 13px system-ui, sans-serif; padding: 8px 12px; border-radius: 8px; border: 0; background: #2b2f38; color: #fff; cursor: pointer; }
    .jsd-row button.jsd-main { background: #1e88e5; }
    .jsd-row span { opacity: .7; margin-left: auto; }`;
  document.head.appendChild(diagCss);
  const diagUi = () => {
    let btn = document.querySelector('.jsd-btn');
    if (!diagEnabled()) { btn?.remove(); document.querySelector('.jsd-panel')?.remove(); return; }
    if (btn) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jsd-btn';
    btn.textContent = 'JellyStream diagnostics';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = document.querySelector('.jsd-panel');
      if (open) { open.remove(); diag.onAdd = null; return; }
      diag.snapshot('panel opened');
      const panel = document.createElement('div');
      panel.className = 'jsd-panel';
      panel.innerHTML = `
        <div class="jsd-row"><b>JellyStream diagnostics</b><span>client ${VERSION}</span></div>
        <textarea readonly spellcheck="false"></textarea>
        <div class="jsd-row">
          <button type="button" class="jsd-main" data-a="send">Send to server log</button>
          <button type="button" data-a="copy">Copy</button>
          <button type="button" data-a="snap">Snapshot</button>
          <button type="button" data-a="clear">Clear</button>
          <button type="button" data-a="close">Close</button>
          <span class="jsd-status"></span>
        </div>`;
      const ta = panel.querySelector('textarea');
      const status = panel.querySelector('.jsd-status');
      const fill = () => { ta.value = diag.dump(); ta.scrollTop = ta.scrollHeight; };
      fill();
      diag.onAdd = () => requestAnimationFrame(fill);
      panel.addEventListener('click', async (ev) => {
        const a = ev.target.closest('button')?.dataset.a;
        if (!a) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (a === 'close') { panel.remove(); diag.onAdd = null; }
        if (a === 'clear') diag.clear();
        if (a === 'snap') diag.snapshot('manual');
        if (a === 'copy') {
          ta.focus(); ta.select();
          let ok = false;
          try { await navigator.clipboard.writeText(ta.value); ok = true; } catch { ok = document.execCommand?.('copy'); }
          status.textContent = ok ? 'Copied' : 'Select the text and copy it';
        }
        if (a === 'send') {
          status.textContent = 'Sending…';
          try {
            await window.ApiClient.ajax({ type: 'POST', url: api('Client/Log'), data: JSON.stringify({ Message: `diagnostics from ${navigator.userAgent}\n${diag.dump()}` }), contentType: 'application/json' });
            status.textContent = 'Sent: look for "JellyStream web client" in the Jellyfin log';
          } catch (err) {
            status.textContent = `Couldn't send (${err?.status || err?.message || err}); use Copy`;
          }
        }
      }, true);
      // keep Jellyfin and other scripts from treating typing/clicks in the panel as navigation
      for (const ev of ['keydown', 'keyup']) panel.addEventListener(ev, (x) => x.stopPropagation());
      document.body.appendChild(panel);
    }, true);
    document.body.appendChild(btn);
  };
  setInterval(diagUi, 2000);

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
  // With the image's tag in the address Jellyfin lets the browser keep it, so posters come straight
  // from the cache after the first visit; sizes match what the rows actually show.
  const imgUrl = (id, tag) => window.ApiClient.getImageUrl(id, { type: 'Primary', fillHeight: 420, quality: 82, ...(tag ? { tag } : {}) });
  const backdropUrl = (id, tag) => window.ApiClient.getImageUrl(id, { type: 'Backdrop', fillWidth: 640, quality: 80, ...(tag ? { tag } : {}) });
  const thumbUrl = (id, tag) => window.ApiClient.getImageUrl(id, { type: 'Thumb', fillWidth: 640, quality: 80, ...(tag ? { tag } : {}) });
  const logoUrl = (id, tag) => window.ApiClient.getImageUrl(id, { type: 'Logo', maxWidth: 400, quality: 90, ...(tag ? { tag } : {}) });
  const wideUrl = (id, tags = {}) => (tags.backdrop ? `${backdropUrl(id, tags.backdrop)}|` : '') + imgUrl(id, tags.primary);

  // the look of the open service (cards are built after applyBrand runs)
  const look = () => {
    const k = document.documentElement.dataset.jsBrand;
    return (k && BRANDS[k]) || GENERIC;
  };

  // On wide art the title is always visible: the title's own logo when Jellyfin has one, else its name.
  // Art that already carries the title (a "thumb") gets neither.
  const titleOnArt = ({ name, shape, caption, logo, titled }) => {
    if (titled) return '';
    if (logo) return `<span class="js-tshade"></span><img class="js-tlogo" src="${esc(logo)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;js-ovl&quot;>${esc(esc(name))}</span>'">`;
    if (caption === 'overlay' || (shape === 'landscape' && caption !== 'below')) return `<span class="js-ovl">${esc(name)}</span>`;
    return '';
  };
  // ---- Netflix-style badges, from the library: added in the last two weeks, a show's new episode, Top 10 rank
  const DAY = 864e5;
  const normId = (id) => String(id || '').replace(/-/g, '').toLowerCase();
  const flagsFor = (id) => {
    const it = state.lib?.get(normId(id));
    if (!it) return {};
    const now = Date.now();
    const added = Date.parse(it.Added) || 0;
    const last = it.LastAdded ? Date.parse(it.LastAdded) || 0 : 0;
    const recent = now - added < 14 * DAY;
    return { recent, newEp: it.Type === 'tv' && !recent && now - last < 14 * DAY };
  };
  const badgesFor = (id, inTopRow) => {
    if (!look().badges) return '';
    const f = id ? flagsFor(id) : {};
    const r = id ? state.ranks?.get(normId(id)) : null;
    const poster = f.recent ? '<span class="js-nf-pb">Recently Added</span>'
      : f.newEp ? '<span class="js-nf-pb js-nf-ep">New Episode<b>Watch Now</b></span>' : '';
    const corner = r && !inTopRow ? '<span class="js-nf-top">TOP<b>10</b></span>' : '';
    const pills = [
      f.recent ? '<span class="js-nf-pill"><i class="js-nf-ico-new"></i>Recently Added</span>' : '',
      f.newEp ? '<span class="js-nf-pill"><i class="js-nf-ico-new"></i>New Episode</span>' : '',
      r ? `<span class="js-nf-pill"><i class="js-nf-ico-top">TOP<b>10</b></i>#${r.n} in ${r.kind === 'tv' ? 'TV Shows' : 'Movies'}</span>` : '',
    ].join('');
    return `${poster}${corner}${pills ? `<span class="js-nf-ob">${pills}</span>` : ''}`;
  };
  // Disney+-style line at the bottom of a card: rating box, year, first genre
  const cardMeta = (lib, year) => {
    if (!look().cardMeta) return '';
    const cert = lib?.Certification;
    const text = [lib?.Year || year, lib?.Genres?.[0]].filter(Boolean).join(' • ');
    if (!cert && !text) return '';
    return `<span class="js-dmeta">${cert ? `<b class="js-cert">${esc(cert)}</b>` : ''}${esc(text)}</span>`;
  };
  // what a card opens into when selected (services with focusExpand): wide art plus the title's logo
  const wideAttrs = (id, tags, fallback = '') => {
    if (!look().focusExpand || !id) return fallback ? `data-wide="${esc(fallback)}"` : '';
    const w = wideArt(id, tags);
    return `data-wide="${esc(w.img + (fallback ? `|${fallback}` : ''))}"${w.logo ? ` data-logo="${esc(w.logo)}"` : ''}`;
  };

  const card = ({ id, name, sub, img, href, cls = '', attrs = '', badge = '', type = '', shape = 'portrait', caption = 'below', logo = null, titled = false, extra = '' }) => `
    <div class="card ${shape === 'landscape' ? 'overflowBackdropCard' : 'overflowPortraitCard'} card-hoverable js-card js-cap-${caption} ${cls}" ${id ? `data-id="${esc(id)}" data-serverid="${esc(serverId())}"` : ''} ${type ? `data-type="${type}"` : ''} ${attrs}>
      <div class="cardBox cardBox-bottompadded">
        <div class="cardScalable">
          <div class="cardPadder ${shape === 'landscape' ? 'cardPadder-overflowBackdrop' : 'cardPadder-overflowPortrait'}"></div>
          <a class="cardImageContainer coveredImage cardContent itemAction js-img" href="${esc(href)}" aria-label="${esc(name)}" ${img ? `data-src="${esc(img)}"` : ''}>${titleOnArt({ name, shape, caption, logo, titled })}${extra}</a>
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
  // wide art for an item: its thumb (art with the title on it) when it has one, else backdrop + logo
  const wideArt = (id, tags) => {
    if (tags.ThumbTag) return { img: `${thumbUrl(id, tags.ThumbTag)}|${imgUrl(id, tags.PrimaryTag)}`, titled: true, logo: null };
    return { img: wideUrl(id, { backdrop: tags.BackdropTag, primary: tags.PrimaryTag }), titled: false, logo: tags.LogoTag ? logoUrl(id, tags.LogoTag) : null };
  };
  const libraryCard = (it) => {
    const l0 = look();
    const l = isPhone() && l0.shapePhone ? { ...l0, shape: l0.shapePhone } : l0;
    const w = l.shape === 'landscape' ? wideArt(it.Id, it) : null;
    return card({
      id: it.Id,
      name: it.Name,
      sub: it.Year || '',
      img: w ? w.img : imgUrl(it.Id, it.PrimaryTag),
      logo: w?.logo,
      titled: w?.titled,
      href: detailsHref(it.Id),
      type: it.Type === 'tv' ? 'Series' : 'Movie',
      cls: 'js-lib',
      shape: l.shape,
      caption: l.caption,
      attrs: l.shape === 'portrait' ? wideAttrs(it.Id, it) : '',
      extra: badgesFor(it.Id, false) + cardMeta(it),
    });
  };

  const BADGES = {
    missing: '<span class="js-badge" title="Not in your library"><span class="material-icons">add</span></span>',
    requested: '<span class="js-badge js-requested" title="Requested"><span class="material-icons">schedule</span></span>',
    partial: '<span class="js-badge" title="Partly available"><span class="material-icons">timelapse</span></span>',
  };

  // Top 10 card: a big rank numeral with the poster tucked against it, styled per service
  // inline !important beats any theme rule that sizes .card / .cardScalable / .cardImageContainer
  // sizes come from per-service variables: --js-rank-pw/-ph (the art) and --js-rank-cw (the whole slot)
  const RANK_CARD_STYLE = 'width:var(--js-rank-cw, calc(var(--js-poster-w, 150px) * 1.62)) !important;min-width:var(--js-rank-cw, calc(var(--js-poster-w, 150px) * 1.62)) !important;max-width:none !important;flex:0 0 auto !important;';
  const RANK_BOX_STYLE = 'position:relative !important;width:100% !important;height:var(--js-rank-ph, calc(var(--js-poster-w, 150px) * 1.5)) !important;padding:0 !important;overflow:visible !important;';
  const RANK_POSTER_STYLE = 'position:absolute !important;top:0 !important;bottom:0 !important;right:0 !important;left:auto !important;width:var(--js-rank-pw, var(--js-poster-w, 150px)) !important;height:100% !important;';
  const rankCard = (t, i) => {
    const owned = !!t.ItemId;
    const land = look().rankShape === 'landscape';
    const w = land && owned ? wideArt(t.ItemId, t) : null;
    const art = land
      ? (owned ? `${w.img}|${t.Backdrop || ''}` : `${t.Backdrop || ''}|${t.Poster || ''}`)
      : (owned ? `${imgUrl(t.ItemId, t.PrimaryTag)}|${t.Poster || ''}` : (t.Poster || ''));
    const onArt = land ? titleOnArt({ name: t.Name, shape: 'landscape', caption: look().rankCaption || 'overlay', logo: w?.logo, titled: w?.titled }) : '';
    const status = owned ? '' : (t.Status === 'available' ? 'missing' : t.Status);
    const opens = land ? '' : (owned ? wideAttrs(t.ItemId, t, t.Backdrop || '') : (look().focusExpand && t.Backdrop ? `data-wide="${esc(`${t.Backdrop}|${t.Poster || ''}`)}"` : ''));
    const rankPills = (look().badges ? (owned ? badgesFor(t.ItemId, true) : '') : '')
      + cardMeta(owned ? state.lib?.get(normId(t.ItemId)) : null, t.Year);
    return `
    <div class="card js-card js-rank-card${land ? ' js-rank-land' : ''}${owned ? '' : ' js-missing'}" style="${RANK_CARD_STYLE}" ${opens} ${owned ? `data-id="${esc(t.ItemId)}" data-serverid="${esc(serverId())}" data-type="${t.Type === 'tv' ? 'Series' : 'Movie'}"` : `data-jstmdb="${t.TmdbId}" data-jstype="${t.Type}" data-jsstatus="${status}"`}>
      <div class="cardBox">
        <div class="cardScalable js-rank-box" style="${RANK_BOX_STYLE}">
          <span class="js-rank-num" aria-hidden="true">${i + 1}</span>
          <a class="cardImageContainer cardContent itemAction js-img js-rank-poster" style="${RANK_POSTER_STYLE}" href="${owned ? esc(detailsHref(t.ItemId)) : '#'}" aria-label="${esc(t.Name)}" data-src="${esc(art)}">${onArt}${rankPills}</a>
          ${owned ? (t.Status === 'partial' ? BADGES.partial : '') : (BADGES[status] || BADGES.missing)}
        </div>
        <div class="cardFooter js-rank-cap"><b>${i + 1}</b><span class="cardText cardText-first"><bdi>${esc(t.Name)}</bdi></span></div>
      </div>
    </div>`;
  };
  // one card per title (and per library item), whatever the server sent
  const uniqueTop = (list) => {
    const seen = new Set();
    return (list || []).filter((t) => {
      const k = t.ItemId ? `i${t.ItemId}` : `t${t.Type}${t.TmdbId}`;
      if (seen.has(k) || (!t.ItemId && !t.Poster)) return false;
      seen.add(k);
      return true;
    });
  };

  // wide = use the service's card shape (request rows); Top 10 rows stay portrait
  const titleCard = (t, wide = false) => {
    const l = look();
    const landscape = wide && l.shape === 'landscape';
    const caption = wide ? l.caption : 'below';
    if (t.ItemId) {
      const w = landscape ? wideArt(t.ItemId, t) : null;
      return card({
        id: t.ItemId, name: t.Name, sub: t.Year || '',
        img: w ? w.img : imgUrl(t.ItemId, t.PrimaryTag), logo: w?.logo, titled: w?.titled,
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
  // Phones (classic layout): Jellyfin turns any sideways swipe on the home screen into "next tab"
  // unless it starts on one of its own scroll rows. Swiping our rows or page then switched tabs
  // underneath the service page and left the screen blank. Keep our touches to ourselves; scrolling
  // and taps are untouched (nothing is prevented, the event just doesn't reach Jellyfin's swipe watcher).
  // Every stage of the gesture is kept in (some tab-swipe watchers only look at the end, or use
  // pointer events), and the banner's own swipe is handled right here, since nothing below sees it.
  const OURS = '.js-view, .js-services, .js-switcher';
  let swipe = null;
  const ours = (e) => !!e.target?.closest?.(OURS);
  addEventListener('touchstart', (e) => {
    if (!ours(e)) { swipe = null; return; }
    e.stopPropagation();
    const t = e.touches[0];
    const bb = e.target.closest('.js-bb');
    swipe = t ? { x: t.clientX, y: t.clientY, bb } : null;
  }, { capture: true, passive: true });
  for (const type of ['touchmove', 'touchcancel']) {
    addEventListener(type, (e) => { if (ours(e)) e.stopPropagation(); }, { capture: true, passive: true });
  }
  addEventListener('touchend', (e) => {
    if (!ours(e)) return;
    e.stopPropagation();
    const t = e.changedTouches[0];
    if (swipe?.bb && t) {
      const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
      if (Math.abs(dx) > 45 && Math.abs(dy) < 60) swipe.bb.dispatchEvent(new CustomEvent('js-swipe', { detail: dx < 0 ? 1 : -1 }));
    }
    swipe = null;
  }, { capture: true, passive: true });
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    addEventListener(type, (e) => { if (e.pointerType === 'touch' && ours(e)) e.stopPropagation(); }, { capture: true, passive: true });
  }

  // Shift + mouse wheel scrolls a row sideways (trackpads scroll sideways on their own)
  document.addEventListener('wheel', (e) => {
    const sc = e.target.closest?.('.js-scroller');
    if (!sc || !e.shiftKey || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    sc.scrollBy({ left: e.deltaY, behavior: 'auto' });
    e.preventDefault();
  }, { passive: false });

  // ---------------------------------------------------------------- focus card (Netflix TV style)
  // The selected title opens into a wide card (its landscape art and logo, white frame, badges) and its
  // details appear under the row. Follows JellyNav's selection, the keyboard, and the mouse.
  const focusOn = () => !!look().focusExpand && !isPhone();
  const EXPANDABLE = '.js-view .js-rows .js-lib.overflowPortraitCard, .js-view .js-rows .js-rank-card:not(.js-rank-land)';
  const WIDE = 2.667; // a portrait card's height as a 16:9 width
  let nfCard = null;
  let nfTimer = null;
  const nfDetailsCache = new Map();
  const nfDetails = (card) => {
    const id = card.dataset.id;
    const key = id || `${card.dataset.jstype}:${card.dataset.jstmdb}`;
    if (!nfDetailsCache.has(key)) {
      nfDetailsCache.set(key, Promise.resolve(id
        ? window.ApiClient.getItem(userId(), id)
        : getJSON(`Details?type=${card.dataset.jstype}&tmdbId=${card.dataset.jstmdb}`)).catch(() => null));
    }
    return nfDetailsCache.get(key);
  };
  const metaLine = (d) => {
    const tv = /^(series|tv)$/i.test(d.Type || '');
    if (document.documentElement.dataset.jsBrand === 'disney') {
      return `${d.OfficialRating ? `<b class="js-cert">${esc(d.OfficialRating)}</b>` : ''}<span>${esc([d.ProductionYear, (d.Genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' • '))}</span>`;
    }
    const parts = [tv ? 'Show' : 'Movie'];
    if (d.Genres?.[0]) parts.push(d.Genres[0]);
    if (d.ProductionYear) parts.push(d.ProductionYear);
    if (tv && d.ChildCount) parts.push(`${d.ChildCount} Season${d.ChildCount === 1 ? '' : 's'}`);
    if (!tv && d.RunTimeTicks) {
      const m = Math.round(d.RunTimeTicks / 6e8);
      parts.push(m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
    }
    if (d.OfficialRating) parts.push(d.OfficialRating);
    return parts.map((x) => `<span>${esc(x)}</span>`).join('<i>•</i>');
  };
  const nfClose = () => {
    const c = nfCard;
    nfCard = null;
    if (!c) return;
    c.classList.remove('js-open');
    c.__jsClosedAt = performance.now();
    document.documentElement.classList.remove('js-nf-card-open');
    // rank cards carry their size inline (from the rank variables), so only the overrides come off
    const props = c.classList.contains('js-rank-card') ? ['--js-rank-cw', '--js-rank-pw'] : ['width', 'min-width'];
    for (const p of props) c.style.removeProperty(p);
    // hold the height while the card narrows back (a % padding would balloon as the width animates), then let go
    const padder = c.querySelector('.cardPadder');
    if (padder) {
      clearTimeout(c.__jsPadT);
      c.__jsPadT = setTimeout(() => { if (!c.classList.contains('js-open')) padder.style.removeProperty('padding-bottom'); }, 360);
    }
    const art = c.querySelector('.js-img');
    if (art?.dataset.src && art.style.backgroundImage) art.style.backgroundImage = bgOf(art.dataset.src);
    art?.querySelector('.js-nf-wide')?.remove();
    c.closest('.js-section')?.querySelector(':scope > .js-nf-info')?.remove();
  };
  const nfReset = () => { nfCard = null; clearTimeout(nfTimer); document.documentElement.classList.remove('js-nf-card-open'); };
  const nfOpen = (card, scroll) => {
    if (!card || card === nfCard || !focusOn() || !card.isConnected) return;
    nfClose();
    nfCard = card;
    card.classList.add('js-open');
    document.documentElement.classList.add('js-nf-card-open');
    if (card.classList.contains('js-rank-card')) {
      card.style.setProperty('--js-rank-pw', `calc(var(--js-poster-w, 150px) * ${WIDE})`);
      card.style.setProperty('--js-rank-cw', `calc(var(--js-poster-w, 150px) * ${WIDE + (look().rankGutter ?? 0.62)})`);
    } else {
      // lock the artwork's height in pixels first, so widening only ever changes the width
      const padder = card.querySelector('.cardPadder');
      if (padder) {
        clearTimeout(card.__jsPadT);
        if (!padder.style.paddingBottom) padder.style.setProperty('padding-bottom', `${padder.getBoundingClientRect().height}px`, 'important');
      }
      const w = `calc(var(--js-port-w, 180px) * ${WIDE})`;
      card.style.setProperty('width', w, 'important');
      card.style.setProperty('min-width', w, 'important');
    }
    const art = card.querySelector('.js-img');
    if (art && card.dataset.wide) {
      art.style.backgroundImage = bgOf(card.dataset.wide);
      if (card.dataset.logo) {
        art.insertAdjacentHTML('beforeend', `<span class="js-nf-wide"><span class="js-tshade"></span><img class="js-tlogo" src="${esc(card.dataset.logo)}" alt=""></span>`);
      }
    }
    const sec = card.closest('.js-section');
    if (sec) {
      const info = document.createElement('div');
      info.className = 'js-nf-info';
      info.innerHTML = '<div class="js-nf-meta"></div><p class="js-nf-ov"></p>';
      sec.appendChild(info);
      nfDetails(card).then((d) => {
        if (nfCard !== card || !d) return;
        info.querySelector('.js-nf-meta').innerHTML = metaLine(d);
        info.querySelector('.js-nf-ov').textContent = d.Overview || '';
        info.classList.add('on');
      });
    }
    if (scroll) pinCard(card);
  };
  // Netflix: the selected card always sits at the row's left edge and the row slides under it.
  // Cards are mid-transition (one shrinking, one widening), so work from the row's resting spacing.
  const pinCard = (card, prev) => {
    const sc = card.closest('.js-scroller');
    if (!sc) return;
    const cards = [...card.parentElement.children].filter((c) => c.classList.contains('card'));
    const i = cards.indexOf(card);
    if (i < 0) return;
    const still = (c) => c && c !== card && c !== prev && !c.classList.contains('js-open') && !(performance.now() - (c.__jsClosedAt || -1e9) < 600);
    const x = (c) => c.getBoundingClientRect().left;
    let pitch = 0;
    for (let k = 0; k + 1 < cards.length && !pitch; k++) {
      if (still(cards[k]) && still(cards[k + 1])) pitch = x(cards[k + 1]) - x(cards[k]);
    }
    if (!pitch) {
      const ref = cards.find(still) || card;
      const m = getComputedStyle(ref);
      pitch = ref.getBoundingClientRect().width + (parseFloat(m.marginLeft) || 0) + (parseFloat(m.marginRight) || 0) + (parseFloat(getComputedStyle(card.parentElement).columnGap) || 0);
    }
    const left = Math.max(0, i * pitch);
    if (Math.abs(sc.scrollLeft - left) > 1) sc.scrollTo({ left, behavior: 'smooth' });
  };
  // JellyNav asks before it scrolls a row sideways; on Netflix pages the card opens and pins here instead.
  // Prime on TV: the selected row always sits just under the fixed banner; rows passed fade out
  const HERO_ROW = 0.6;
  const heroRow = (section) => {
    const top = section.getBoundingClientRect().top + scrollY - innerHeight * HERO_ROW;
    scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    let above = true;
    for (const s of section.parentElement.children) {
      if (s === section) above = false;
      s.classList.toggle('js-above', above);
    }
  };
  addEventListener('scroll', () => {
    if (scrollY < 4) document.querySelectorAll('.js-view .js-above').forEach((s) => s.classList.remove('js-above'));
  }, { passive: true });
  const navScroll = (kind, el) => {
    if (el?.closest?.('.js-libhero .js-libview .js-lib-body')) {
      if (kind === 'card') { libHeroFollow(el.closest('.card') || el); return false; }
      if (kind === 'row') { const sec = el.closest('.js-section'); if (sec) { libPin(sec); return true; } }
      return false;
    }
    if (heroOn() && el?.closest?.('.js-view .js-rows')) {
      document.documentElement.classList.toggle('js-hero-fixed', heroFixed());
      if (kind === 'card') { heroFollow(el); return false; }
      if (kind === 'row' && heroFixed()) {
        const section = el.closest('.js-section');
        if (section) { heroRow(section); return true; }
      }
      return false;
    }
    if (!focusOn() || !el?.closest?.('.js-view')) return false;
    // changing rows: fold the old row's details away first so JellyNav pins the new row against the final layout
    if (kind === 'row') {
      if (nfCard && !el.contains(nfCard)) nfClose();
      return false;
    }
    if (kind !== 'card') return false;
    const card = el.matches(EXPANDABLE) ? el : null;
    if (!card) return false;
    const prev = nfCard;
    clearTimeout(nfTimer);
    nfOpen(card, false);
    pinCard(card, prev);
    return true;
  };
  // mouse: hovering a title opens it (after a short rest, so sweeping across a row stays calm)
  document.addEventListener('mouseover', (e) => {
    if (heroOn() && !matchMedia('(pointer: coarse)').matches) {
      const c = e.target.closest?.('.js-view .js-rows .card');
      if (c) heroFollow(c);
    }
    if (!focusOn() || matchMedia('(pointer: coarse)').matches) return;
    const card = e.target.closest?.(EXPANDABLE);
    clearTimeout(nfTimer);
    if (card && card !== nfCard) nfTimer = setTimeout(() => nfOpen(card, false), 140);
  }, { passive: true });
  // keyboard focus
  document.addEventListener('focusin', (e) => {
    if (heroOn()) { const c = e.target.closest?.('.js-view .js-rows .card'); if (c) heroFollow(c); }
    const card = e.target.closest?.(EXPANDABLE);
    if (card && focusOn()) nfOpen(card, true);
  });
  // JellyNav: it draws its own selection ring instead of moving focus, so follow the ring
  const ringTarget = (ring) => {
    if (ring.style.display === 'none' || ring.style.visibility === 'hidden') return undefined;
    const r = ring.getBoundingClientRect();
    if (!r.width) return undefined;
    const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find((el) => el !== ring && !ring.contains(el));
    return hit || null;
  };
  let ringFrame = 0;
  const onRing = (ring) => {
    if (ringFrame) return;
    ringFrame = requestAnimationFrame(() => {
      ringFrame = 0;
      if (!focusOn()) return;
      clearTimeout(nfTimer);
      // wait for the ring to settle, then look again (it glides across other cards on its way)
      nfTimer = setTimeout(() => {
        const hit = ringTarget(ring);
        if (hit === undefined) return;
        const card = hit?.closest?.(EXPANDABLE);
        if (card) nfOpen(card, true);
        // only close when the selection has left the rows (banner, tabs); a ring over a rank numeral or gap is still the open card
        else if (nfCard && !hit?.closest?.('.js-open, .js-section')) nfClose();
      }, 120);
    });
  };
  setInterval(() => {
    const ring = document.getElementById('__jf_library_focus_ring__');
    if (!ring || ring.__jsWatched) return;
    ring.__jsWatched = true;
    new MutationObserver(() => onRing(ring)).observe(ring, { attributes: true, attributeFilter: ['style', 'class'] });
  }, 1500);

  // ---------------------------------------------------------------- config
  const loadConfig = async (force) => {
    if (!force && state.cfg && Date.now() - state.cfgAt < 10 * 60 * 1000) return state.cfg;
    try {
      state.cfg = await getJSON('Config');
      state.cfgAt = Date.now();
      // the plugin was updated while this page (or the phone app) stayed open: load the new script once
      const v = state.cfg?.PluginVersion;
      if (v && !v.startsWith(`${VERSION}.`) && v !== VERSION) {
        let done = '';
        try { done = sessionStorage.getItem('jellystream:reloaded') || ''; } catch { /* private mode */ }
        if (done !== v && onHome() && !document.querySelector('.js-intro')) {
          try { sessionStorage.setItem('jellystream:reloaded', v); } catch { /* private mode */ }
          diag.add('nav', `JellyStream was updated (${VERSION} -> ${v}): reloading`);
          location.reload();
        }
      }
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

  // a service's own color, never plain white (Disney+, Max and Apple TV are white-on-dark brands)
  const tintOf = (s) => {
    const k = brandKeyFor(s);
    const b = k ? BRANDS[k] : null;
    const light = (c) => /^#(f[0-9a-f]){3}$|^#ffffff$|^#f9f9f9$|^#f5f5f7$/i.test(c || '');
    return s.Accent || (b && !light(b.c1) ? b.c1 : k === 'apple' ? '#3a3a3c' : b?.c2) || '';
  };

  // black or white text, whichever reads better on a color
  const inkOn = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? '#0b0c0f' : '#fff';
  };

  // the tiles take the width of the home screen's own wide cards (Continue Watching etc.)
  const matchTileSize = (sections, row) => {
    const native = [...sections.querySelectorAll('.overflowBackdropCard:not(.js-svc-card)')].find((c) => c.offsetWidth > 60);
    if (native) row.style.setProperty('--js-tile-w', `${native.offsetWidth}px`);
    else setTimeout(() => row.isConnected && !row.style.getPropertyValue('--js-tile-w') && matchTileSize(sections, row), 1500);
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

    // the same pill bar as on service pages, Jellyfin selected, no row title
    const wrap = document.createElement('div');
    wrap.innerHTML = pillsRow('jellyfin', null);
    row = wrap.firstElementChild;
    row.classList.add('js-services');
    row.dataset.v = String(state.cfgAt);
    if (cfg.HomeRowPosition === 'bottom') sections.appendChild(row); else sections.prepend(row);
    stubRows(row);
    warmIntros();
    requestAnimationFrame(() => updateAllArrows(row));
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
        ? safe(window.ApiClient.getResumableItems(userId(), { Limit: 40, Recursive: true, Fields: 'PrimaryImageAspectRatio', EnableImageTypes: 'Primary,Backdrop,Thumb', MediaTypes: 'Video' }).then((r) => r.Items || []))
        : [],
    ]);
    const data = { at: Date.now(), topMovies, topShows, library, missMovies, missShows, resume };
    state.data.set(svc.Key, data);
    return data;
  };

  // ---- uploaded intro videos
  // The video sits in a closed shadow root: other scripts looking for <video> elements (players, pause
  // screens, remote navigation) can't see it, and its play/pause events never reach the page. No
  // controls, picture-in-picture or casting either. Videos are preloaded into memory on the home screen.
  const introBlobs = new Map(); // key + version -> object URL
  // phones get their own (portrait) intro; a phone without one gets the built-in animation
  const isPhone = () => document.documentElement.classList.contains('layout-mobile')
    || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 768);
  const introVersion = (svc) => (isPhone() ? svc.MobileIntroVersion : svc.IntroVersion) || null;
  const introSrc = (svc) => {
    const v = introVersion(svc);
    return v ? api(`Intro/${encodeURIComponent(svc.Key)}?v=${v}${isPhone() ? '&variant=mobile' : ''}`) : null;
  };
  let warming = false;
  const warmIntros = () => {
    if (warming || !state.cfg) return;
    const list = [jellyfin(), ...state.cfg.Services].filter((x) => introVersion(x) && !introBlobs.has(x.Key + introVersion(x)));
    if (!list.length) return;
    warming = true;
    const next = () => {
      const x = list.shift();
      if (!x) { warming = false; return; }
      fetch(introSrc(x))
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => { if (b && b.size) introBlobs.set(x.Key + introVersion(x), URL.createObjectURL(b)); })
        .catch(() => {})
        .finally(() => setTimeout(next, 250));
    };
    setTimeout(next, 1200);
  };

  const playIntroVideo = (svc, src, onFail) => {
    const el = document.createElement('div');
    el.className = 'js-intro js-intro-video';
    el.style.setProperty('--js-intro-bg', '#000');
    const host = document.createElement('div');
    host.className = 'js-intro-host';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; position: absolute; inset: 0; display: block; pointer-events: none; }
      video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; pointer-events: none; display: block; outline: none; }
      video::-webkit-media-controls, video::-webkit-media-controls-enclosure, video::-webkit-media-controls-panel,
      video::-webkit-media-controls-overlay-play-button, video::-webkit-media-controls-start-playback-button,
      video::-internal-media-controls-overlay-cast-button { display: none !important; -webkit-appearance: none; opacity: 0 !important; }`;
    const v = document.createElement('video');
    v.controls = false;
    v.playsInline = true;
    v.preload = 'auto';
    v.tabIndex = -1;
    v.disablePictureInPicture = true;
    v.disableRemotePlayback = true;
    for (const [a, val] of [['playsinline', ''], ['webkit-playsinline', ''], ['disablepictureinpicture', ''], ['disableremoteplayback', ''],
      ['x-webkit-airplay', 'deny'], ['controlslist', 'nodownload nofullscreen noremoteplayback noplaybackrate'], ['aria-hidden', 'true']]) v.setAttribute(a, val);
    v.src = src;
    root.append(style, v);
    el.appendChild(host);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(el);

    let ended = false, ready = false, gone = false, started = false;
    const timers = [];
    const cleanup = () => {
      timers.forEach(clearTimeout);
      removeEventListener('keydown', onKey, true);
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
    };
    const finish = () => {
      if (gone) return;
      gone = true;
      el.classList.add('out');
      document.documentElement.classList.remove('js-intro-on');
      pillsArrive();
      setTimeout(() => { cleanup(); el.remove(); }, 380);
    };
    const fail = (why) => {
      if (gone) return;
      diag.add('intro', 'video intro failed, using the animation:', svc.Key, why);
      gone = true;
      cleanup();
      el.remove();
      onFail(ready);
    };
    // Back / Enter / Escape or a click skips the intro
    const onKey = (e) => {
      if (!['Escape', 'Backspace', 'Enter', ' ', 'GoBack', 'BrowserBack'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finish();
    };
    addEventListener('keydown', onKey, true);
    el.addEventListener('click', finish);

    v.addEventListener('playing', () => { started = true; }, { once: true });
    v.addEventListener('ended', () => { ended = true; if (ready) finish(); });
    v.addEventListener('error', () => (started ? finish() : fail(v.error?.message || 'error')));
    v.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(v.duration)) timers.push(setTimeout(finish, Math.min(v.duration, 30) * 1000 + 3000));
    });
    timers.push(setTimeout(() => { if (!started) fail('did not start'); }, 3000));
    timers.push(setTimeout(finish, 35000));

    // with sound: this runs inside the click / remote press that opened the service, which browsers
    // require for audio. If one still refuses, play muted rather than not at all.
    v.muted = false;
    v.volume = 1;
    const p = v.play();
    if (p && p.catch) {
      p.catch(() => {
        diag.add('intro', 'browser blocked intro sound; playing muted', svc.Key);
        v.muted = true;
        return v.play();
      }).catch((err) => fail(err?.message || 'play refused'));
    }
    return () => { ready = true; if (ended) finish(); };
  };

  // while any intro is on screen, the page underneath (and JellyNav's selection ring) stays hidden
  const introWatch = new MutationObserver(() => {
    document.documentElement.classList.toggle('js-intro-on', !!document.querySelector('body > .js-intro:not(.out)'));
  });
  const watchIntros = () => { if (document.body) introWatch.observe(document.body, { childList: true }); };
  if (document.body) watchIntros(); else addEventListener('DOMContentLoaded', watchIntros);

  // As an intro leaves, the pill row comes to life: the current service's pill gives a small pop and the others
  // rise into place one after another.
  const pillsArrive = (popCurrent = true, after = 140) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const row = [...document.querySelectorAll('.js-switcher .itemsContainer')].find((r) => r.offsetParent && !r.closest('.js-libview'));
    if (!row) return;
    const cards = [...row.querySelectorAll(':scope > .js-sw-card')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    });
    let n = 0;
    cards.forEach((c) => {
      const tab = c.querySelector('.js-sw-tab');
      if (!tab?.animate) return;
      if (c.classList.contains('js-current')) {
        if (popCurrent) tab.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1.08)', offset: .55 }, { transform: 'none' }], { duration: 560, delay: 60, easing: 'cubic-bezier(.2,.8,.2,1)' });
        return;
      }
      tab.animate([{ opacity: 0, transform: 'translateY(12px) scale(.94)' }, { opacity: 1, transform: 'none' }],
        { duration: 480, delay: after + n++ * 50, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  };

  // the service's intro: its uploaded video, or the built-in animation
  const playIntro = (svc) => {
    document.querySelector('.js-intro')?.remove();
    const src = introVersion(svc) ? (introBlobs.get(svc.Key + introVersion(svc)) || introSrc(svc)) : null;
    if (!src) return playIntroAnim(svc);
    let anim = null;
    let pageReady = false;
    const videoDone = playIntroVideo(svc, src, (readyAlready) => {
      anim = playIntroAnim(svc);
      if (readyAlready || pageReady) anim();
    });
    return () => { pageReady = true; (anim || videoDone)(); };
  };

  // the built-in animation, shown until the page is ready (about two seconds)
  // ---------------------------------------------------------------- the Jellyfin intro
  // After the big streaming idents: a line of light traces the logo on black (Apple TV+), the light becomes the
  // logo with a cinematic swell, a glint crosses it, the name settles in from wide tracking (HBO), and then you
  // dive through the logo's centre into the home screen (Netflix). The picture and the score start together on
  // one clock, so slow devices can't pull them apart.
  const JF_T = { floor: 3200, dive: 1000 };
  const jfCtx = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      return AC ? (jfCtx.ac || (jfCtx.ac = new AC())) : null;
    } catch { return null; }
  };
  // browsers only allow sound after a press: wake the audio on the first one, so it's ready before any intro
  ['pointerdown', 'keydown', 'touchend'].forEach((t) => addEventListener(t, () => {
    const ac = jfCtx();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  }, { capture: true, passive: true }));

  // The score, theatre style: a cloud of voices chatters across the speakers, then converges into one huge D chord
  // as the logo lands, over a rising rumble, a sub-bass swell and a saturated boom, followed by a slow brass-like
  // swell in a big hall. The way out is a deep rush and a landing thump. k stretches it for slower devices.
  const jfScore = (ac, t, part, k = 1, T = JF_T) => {
    try {
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 14; comp.ratio.value = 4.5; comp.attack.value = .008; comp.release.value = .5;
      const master = ac.createGain(); master.gain.value = .75;
      comp.connect(master); master.connect(ac.destination);
      if (!jfScore.ir || jfScore.ir.sampleRate !== ac.sampleRate) {
        const len = Math.floor(ac.sampleRate * 4.5);
        const ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
        }
        jfScore.ir = ir;
      }
      const verb = ac.createConvolver(); verb.buffer = jfScore.ir;
      const wet = ac.createGain(); wet.gain.value = .55;
      verb.connect(wet); wet.connect(comp);
      const bus = (dry = 1, rev = 1, pan = 0) => {
        const g = ac.createGain();
        let head = g;
        if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); head = p; }
        const d = ac.createGain(); d.gain.value = dry; head.connect(d); d.connect(comp);
        const r = ac.createGain(); r.gain.value = rev; head.connect(r); r.connect(verb);
        return g;
      };
      const ramp = (param, pts) => {
        param.setValueAtTime(pts[0][1], pts[0][0]);
        pts.slice(1).forEach(([at, v]) => param.exponentialRampToValueAtTime(Math.max(v, .0001), at));
      };
      const noise = (dur) => {
        const b = ac.createBuffer(1, Math.ceil(dur * ac.sampleRate), ac.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const n = ac.createBufferSource(); n.buffer = b; return n;
      };
      const drive = (amt) => {
        const ws = ac.createWaveShaper();
        const c = new Float32Array(1024);
        for (let i = 0; i < c.length; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(amt * x) / Math.tanh(amt); }
        ws.curve = c; return ws;
      };
      const osc = (type, freqPts, at, end, gainPts, dest) => {
        const o = ac.createOscillator(); o.type = type;
        if (Array.isArray(freqPts)) ramp(o.frequency, freqPts); else o.frequency.value = freqPts;
        const g = ac.createGain(); ramp(g.gain, gainPts);
        o.connect(g); g.connect(dest); o.start(at); o.stop(end);
        return o;
      };
      if (part === 'in') {
        const land = t + 1.2 * k;
        const end = land + 3.6;
        // the chatter: voices wandering on their own, spread across the room, gliding together onto the chord
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .5;
        ramp(lp.frequency, [[t, 1600], [land, 4200], [land + .8, 5200], [end, 600]]);
        const chord = [36.71, 55, 73.42, 110, 146.83, 220, 293.66, 369.99, 440, 587.33, 739.99, 880, 1174.66, 1760];
        const n = 32;
        lp.connect(bus(.75, .95));
        for (let i = 0; i < n; i++) {
          const f = chord[i % chord.length];
          const pan = ((i * 7) % n) / n * 1.6 - .8; // spread, then everything meets in the middle as the chord lands
          const vb = ac.createStereoPanner ? ac.createStereoPanner() : null;
          if (vb) { vb.pan.setValueAtTime(pan, t); vb.pan.linearRampToValueAtTime(pan * .25, land); vb.connect(lp); }
          const from = 200 + Math.random() * 500;
          const w = [1, 2, 3].map(() => from * (.7 + Math.random() * .6));
          const vo = osc('sawtooth', [[t, from], [t + .28 * k, w[0]], [t + .56 * k, w[1]], [t + .84 * k, w[2]], [land - .03, f]], t, end,
            [[t, .0001], [t + .12 * k, .022], [land - .1, .03], [land + .6, .034], [land + 2, .022], [end, .0001]], vb || lp);
          vo.detune.value = (Math.random() - .5) * 16;
          // each voice chatters on its own: a quick, uneven wobble that settles as the chord lands
          const lfo = ac.createOscillator(); lfo.type = i % 2 ? 'sine' : 'triangle'; lfo.frequency.value = 3 + Math.random() * 6;
          const depth = ac.createGain();
          depth.gain.setValueAtTime(from * .035, t); depth.gain.linearRampToValueAtTime(from * .02, land - .25); depth.gain.linearRampToValueAtTime(0, land);
          lfo.connect(depth); depth.connect(vo.frequency); lfo.start(t); lfo.stop(land + .05);
        }
        // the light chatter: little crystalline blips all over the room, getting busier and settling onto the
        // chord's notes as the specks reach the logo
        const twinkle = [1174.66, 1318.5, 1479.98, 1760, 1975.5, 2349.3, 2637, 2960, 3520];
        const settle = [1174.66, 1479.98, 1760, 2349.3, 2960, 3520];
        for (let i = 0; i < 110; i++) {
          const p = Math.pow(Math.random(), .6); // busier toward the landing
          const at = t + .05 + p * (land - t - .08);
          const f = (p > .75 ? settle : twinkle)[Math.floor(Math.random() * (p > .75 ? settle : twinkle).length)];
          const len = .09 + Math.random() * .18;
          const bl = bus(.55, 1.1, (Math.random() * 2 - 1) * (1 - p * .7));
          osc(i % 3 ? 'sine' : 'triangle', f, at, at + len + .05, [[at, .0001], [at + .004, .13 + p * .1], [at + len, .0001]], bl);
        }
        // a timpani-like rumble rolling up into the landing
        const rum = noise(1.6 * k); const rl = ac.createBiquadFilter(); rl.type = 'lowpass'; rl.Q.value = 6;
        ramp(rl.frequency, [[land - .9 * k, 55], [land, 140]]);
        const rg = ac.createGain(); ramp(rg.gain, [[land - .9 * k, .0001], [land - .02, .5], [land + .15, .0001]]);
        rum.connect(rl); rl.connect(rg); rg.connect(bus(1, .6)); rum.start(land - .9 * k); rum.stop(land + .2);
        // sub-bass swell (D1 and D2)
        const sub = bus(1, .25);
        osc('sine', 36.71, t, end, [[t, .0001], [land - .35, .02], [land, .3], [land + .6, .5], [end, .0001]], sub);
        osc('triangle', 73.42, t, end, [[t, .0001], [land + .4, .15], [end, .0001]], sub);
        // the landing: a saturated boom, a thud of air, and a crash of light (bright noise in the hall)
        const boom = drive(3); const bg = bus(1, .6); boom.connect(bg);
        osc('sine', [[land, 100], [land + 1.1, 28]], land, land + 3, [[land, .0001], [land + .012, .95], [land + 2.8, .0001]], boom);
        const thud = noise(.9); const tl = ac.createBiquadFilter(); tl.type = 'lowpass'; tl.frequency.value = 200;
        const tg = ac.createGain(); ramp(tg.gain, [[land, .0001], [land + .01, .7], [land + .8, .0001]]);
        thud.connect(tl); tl.connect(tg); tg.connect(bg); thud.start(land); thud.stop(land + .9);
        const crash = noise(2.6); const ch = ac.createBiquadFilter(); ch.type = 'highpass'; ch.frequency.value = 3500;
        const cg = ac.createGain(); ramp(cg.gain, [[land, .0001], [land + .02, .035], [land + 2, .0001]]);
        crash.connect(ch); ch.connect(cg); cg.connect(bus(.4, 1.2)); crash.start(land); crash.stop(land + 2.6);
        // brass: a slow, broad swell on the chord after the hit
        const br = ac.createBiquadFilter(); br.type = 'lowpass'; br.Q.value = 2;
        ramp(br.frequency, [[land + .1, 300], [land + .9, 2600], [end, 500]]);
        br.connect(bus(.9, .9));
        [146.83, 220, 293.66, 369.99, 440].forEach((f, i) => {
          [-7, 7].forEach((c) => {
            const o = osc('sawtooth', f, land + .1, end, [[land + .1, .0001], [land + .9, .03 / (1 + i * .2)], [land + 2.2, .024 / (1 + i * .2)], [end, .0001]], br);
            o.detune.value = c;
          });
        });
        // the air of light during the trace
        const air = noise(1.6 * k); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
        ramp(bp.frequency, [[t, 300], [land, 2400]]);
        const ag = ac.createGain(); ramp(ag.gain, [[t, .0001], [land - .05, .05], [land + .1, .0001]]);
        air.connect(bp); bp.connect(ag); ag.connect(bus(.6, 1)); air.start(t); air.stop(land + .15);
      } else {
        // the flight to the home screen: a deep, smooth rush
        const end = t + T.dive / 1000;
        const n = noise(T.dive / 1000 + .6); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
        ramp(lp.frequency, [[t, 1500], [end, 140]]);
        const ng = ac.createGain(); ramp(ng.gain, [[t, .0001], [t + .3, .18], [end + .35, .0001]]);
        n.connect(lp); lp.connect(ng); ng.connect(bus(1, .7)); n.start(t); n.stop(end + .3);
        osc('sine', [[t, 66], [end, 40]], t, end + 1, [[t, .0001], [t + .35, .22], [end + .9, .0001]], bus(1, .5));
      }
    } catch { /* no audio: the picture still runs */ }
  };

  const playJfIntro = () => {
    const g = `jsjfi${++jfSeq}`;
    const k = lite() ? 1.6 : 1.3; // unhurried, and slower still on small devices like a Raspberry Pi
    const T = { floor: JF_T.floor * k, dive: JF_T.dive * (lite() ? 1.5 : 1.3) };
    const chatter = Array.from({ length: lite() ? 16 : 26 }, (_, i) => {
      const a0 = Math.round(Math.random() * 360);
      const turn = 300 + Math.round(Math.random() * 200);
      const r = (24 + Math.random() * 30).toFixed(1);
      const c = ['#c08cff', '#5fd0ff', '#ffffff', '#aa5cc3', '#00a4dc'][i % 5];
      const d = (Math.random() * .18 * k).toFixed(2);
      return `<b style="--a0:${a0}deg;--a1:${a0 + turn}deg;--d:${d}s"><i style="--r:${r}vmin;--c:${c}"></i></b>`;
    }).join('');
    const el = document.createElement('div');
    el.className = 'js-intro js-jf';
    el.style.setProperty('--jf-k', k);
    el.innerHTML = `<div class="js-jf-black"></div><div class="js-jf-bloom"></div>
      <div class="js-jf-logo"><div class="js-jf-chatter">${chatter}</div><div class="js-jf-rays"></div><div class="js-jf-flare"></div><div class="js-jf-push">
        <svg class="js-jf-svg" viewBox="0 0 512 512" aria-hidden="true"><defs>
          <linearGradient id="${g}" x1="110.25" y1="213.3" x2="496.14" y2="436.09" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#aa5cc3"/><stop offset="1" stop-color="#00a4dc"/></linearGradient>
          <linearGradient id="${g}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
          <clipPath id="${g}c"><path clip-rule="evenodd" d="${JF_OUT}"/><path d="${JF_IN}"/></clipPath></defs>
          <path class="jf-trace" d="${JF_OUT}" fill="none" stroke="url(#${g})" stroke-width="5" pathLength="1"/>
          <path class="jf-fill" d="${JF_OUT}" fill-rule="evenodd" fill="url(#${g})"/>
          <path class="jf-core" d="${JF_IN}" fill="url(#${g})"/>
          <g clip-path="url(#${g}c)"><g transform="rotate(20 256 256)"><rect class="jf-sweep" x="-260" y="-200" width="150" height="912" fill="url(#${g}s)"/></g></g>
        </svg></div></div>
      <div class="js-jf-name">Jellyfin</div>`;
    document.body.appendChild(el);

    const ac = jfCtx();
    let started = 0;
    const begin = () => {
      if (started || !el.isConnected) return;
      started = performance.now();
      el.classList.add('go');
      if (ac && ac.state === 'running') jfScore(ac, ac.currentTime + .02, 'in', k, T);
    };
    // start once the black screen is actually on screen (and the audio is awake), never more than a moment late
    const onScreen = () => requestAnimationFrame(() => requestAnimationFrame(begin));
    if (ac && ac.state !== 'running') Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 300))]).then(onScreen, onScreen);
    else onScreen();
    setTimeout(begin, 500);

    const still = lite() || matchMedia('(prefers-reduced-motion: reduce)').matches;
    // the black lifts and the big logo dissolves toward you; the Jellyfin pill waits there black and empty,
    // then its logo and name pop in, and the other pills rise into place
    const popToPill = () => {
      const pill = [...document.querySelectorAll('.js-services a.js-sw-tab[href="#/home"]')].find((a) => a.offsetParent);
      const icon = pill?.querySelector('.js-sw-logo');
      const label = pill?.querySelector('.js-sw-name');
      if (!icon || !label) return false;
      const ir = pill.getBoundingClientRect();
      if (!ir.width || ir.bottom < 0 || ir.top > innerHeight || ir.right < 0 || ir.left > innerWidth) return false;
      const D = T.dive;
      pill.classList.add('js-jf-waiting');
      el.classList.add('flying');
      pillsArrive(false, D * .55 + 160); // the others wait out of sight, then rise in after the Jellyfin pill pops
      const out = { duration: D * .6, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' };
      el.querySelector('.js-jf-logo').animate([{ transform: 'none', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(1.08)', opacity: 0, filter: 'blur(6px)' }], out);
      el.querySelector('.js-jf-name').animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(.3em)' }], out);
      el.querySelector('.js-jf-black').animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * .75, delay: D * .1, easing: 'ease-in-out', fill: 'forwards' });
      el.querySelector('.js-jf-bloom').animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * .4, fill: 'forwards' });
      setTimeout(() => {
        pill.style.transition = 'background-color .5s ease, box-shadow .5s ease';
        pill.classList.remove('js-jf-waiting');
        setTimeout(() => { pill.style.transition = ''; }, 700);
        const pop = (node, delay) => node.animate([
          { opacity: 0, transform: 'scale(.4)' },
          { opacity: 1, transform: 'scale(1.22)', offset: .5 },
          { opacity: 1, transform: 'none' },
        ], { duration: 560, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
        pop(icon, 0);
        pop(label, 70);
      }, D * .55);
      setTimeout(() => el.remove(), D + 40);
      return true;
    };
    const exit = () => {
      if (!el.isConnected) return;
      if (ac && ac.state === 'running') jfScore(ac, ac.currentTime + .02, 'out', k, T);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.classList.add('out');
        pillsArrive();
        setTimeout(() => el.remove(), 450);
        return;
      }
      if (popToPill()) return;
      if (still) {
        el.classList.add('out');
        pillsArrive();
        setTimeout(() => el.remove(), 450);
        return;
      }
      // no Jellyfin pill on screen: dive through the centre of the logo: the home screen is waiting on the other side
      const core = el.querySelector('.jf-core');
      const logo = el.querySelector('.js-jf-logo');
      const r = core.getBoundingClientRect();
      const bb = core.getBBox();
      const lr = logo.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const k0 = r.width / bb.width;
      const W = innerWidth;
      const H = innerHeight;
      logo.style.transformOrigin = `${cx - lr.left}px ${cy - lr.top}px`;
      el.insertAdjacentHTML('afterbegin', `<svg class="js-jf-hole" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs>
        <mask id="${g}m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>
        <path class="jf-holepath" d="${JF_IN}" fill="#000"/></mask></defs><rect width="${W}" height="${H}" fill="#000" mask="url(#${g}m)"/></svg>`);
      const hole = el.querySelector('.jf-holepath');
      const bx = bb.x + bb.width / 2;
      const by = bb.y + bb.height / 2;
      const max = Math.max(W, H) * 4 / r.width;
      const place = (sc) => {
        logo.style.transform = `scale(${sc})`;
        hole.setAttribute('transform', `translate(${cx} ${cy}) scale(${k0 * sc}) translate(${-bx} ${-by})`);
      };
      place(1);
      el.classList.add('diving');
      homeSections()?.animate?.([{ transform: 'scale(1.1)', opacity: .5 }, { transform: 'none', opacity: 1 }],
        { duration: T.dive + 300, easing: 'cubic-bezier(.2,.7,.2,1)' });
      const t1 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t1) / T.dive);
        place(Math.pow(max, p * p * (3 - 2 * p) * p)); // slow at first, then rushing through
        if (p < 1) requestAnimationFrame(step); else el.remove();
      };
      requestAnimationFrame(step);
    };
    let ended = false;
    const done = () => {
      if (ended) return;
      ended = true;
      const later = () => setTimeout(exit, Math.max(0, T.floor - (performance.now() - started)));
      if (started) later(); else setTimeout(later, 520);
    };
    setTimeout(done, T.floor + 600); // never stuck, even if the page is still loading
    return done;
  };

  const playIntroAnim = (svc) => {
    document.querySelector('.js-intro')?.remove();
    if (svc.Key === 'jellyfin') return playJfIntro();
    const k = svc.Key === 'jellyfin' ? 'jellyfin' : (brandKeyFor(svc) || 'generic');
    const b = BRANDS[k] || {};
    const el = document.createElement('div');
    el.className = `js-intro js-intro-${k}`;
    el.style.setProperty('--js-intro-bg', b.base || '#0b0c10');
    el.style.setProperty('--js-intro-c1', svc.Accent || (k === 'disney' ? '#3ec7ff' : b.c1) || '#8aa0b8');
    const feathers = k === 'peacock'
      ? ['#ffb000', '#ff6d00', '#e5007e', '#6f2da8', '#0063db', '#00b14f'].map((c, i) => {
        const a = (-150 + i * 24) * Math.PI / 180;
        return `<i style="background:${c};color:${c};--dx:${Math.round(Math.cos(a) * 30)}vmin;--dy:${Math.round(Math.sin(a) * 30)}vmin;animation-delay:${0.15 + i * 0.05}s"></i>`;
      }).join('')
      : '';
    el.innerHTML = `<div class="js-intro-fx">${feathers}</div>${svc.Logo
      ? `<img class="js-intro-logo" src="${esc(svc.Logo)}" alt="">`
      : `<div class="js-intro-name">${esc(svc.Name)}</div>`}`;
    document.body.appendChild(el);
    const started = performance.now();
    let ended = false;
    const done = () => {
      if (ended) return;
      ended = true;
      const wait = Math.max(0, 1600 - (performance.now() - started));
      setTimeout(() => {
        el.classList.add('out');
        pillsArrive();
        setTimeout(() => el.remove(), 400);
      }, wait);
    };
    setTimeout(done, 2200); // about two seconds at most, even if the page is still loading
    return done;
  };

  // The streaming services as pills (Jellyfin first): on service pages and on Jellyfin's own home.
  // Home + every service as tabs: logo and full name, sized inline so no theme can shrink them
  const SW_CARD = 'width:auto !important;min-width:max-content !important;max-width:none !important;flex:0 0 auto !important;';
  const SW_FIT = 'position:static !important;width:auto !important;min-width:max-content !important;max-width:none !important;height:auto !important;padding:0 !important;margin:0 .45em 0 0 !important;overflow:visible !important;contain:none !important;';
  // the tab itself: a real pill whatever a theme does to card images
  const SW_TAB = 'position:relative !important;inset:auto !important;display:inline-flex !important;align-items:center !important;gap:.6em !important;'
    + 'width:auto !important;min-width:max-content !important;max-width:none !important;height:3em !important;padding:0 1.25em 0 .45em !important;'
    + 'box-sizing:border-box !important;border-radius:999px !important;white-space:nowrap !important;overflow:visible !important;contain:none !important;'
    + 'aspect-ratio:auto !important;flex:none !important;transform:none;';
  const SW_TEXT = 'display:inline-block !important;width:auto !important;max-width:none !important;overflow:visible !important;text-overflow:clip !important;white-space:nowrap !important;position:static !important;';
  const sw = (href, name, logo, current, color, icon) => `
    <div class="card js-sw-card${current ? ' js-current' : ''}" style="${SW_CARD}height:auto !important;overflow:visible !important;contain:none !important;${color ? `--js-sw:${esc(color)};--js-sw-ink:${inkOn(color)};` : ''}">
      <div class="cardBox" style="${SW_FIT}">
        <div class="cardScalable" style="${SW_FIT}">
          <a class="cardImageContainer cardContent itemAction js-sw-tab" style="${SW_TAB}" href="${esc(href)}" aria-label="${esc(name)}">
            ${icon ? `<span class="material-icons js-sw-icon">${icon}</span>` : logo === JF_LOGO ? jfSvg('js-sw-logo') : logo ? `<img class="js-sw-logo" src="${esc(logo)}" alt="" loading="lazy">` : `<span class="js-sw-dot"></span>`}
            <span class="js-sw-name" style="${SW_TEXT}">${esc(name)}</span>
          </a>
        </div>
      </div>
    </div>`;

  const pillsRow = (current, svc) => {
    const cfg = state.cfg;
    const cards = [sw('#/home', 'Jellyfin', JF_LOGO, current === 'jellyfin', '#00a4dc')]
      .concat(cfg.Services.map((x) => sw(`#/home?${PARAM}=${encodeURIComponent(x.Key)}`, x.Name, x.Logo, x.Key === current, tintOf(x))));
    // a service's whole library, filterable
    return section({ title: 'Services', cls: 'js-switcher', cards });
  };

  // ---------------------------------------------------------------- a service's whole library
  // Everything on the service you can watch, as a grid you can filter (type, genre) and sort. Each grid
  // line is its own row, so remotes (JellyNav) move through it like any other rows.
  const CHIP_TAB = SW_TAB.replace('height:3em !important;padding:0 1.25em 0 .45em !important;', 'height:2.6em !important;padding:0 1.2em !important;justify-content:center !important;text-decoration:none !important;');
  const chip = (label, on, attrs) => `
    <div class="card js-sw-card js-chip${on ? ' js-current' : ''}" style="${SW_CARD}height:auto !important;overflow:visible !important;contain:none !important;">
      <div class="cardBox" style="${SW_FIT}"><div class="cardScalable" style="${SW_FIT}">
        <a class="cardImageContainer cardContent itemAction js-sw-tab" href="#" ${attrs} style="${CHIP_TAB}">
          <span class="js-sw-name" style="${SW_TEXT}">${esc(label)}</span></a>
      </div></div>
    </div>`;
  const chipRow = (cards, cls) => `<div class="verticalSection js-section js-switcher js-lib-chips ${cls}"><div class="js-rowwrap"><div class="emby-scroller js-scroller"><div class="itemsContainer scrollSlider focuscontainer-x">${cards.join('')}</div></div></div></div>`;
  const libState = { type: 'all', genre: '', sort: 'az' };
  const LIB_SORTS = [['az', 'A–Z'], ['added', 'Recently added'], ['newest', 'Newest'], ['rating', 'Top rated']];
  const openLibrary = (view, svc, data, opts = {}) => {
    Object.assign(libState, { type: 'all', genre: '', sort: 'az' }, opts);
    view.classList.add('js-libmode');
    nfReset();
    let lv = view.querySelector('.js-libview');
    if (!lv) {
      lv = document.createElement('div');
      lv.className = 'js-libview';
      // TV and desktop: Prime-style, the selected title's banner stays at the top while the grid moves under it
      lv.innerHTML = `${isPhone() ? '' : '<section class="js-bb js-lib-hero" aria-live="polite"></section>'}<div class="js-lib-body"></div>`;
      view.appendChild(lv);
    }
    view.classList.toggle('js-libhero', !isPhone());
    const body = lv.querySelector('.js-lib-body');
    const draw = () => {
      const all = data.library;
      const byType = all.filter((i) => libState.type === 'all' || i.Type === libState.type);
      const genres = groupByGenre(byType, 16).map((g) => g.genre);
      if (libState.genre && !genres.includes(libState.genre)) libState.genre = '';
      let items = byType.filter((i) => !libState.genre || (i.Genres || []).includes(libState.genre));
      const by = {
        az: (a, b) => a.Name.localeCompare(b.Name),
        added: (a, b) => (Date.parse(b.Added) || 0) - (Date.parse(a.Added) || 0),
        newest: (a, b) => (b.Year || 0) - (a.Year || 0) || a.Name.localeCompare(b.Name),
        rating: (a, b) => (b.Rating || 0) - (a.Rating || 0) || a.Name.localeCompare(b.Name),
      }[libState.sort];
      items = [...items].sort(by);
      const n = (t) => all.filter((i) => t === 'all' || i.Type === t).length;
      body.innerHTML = `
        <div class="js-lib-head">
          <h2 class="js-lib-title">${esc(svc.Name)} library</h2>
          <span class="js-lib-count">${items.length} title${items.length === 1 ? '' : 's'}</span>
        </div>
        ${chipRow([chip('Back', false, 'data-lib="back"')].concat(
          [['all', 'All'], ['movie', 'Movies'], ['tv', 'Shows']].map(([t, l]) => chip(`${l} (${n(t)})`, libState.type === t, `data-lib="type" data-v="${t}"`)),
          LIB_SORTS.map(([k, l]) => chip(l, libState.sort === k, `data-lib="sort" data-v="${k}"`))), 'js-lib-ctl')}
        ${genres.length ? chipRow([chip('All genres', !libState.genre, 'data-lib="genre" data-v=""')].concat(genres.map((g) => chip(g, libState.genre === g, `data-lib="genre" data-v="${esc(g)}"`))), 'js-lib-genres') : ''}
        <div class="js-lib-grid"></div>
        <div class="js-lib-more"></div>`;
      stubRows(body);
      if (items[0]) requestAnimationFrame(() => libHeroShow(view, items[0].Id, body.querySelector('.card.js-lib')));
      // lay the titles out in lines that fill the width, a few screens at a time
      const grid = lv.querySelector('.js-lib-grid');
      const probe = document.createElement('div');
      probe.className = 'js-lib-line';
      probe.innerHTML = `<div class="itemsContainer">${libraryCard(items[0] || all[0])}</div>`;
      grid.appendChild(probe);
      const one = probe.querySelector('.card');
      const cw = one ? one.getBoundingClientRect().width + parseFloat(getComputedStyle(one).marginLeft || 0) + parseFloat(getComputedStyle(one).marginRight || 0) : 200;
      const avail = grid.getBoundingClientRect().width - (isPhone() ? innerWidth * .08 : innerWidth * .066);
      const per = Math.max(2, Math.floor(avail / Math.max(cw, 1)));
      probe.remove();
      if (!items.length) { grid.innerHTML = '<div class="js-empty">Nothing here with these filters.</div>'; return; }
      let shown = 0;
      const more = () => {
        const html = [];
        for (let k = 0; k < 6 && shown < items.length; k++, shown += per) {
          html.push(`<div class="verticalSection js-section js-lib-line"><div class="js-rowwrap"><div class="emby-scroller js-scroller"><div class="itemsContainer scrollSlider focuscontainer-x">${items.slice(shown, shown + per).map(libraryCard).join('')}</div></div></div></div>`);
        }
        grid.insertAdjacentHTML('beforeend', html.join(''));
        lazy(grid);
        stubRows(grid);
        if (shown >= items.length) io2?.disconnect();
      };
      const sentinel = body.querySelector('.js-lib-more');
      const io2 = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: '800px' }) : null;
      more();
      if (io2) io2.observe(sentinel); else while (shown < items.length) more();
    };
    lv.onclick = (e) => {
      const a = e.target.closest('[data-lib]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const kind = a.dataset.lib;
      if (kind === 'back') { closeLibrary(view); return; }
      libState[kind] = a.dataset.v;
      draw();
      lv.querySelector(`[data-lib="${kind}"][data-v="${CSS.escape(a.dataset.v)}"]`)?.focus?.();
    };
    draw();
    scrollTo({ top: 0 });
  };
  // the library's banner: the selected title, in the service's own banner style
  let libHeroTimer = 0;
  const libHeroShow = (view, id, card) => {
    const hero = view?.querySelector('.js-lib-hero');
    if (!hero || !id || hero.dataset.id === id) return;
    const lib = state.lib?.get(normId(id));
    if (!lib) return;
    hero.dataset.id = id;
    const tmp = document.createElement('div');
    tmp.innerHTML = bbSlide({ n: state.ranks?.get(normId(id))?.n || null, kind: lib.Type, t: { ItemId: lib.Id, Name: lib.Name, Type: lib.Type, Year: lib.Year, LogoTag: lib.LogoTag, BackdropTag: lib.BackdropTag, PrimaryTag: lib.PrimaryTag, Backdrop: ((card?.dataset.wide || '').split('|')[0] || (card?.querySelector('.js-img')?.dataset.src || '').split('|')[0]), Poster: '' } });
    const slide = tmp.firstElementChild;
    if (!slide) return;
    const old = [...hero.querySelectorAll('.js-bb-slide')];
    hero.appendChild(slide);
    bbFill(slide);
    requestAnimationFrame(() => {
      slide.classList.add('on');
      old.forEach((o) => { o.classList.remove('on'); o.setAttribute('inert', ''); setTimeout(() => o.remove(), 700); });
    });
  };
  const libHeroFollow = (card) => {
    const view = card?.closest?.('.js-view.js-libhero');
    if (!view || !card.dataset.id) return;
    clearTimeout(libHeroTimer);
    libHeroTimer = setTimeout(() => libHeroShow(view, card.dataset.id, card), 140);
  };
  // remotes: the selected line sits just under the banner; lines above it fade away
  const LIB_LINE = 0.6;
  const libPin = (section) => {
    const top = section.getBoundingClientRect().top + scrollY - innerHeight * LIB_LINE;
    scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    let above = true;
    for (const s of section.closest('.js-lib-body').querySelectorAll('.js-section')) {
      if (s === section) above = false;
      s.classList.toggle('js-above', above);
    }
  };
  document.addEventListener('mouseover', (e) => {
    const c = e.target.closest?.('.js-libhero .js-libview .card.js-lib');
    if (c) libHeroFollow(c);
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const c = e.target.closest?.('.js-libhero .js-libview .card.js-lib');
    if (c) libHeroFollow(c);
  });

  // The way into a service's whole library: the last thing on its home, built to stand apart from the rows:
  // a tilted wall of its posters behind big tiles (everything, movies, shows) and its genres.
  const browseTile = (kind, icon, label, count) => `
    <div class="card js-browse-tile" style="${SW_CARD}height:auto !important;overflow:visible !important;contain:none !important;">
      <div class="cardBox" style="${SW_FIT}"><div class="cardScalable" style="${SW_FIT}">
        <a class="cardImageContainer cardContent itemAction js-browse-btn" href="#" data-browse="${kind}" aria-label="${esc(label)}"
          style="position:relative !important;inset:auto !important;display:flex !important;flex-direction:column !important;align-items:flex-start !important;justify-content:flex-end !important;width:clamp(11em, 17vw, 17em) !important;height:clamp(6.5em, 9vw, 8.5em) !important;padding:1em 1.2em !important;box-sizing:border-box !important;border-radius:16px !important;aspect-ratio:auto !important;overflow:hidden !important;contain:none !important;">
          <span class="material-icons js-browse-icon">${icon}</span>
          <b class="js-browse-label">${esc(label)}</b>
          <small class="js-browse-count">${count} title${count === 1 ? '' : 's'}</small></a>
      </div></div>
    </div>`;
  const browsePanel = (svc, data, movies, shows) => {
    const wall = [...data.library].sort(() => Math.random() - .5).slice(0, isPhone() ? 12 : 24)
      .map((i) => `<i style="background-image:url('${esc(imgUrl(i.Id, i.PrimaryTag))}')"></i>`).join('');
    const tiles = [browseTile('all', 'apps', `Everything on ${svc.Name}`, data.library.length)];
    if (movies.length) tiles.push(browseTile('movie', 'movie', 'Movies', movies.length));
    if (shows.length) tiles.push(browseTile('tv', 'tv', 'Shows', shows.length));
    const genres = groupByGenre(data.library, 14).map((g) => g.genre);
    return `<div class="js-browse">
      <div class="js-browse-wall" aria-hidden="true">${wall}</div>
      <div class="js-browse-head">
        <div class="js-browse-eyebrow">The whole library</div>
        <div class="js-browse-title">Browse everything on ${esc(svc.Name)}</div>
        <div class="js-browse-sub">${movies.length} movie${movies.length === 1 ? '' : 's'} · ${shows.length} show${shows.length === 1 ? '' : 's'} you can watch now</div>
      </div>
      <div class="verticalSection js-section js-browse-row"><div class="js-rowwrap"><div class="emby-scroller js-scroller"><div class="itemsContainer scrollSlider focuscontainer-x">${tiles.join('')}</div></div></div></div>
      ${genres.length ? `<div class="verticalSection js-section js-browse-row js-browse-genres"><div class="js-rowwrap"><div class="emby-scroller js-scroller"><div class="itemsContainer scrollSlider focuscontainer-x">${genres.map((g) => chip(g, false, `data-browse="genre" data-v="${esc(g)}"`)).join('')}</div></div></div></div>` : ''}
    </div>`;
  };

  const closeLibrary = (view) => {
    view.classList.remove('js-libmode', 'js-libhero');
    view.querySelector('.js-libview')?.remove();
    scrollTo({ top: 0 });
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
    // intros only mark a switch: reopening the service that's already your home (a reload, coming back) has none
    if (svc && state.introKey !== key && key !== getLast()) state.introDone = playIntro(svc);
    if (svc) setLast(key);
    state.introKey = key;

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
        <button type="button" class="js-back">Jellyfin</button>
      </div>
      <div class="js-rows"><div class="js-empty">Loading…</div></div>`;
    autoAccent(svc).then((col) => col && view.style.setProperty('--js-accent', col));

    const data = await loadService(svc);
    if (!view.isConnected) return;

    const onService = new Set(data.library.map((i) => i.Id.replace(/-/g, '').toLowerCase()));
    state.lib = new Map(data.library.map((i) => [normId(i.Id), i]));
    state.ranks = new Map();
    for (const [list, kind] of [[uniqueTop(data.topShows), 'tv'], [uniqueTop(data.topMovies), 'movie']]) {
      list.forEach((t, i) => { if (t.ItemId && !state.ranks.has(normId(t.ItemId))) state.ranks.set(normId(t.ItemId), { n: i + 1, kind }); });
    }
    nfReset();
    const movies = data.library.filter((i) => i.Type === 'movie');
    const shows = data.library.filter((i) => i.Type === 'tv');
    const when = cfg.TopSource === 'day' ? 'Trending today on' : cfg.TopSource === 'week' ? 'Trending this week on' : 'Popular on';
    const span = cfg.TopSource === 'day' ? 'Today' : cfg.TopSource === 'week' ? 'This Week' : '';
    const rows = [];

    rows.push(pillsRow(svc.Key, svc));

    const topMovies = section({ title: `Top ${cfg.TopCount} Movies ${span}`.trim(), cards: uniqueTop(data.topMovies).map(rankCard), cls: 'js-top', attrs: 'data-kind="movie"' });
    const topShows = section({ title: `Top ${cfg.TopCount} Shows ${span}`.trim(), cards: uniqueTop(data.topShows).map(rankCard), cls: 'js-top', attrs: 'data-kind="tv"' });
    const head = [];
    const body = [];

    if (cfg.ShowContinueWatching) {
      const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();
      const resume = data.resume.filter((it) => onService.has(norm(it.Id)) || onService.has(norm(it.SeriesId)));
      const wide = look().cwLandscape;
      const left = (it) => {
        const m = Math.round(Math.max(0, (it.RunTimeTicks || 0) - (it.UserData?.PlaybackPositionTicks || 0)) / 6e8);
        return m <= 0 ? '' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''} remaining` : `${m}m remaining`;
      };
      // episodes: the episode's own still; movies: thumb art, else a backdrop
      const still = (it) => {
        const A = window.ApiClient;
        const o = (type, tag, id = it.Id) => A.getImageUrl(id, { type, fillWidth: 640, quality: 80, ...(tag ? { tag } : {}) });
        const urls = [];
        if (it.Type === 'Episode' && it.ImageTags?.Primary) urls.push(o('Primary', it.ImageTags.Primary));
        if (it.ImageTags?.Thumb) urls.push(o('Thumb', it.ImageTags.Thumb));
        if (it.ParentThumbItemId && it.ParentThumbImageTag) urls.push(o('Thumb', it.ParentThumbImageTag, it.ParentThumbItemId));
        if (it.BackdropImageTags?.[0]) urls.push(o('Backdrop', it.BackdropImageTags[0]));
        if (it.ParentBackdropItemId && it.ParentBackdropImageTags?.[0]) urls.push(o('Backdrop', it.ParentBackdropImageTags[0], it.ParentBackdropItemId));
        urls.push(imgUrl(it.SeriesId || it.Id));
        return urls.join('|');
      };
      head.push(section({
        title: 'Continue Watching',
        cls: wide ? 'js-cw' : '',
        cards: resume.map((it) => card(wide ? {
          id: it.Id,
          name: it.SeriesName || it.Name,
          sub: [left(it), it.SeriesName ? `S${it.ParentIndexNumber ?? '?'}:E${it.IndexNumber ?? '?'}` : ''].filter(Boolean).join(' · '),
          img: still(it),
          href: detailsHref(it.Id),
          type: it.Type,
          shape: 'landscape',
          caption: 'below',
          titled: true,
          extra: `<span class="js-prog"><i style="width:${Math.min(100, Math.max(2, Math.round(it.UserData?.PlayedPercentage || 0)))}%"></i></span>`,
        } : {
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
      body.push(section({ title: `New on ${svc.Name}`, cards: data.library.slice(0, 24).map(libraryCard) }));
    }

    // genre rows alternate between movies and shows, the way the services mix them
    const gm = groupByGenre(movies, cfg.GenreRows);
    const gs = groupByGenre(shows, cfg.GenreRows);
    for (let i = 0; i < Math.max(gm.length, gs.length); i++) {
      if (gs[i]) body.push(section({ title: `${gs[i].genre} Shows`, cards: gs[i].items.map(libraryCard), attrs: 'data-kind="tv"' }));
      if (gm[i]) body.push(section({ title: `${gm[i].genre} Movies`, cards: gm[i].items.map(libraryCard), attrs: 'data-kind="movie"' }));
    }
    if (cfg.ShowPopularMissing) {
      body.push(section({ title: 'Popular Movies to Request', cards: data.missMovies.map((t) => titleCard(t, true)), attrs: 'data-kind="movie"' }));
      body.push(section({ title: 'Popular Shows to Request', cards: data.missShows.map((t) => titleCard(t, true)), attrs: 'data-kind="tv"' }));
    }
    if (shows.length) {
      const az = [...shows].sort((a, b) => a.Name.localeCompare(b.Name)).slice(0, 120);
      body.push(section({ title: `All Shows (${shows.length})`, cards: az.map(libraryCard), attrs: 'data-kind="tv" data-seeall="tv"' }));
    }
    if (movies.length) {
      const az = [...movies].sort((a, b) => a.Name.localeCompare(b.Name)).slice(0, 120);
      body.push(section({ title: `All Movies (${movies.length})`, cards: az.map(libraryCard), attrs: 'data-kind="movie" data-seeall="movie"' }));
    }

    // the two Top 10s never sit next to each other: shows near the top, movies a few rows later
    const filled = body.filter(Boolean);
    rows.push(...head, topShows, ...filled.slice(0, 3), topMovies, ...filled.slice(3));
    if (data.library.length) rows.push(browsePanel(svc, data, movies, shows));

    const html = rows.join('');
    renderBillboard(view, svc, data);
    const box = view.querySelector('.js-rows');
    box.onclick = (e) => {
      const go = e.target.closest('[data-browse]');
      if (go) {
        e.preventDefault();
        e.stopPropagation();
        openLibrary(view, svc, data, go.dataset.browse === 'genre' ? { genre: go.dataset.v } : { type: go.dataset.browse });
        return;
      }
      const t = e.target.closest('[data-seeall] .sectionTitle');
      if (!t) return;
      e.preventDefault();
      openLibrary(view, svc, data, { type: t.closest('[data-seeall]').dataset.seeall });
    };
    box.innerHTML = html || `<div class="js-empty">Nothing from ${esc(svc.Name)} yet. If you just set JellyStream up, run the sync from its settings page.</div>`;
    lazy(box);
    stubRows(box);
    paintPage(true);
    state.introDone?.();
    state.introDone = null;
    requestAnimationFrame(() => updateAllArrows(box));
    setTimeout(() => updateAllArrows(box), 600); // after the Top 10 numbers resize their cards
  };

  // the #1 title on the service, presented the way that service's app does
  // The banner: the service's top titles, one after another (every 8 s, with dots), the art drifting
  // slowly. Pauses while you're on it (mouse, focus or JellyNav's selection); swipe it on phones.
  const BB_SLIDES = 6;
  const BB_EVERY = 8000;
  const bbPicks = (data) => {
    const shows = uniqueTop(data.topShows), movies = uniqueTop(data.topMovies);
    const out = [];
    for (let i = 0; out.length < BB_SLIDES && (i < shows.length || i < movies.length); i++) {
      for (const [list, kind] of [[shows, 'tv'], [movies, 'movie']]) {
        const t = list[i];
        if (t && (t.Backdrop || t.ItemId) && out.length < BB_SLIDES) out.push({ t, n: i + 1, kind });
      }
    }
    return out;
  };
  const bbSlide = ({ t: pick, n, kind }) => {
    const l = look();
    const isTv = pick.Type === 'tv';
    const when = state.cfg.TopSource === 'day' ? 'Today' : state.cfg.TopSource === 'week' ? 'This Week' : '';
    const owned = !!pick.ItemId;
    const lib = owned ? state.lib?.get(normId(pick.ItemId)) : null;
    // phones show the title's poster (portrait) instead of the wide backdrop
    const poster = owned
      ? window.ApiClient.getImageUrl(pick.ItemId, { type: 'Primary', fillHeight: 1000, quality: 85, ...(pick.PrimaryTag ? { tag: pick.PrimaryTag } : {}) })
        + (pick.Poster ? `|${pick.Poster.replace('/w342/', '/w780/')}` : '')
      : (pick.Poster || '').replace('/w342/', '/w780/');
    const big = owned && pick.BackdropTag
      ? `${window.ApiClient.getImageUrl(pick.ItemId, { type: 'Backdrop', fillWidth: 1600, quality: 85, tag: pick.BackdropTag })}|${(pick.Backdrop || '').replace('/w780/', '/w1280/')}`
      : (pick.Backdrop || '').replace('/w780/', '/w1280/');
    const meta = bbMeta({ OfficialRating: lib?.Certification, ProductionYear: pick.Year || lib?.Year, Genres: lib?.Genres || [], Type: pick.Type });
    const href = owned ? detailsHref(pick.ItemId) : '';
    return `
      <div class="js-bb-slide" data-type="${pick.Type}" data-tmdb="${pick.TmdbId || ''}" ${owned ? `data-id="${esc(pick.ItemId)}"` : ''} data-art="${esc(big)}">
        <div class="js-bb-art"></div>
        <div class="js-bb-poster js-img" data-src="${esc(poster)}"></div>
        <div class="js-bb-shade"></div>
        ${owned ? `<a class="js-bb-link" href="${esc(href)}" data-id="${esc(pick.ItemId)}" tabindex="-1" aria-hidden="true"></a>` : ''}
        <div class="js-bb-content">
          <div class="js-bb-tag">${esc(isTv ? l.labels.tagTv : l.labels.tagMovie)}</div>
          <h2 class="js-bb-title">${owned && pick.LogoTag
            ? `<img class="js-bb-logo" src="${esc(logoUrl(pick.ItemId, pick.LogoTag))}" alt="${esc(pick.Name)}">`
            : esc(pick.Name)}</h2>
          <div class="js-bb-rank">${n ? `#${n} in ${kind === 'tv' ? 'TV Shows' : 'Movies'}${when ? ` ${when}` : ''}` : ''}</div>
          ${(lib && (flagsFor(lib.Id).recent || flagsFor(lib.Id).newEp)) ? `<div class="js-bb-new">${flagsFor(lib.Id).recent ? (isTv ? 'New series' : 'New movie') : 'New episode'}</div>` : ''}
          <div class="js-bb-tags">${esc(isTv ? 'Show' : 'Movie')}</div>
          <div class="js-bb-meta">${meta}</div>
          <p class="js-bb-overview"></p>
          <div class="js-bb-actions">
            ${owned
              ? `<a class="js-bb-btn js-primary" href="${esc(href)}" data-id="${esc(pick.ItemId)}"><span class="material-icons">play_arrow</span>${esc(l.labels.play)}</a>`
              : `<button type="button" class="js-bb-btn js-primary js-bb-request" data-jstmdb="${pick.TmdbId}" data-jstype="${pick.Type}"><span class="material-icons">add</span>${esc(l.labels.request)}</button>`}
            ${owned && l.labels.info
              ? `<a class="js-bb-btn js-secondary" href="${esc(href)}" data-id="${esc(pick.ItemId)}"><span class="material-icons">info</span>${esc(l.labels.info)}</a>`
              : owned && l.labels.info !== null ? `<a class="js-bb-btn js-secondary" href="${esc(href)}" data-id="${esc(pick.ItemId)}" aria-label="Details"><span class="material-icons">add</span></a>` : ''}
          </div>
        </div>
      </div>`;
  };
  // fill a slide in the first time it shows: big art, overview, genres
  const bbFill = (slide) => {
    if (slide.dataset.filled) return;
    slide.dataset.filled = '1';
    const art = slide.querySelector('.js-bb-art');
    const urls = (slide.dataset.art || '').split('|').filter(Boolean);
    const tryNext = () => {
      const u = urls.shift();
      if (!u) return;
      const img = new Image();
      img.onload = () => { art.style.backgroundImage = `url("${u}")`; art.classList.add('on'); };
      img.onerror = tryNext;
      img.src = u;
    };
    tryNext();
    const posterEl = slide.querySelector('.js-bb-poster');
    if (posterEl) posterEl.style.backgroundImage = bgOf(posterEl.dataset.src);
    const isTv = slide.dataset.type === 'tv';
    const details = slide.dataset.id
      ? window.ApiClient.getItem(userId(), slide.dataset.id)
      : slide.dataset.tmdb ? getJSON(`Details?type=${slide.dataset.type}&tmdbId=${slide.dataset.tmdb}`) : Promise.resolve(null);
    details.then((d) => {
      const p = slide.querySelector('.js-bb-overview');
      if (p && d?.Overview) p.textContent = d.Overview;
      const tags = slide.querySelector('.js-bb-tags');
      if (tags && d?.Genres?.length) {
        tags.innerHTML = [isTv ? 'Show' : 'Movie', ...d.Genres.slice(0, 3)].map((x, i) => `<span${i ? '' : ' class="js-strong"'}>${esc(x)}</span>`).join('<i>•</i>');
      }
      const meta = slide.querySelector('.js-bb-meta');
      if (meta && d) meta.innerHTML = bbMeta({ ...d, Type: d.Type || slide.dataset.type });
    }).catch(() => {});
  };
  // the details line under the banner title, the way each service writes it
  const bbMeta = (d) => {
    const tv = /^(series|tv)$/i.test(d.Type || '');
    const cert = d.OfficialRating ? `<b class="js-cert">${esc(d.OfficialRating)}</b>` : '';
    if (document.documentElement.dataset.jsBrand === 'prime') {
      const m = d.RunTimeTicks ? Math.round(d.RunTimeTicks / 6e8) : 0;
      const len = tv ? (d.ChildCount ? `${d.ChildCount} season${d.ChildCount === 1 ? '' : 's'}` : '') : (m ? `${m} min` : '');
      return [d.Genres?.[0], len, d.ProductionYear].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('') + cert;
    }
    return `${cert}${esc([d.ProductionYear, (d.Genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' • '))}`;
  };
  // Prime: the banner shows the selected title. Builds a slide for any card on the page.
  const heroOn = () => !!look().heroFollow && !isPhone();
  const heroFixed = () => heroOn() && !!document.getElementById('__jf_library_focus_ring__');
  let heroTimer = 0;
  const heroPick = (card) => {
    const id = card.dataset.id;
    const lib = id ? state.lib?.get(normId(id)) : null;
    const name = card.querySelector('.cardText-first')?.textContent.trim() || card.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
    const wide = (card.dataset.wide || '').split('|')[0];
    const firstImg = (card.querySelector('.js-img')?.dataset.src || '').split('|')[0];
    const rank = card.classList.contains('js-rank-card') ? [...card.parentElement.children].indexOf(card) + 1 : (id ? state.ranks?.get(normId(id))?.n : null);
    const kind = card.closest('[data-kind]')?.dataset.kind || (lib?.Type) || (card.dataset.jstype) || 'movie';
    if (lib) {
      return { n: rank || null, kind, t: { ItemId: lib.Id, Name: lib.Name, Type: lib.Type, Year: lib.Year, LogoTag: lib.LogoTag, BackdropTag: lib.BackdropTag, PrimaryTag: lib.PrimaryTag, Backdrop: wide || firstImg, Poster: '' } };
    }
    if (id) return { n: null, kind, t: { ItemId: id, Name: name, Type: kind, Backdrop: firstImg, Poster: '' } };
    return { n: rank || null, kind, t: { TmdbId: card.dataset.jstmdb, Name: name, Type: card.dataset.jstype || kind, Backdrop: wide || firstImg, Poster: '' } };
  };
  const heroShow = (card) => {
    const bb = document.querySelector('.js-view .js-bb');
    if (!bb || !card?.isConnected || card.closest('.js-switcher') || bb.dataset.focusCard === (card.dataset.id || card.dataset.jstmdb)) return;
    const b = bb.getBoundingClientRect();
    if (b.bottom < 40) return; // banner scrolled away (mouse users scrolling down the page)
    const pick = heroPick(card);
    if (!pick.t.ItemId && !pick.t.TmdbId) return;
    bb.querySelector('.js-bb-focus')?.remove();
    const tmp = document.createElement('div');
    tmp.innerHTML = bbSlide(pick);
    const slide = tmp.firstElementChild;
    slide.classList.add('js-bb-focus');
    const dots = bb.querySelector('.js-bb-dots');
    if (dots) bb.insertBefore(slide, dots); else bb.insertBefore(slide, bb.querySelector('.js-hero'));
    bb.dataset.focus = '1';
    bb.dataset.focusAt = Date.now();
    bb.dataset.focusCard = card.dataset.id || card.dataset.jstmdb || '';
    bbShow(bb, [...bb.querySelectorAll('.js-bb-slide')].indexOf(slide));
  };
  const heroFollow = (card) => {
    if (!heroOn()) return;
    clearTimeout(heroTimer);
    heroTimer = setTimeout(() => heroShow(card), 160);
  };

  const bbShow = (bb, i) => {
    const slides = [...bb.querySelectorAll('.js-bb-slide')];
    if (!slides.length) return;
    const n = ((i % slides.length) + slides.length) % slides.length;
    slides.forEach((s, k) => {
      const on = k === n;
      s.classList.toggle('on', on);
      s.toggleAttribute('inert', !on); // hidden slides' buttons stay out of reach (and out of JellyNav's way)
    });
    bb.querySelectorAll('.js-bb-dot').forEach((d, k) => d.classList.toggle('on', k === n));
    bb.dataset.slide = n;
    bbFill(slides[n]);
    if (slides[(n + 1) % slides.length]) bbFill(slides[(n + 1) % slides.length]); // ready before it's due
  };
  // the banner keeps rotating unless you're actually using it right now: a mouse resting on it, a phone's
  // leftover tap or a remote selection sitting on it all stop counting after a few seconds of nothing
  let bbInputAt = 0;
  addEventListener('keydown', () => { bbInputAt = Date.now(); }, true);
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') bbInputAt = Date.now(); }, { capture: true, passive: true });
  const bbBusy = (bb) => {
    if (document.hidden || document.documentElement.classList.contains('js-intro-on')) return true;
    if (bb.dataset.focus && (heroFixed() || Date.now() - +bb.dataset.focusAt < 15000)) return true;
    const b = bb.getBoundingClientRect();
    if (b.bottom < 0 || b.top > innerHeight) return true; // scrolled away: no point changing it
    if (Date.now() - bbInputAt > 6000) return false;
    if (!matchMedia('(pointer: coarse)').matches && bb.matches(':hover')) return true;
    const ae = document.activeElement;
    if (ae && ae !== document.body && bb.contains(ae) && ae.matches(':focus-visible')) return true;
    const ring = document.getElementById('__jf_library_focus_ring__');
    if (ring && ring.style.display !== 'none' && ring.style.opacity !== '0') {
      const r = ring.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (r.width && x > b.left && x < b.right && y > b.top && y < b.bottom) return true;
    }
    return false;
  };
  const renderBillboard = (view, svc, data) => {
    const hero = view.querySelector('.js-hero');
    if (!hero || view.querySelector('.js-bb')) return;
    const picks = bbPicks(data);
    const bb = document.createElement('section');
    bb.className = 'js-bb';
    if (!picks.length) {
      bb.innerHTML = `<div class="js-bb-shade"></div>`;
      bb.style.height = '9em';
      bb.style.minHeight = '0';
    } else {
      bb.innerHTML = picks.map(bbSlide).join('')
        + (picks.length > 1 ? `<div class="js-bb-dots" aria-hidden="true">${picks.map((_, i) => `<span class="js-bb-dot" data-i="${i}"></span>`).join('')}</div>` : '');
      bbShow(bb, 0);
      if (picks.length > 1) {
        const go = (d) => {
          if (bb.dataset.focus) { bb.querySelector('.js-bb-focus')?.remove(); delete bb.dataset.focus; delete bb.dataset.focusCard; }
          const n = bb.querySelectorAll('.js-bb-slide').length;
          bbShow(bb, (+bb.dataset.slide || 0) % n + d);
          bb.dataset.due = Date.now() + BB_EVERY;
        };
        bb.dataset.due = Date.now() + BB_EVERY;
        const timer = setInterval(() => {
          if (!bb.isConnected) { clearInterval(timer); return; }
          if (bbBusy(bb)) { bb.dataset.due = Date.now() + BB_EVERY; return; }
          if (Date.now() >= +bb.dataset.due) go(1);
        }, 500);
        bb.addEventListener('click', (e) => {
          const dot = e.target.closest('.js-bb-dot');
          if (dot) { e.preventDefault(); bbShow(bb, +dot.dataset.i); bb.dataset.due = Date.now() + BB_EVERY; }
        });
        // phones: swipe the banner to change title (taps still open it); see the touch handling above
        bb.addEventListener('js-swipe', (e) => go(e.detail));
      }
    }
    hero.replaceWith(bb);
    bb.appendChild(hero); // the service chip (logo, name, Back) sits in the corner
    // services whose banner runs under the header: pull it up to the top of the page
    if (look().bleed && !isPhone()) {
      requestAnimationFrame(() => {
        const top = bb.getBoundingClientRect().top + scrollY;
        if (top > 0) bb.style.marginTop = `-${Math.round(top)}px`;
      });
    }
  };

  // the service's logo in Jellyfin's header (right on TV/desktop, after the title on phones)
  const headerMark = (svc) => {
    document.querySelectorAll('.js-hdr-mark').forEach((el) => el.remove());
    if (!svc || !look().headerMark || !svc.Logo) return;
    const header = document.querySelector('.skinHeader');
    const slot = isPhone() ? header?.querySelector('.headerLeft') : header?.querySelector('.headerRight');
    if (!slot) return;
    const el = document.createElement('span');
    el.className = 'js-hdr-mark';
    el.innerHTML = `<img src="${esc(svc.Logo)}" alt="${esc(svc.Name)}">`;
    if (isPhone()) slot.appendChild(el); else slot.appendChild(el);
  };

  // remove every trace of a service page (used when leaving the home screen)
  const teardown = () => {
    const html = document.documentElement;
    if (!html.classList.contains('js-service-open') && !document.querySelector('.js-view')) return;
    html.classList.remove('js-service-open');
    document.querySelectorAll('.js-view').forEach((v) => v.remove());
    document.querySelectorAll('.js-hide-native').forEach((el) => el.classList.remove('js-hide-native'));
    state.brandKey = null;
    document.querySelector('.js-intro')?.remove();
    document.querySelectorAll('.js-hdr-mark').forEach((el) => el.remove());
    paintPage(false);
    applyBrand(null);
  };

  // Picking a service (or Jellyfin) starts that home fresh: back at the top, every row at its first card,
  // and JellyNav forgets where it was in each row.
  const freshHome = () => {
    if (!state.fresh) return;
    state.fresh = false;
    scrollTo({ top: 0 });
    document.querySelectorAll('.homeSectionsContainer .emby-scroller, .homeSectionsContainer .scrollX, .homeSectionsContainer [is="emby-scroller"]').forEach((sc) => {
      try {
        if (typeof sc.scrollToPosition === 'function') sc.scrollToPosition(0, true);
        else sc.scrollLeft = 0;
      } catch { /* not a scroller */ }
    });
    nfReset?.();
    document.dispatchEvent(new CustomEvent('jellynav:reset'));
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
  // The service page stays up until the route really changes (the hashchange tears it down), so a
  // slow or stuck navigation can never leave you on a half-restored home screen.
  const isDetails = () => /^#!?\/details/i.test(location.hash || '');
  const detailsShown = () => [...document.querySelectorAll('.itemDetailPage')].some(visible);
  const openDetails = (href) => {
    diag.add('open', 'opening', href, 'router:', !!window.Emby?.Page?.show, 'pending:', !!window.Emby?.Page?.promiseShow);
    diag.snapshot('before opening a title');
    document.querySelector('.js-view')?.classList.add('js-leaving');
    let sent = false;
    try {
      const router = window.Emby?.Page;
      if (router?.show) {
        // Jellyfin's router queues behind its last navigation, which never finishes when only the
        // home screen's query changed (as it does for service pages), so clear that first
        router.promiseShow = null;
        router.resolveOnNextShow = null;
        router.show(href.replace(/^#!?/, ''));
        sent = true;
      }
    } catch { /* fall through to the link */ }
    if (!sent) location.hash = href;
    setTimeout(() => { if (!isDetails()) location.hash = href; }, 500);
    traceOpen();
  };

  // Records what the page did after a title was clicked. If the details page never shows, the record
  // goes to the browser console and the Jellyfin server log (so it can be diagnosed), then the page
  // reloads straight into the title as a last resort.
  const traceOpen = () => {
    const t0 = performance.now();
    const log = [];
    const at = () => Math.round(performance.now() - t0);
    const snap = (label) => log.push({
      t: at(), label,
      hash: (location.hash || '').slice(0, 48),
      pages: [...document.querySelectorAll('.mainAnimatedPages > *, .skinBody > [data-role="page"]')]
        .map((p) => `${p.id || p.className.split(' ')[0] || p.tagName}${p.classList.contains('hide') ? '(hidden)' : ''}`).join(' '),
      details: detailsShown(),
      view: !!document.querySelector('.js-view'),
    });
    const onErr = (e) => log.push({ t: at(), error: String(e?.message || e?.reason?.stack || e?.reason?.message || e?.reason || e).slice(0, 400) });
    addEventListener('error', onErr);
    addEventListener('unhandledrejection', onErr);
    snap('click');
    setTimeout(() => snap('0.3s'), 300);
    setTimeout(() => snap('1s'), 1000);
    setTimeout(() => {
      snap('2.5s');
      removeEventListener('error', onErr);
      removeEventListener('unhandledrejection', onErr);
      diag.add('open', 'title open trace', log);
      diag.snapshot('2.5s after opening a title');
      if (!isDetails() || detailsShown()) return;
      const text = `open title failed (client ${VERSION}, layout ${document.documentElement.className.match(/layout-\S+/g)?.join(' ') || '?'}): ${JSON.stringify(log)}\n${diag.dump()}`;
      try {
        window.ApiClient.ajax({ type: 'POST', url: api('Client/Log'), data: JSON.stringify({ Message: text }), contentType: 'application/json' });
      } catch { /* ignore */ }
    }, 2500);
  };

  // clicks: service tiles, back button, and titles you don't have
  document.addEventListener('click', (e) => {
    const tab = e.target.closest?.('.js-tab');
    if (tab) {
      e.preventDefault();
      const view = tab.closest('.js-view');
      view.dataset.f = tab.dataset.f;
      tab.parentElement.querySelectorAll('.js-tab').forEach((t) => t.classList.toggle('on', t === tab));
      requestAnimationFrame(() => updateAllArrows(view));
      return;
    }
    const bbLink = e.target.closest?.('.js-bb a.js-bb-btn[data-id]');
    if (bbLink) {
      e.preventDefault();
      e.stopPropagation();
      openDetails(bbLink.getAttribute('href'));
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
      openDetails(link.getAttribute('href'));
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
  const touch = () => matchMedia('(pointer: coarse)').matches || document.documentElement.classList.contains('layout-mobile');
  const canMorph = () => typeof document.startViewTransition === 'function' && !lite() && !touch();
  const waitFor = (test, ms = 1200) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => (test() || performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
    tick();
  });
  const clearNames = () => document.querySelectorAll('.js-logo, .js-hero img').forEach((el) => { el.style.viewTransitionName = ''; });

  // open / switch / close without touching Jellyfin's route
  const navigate = (to) => {
    const base = history.state && typeof history.state === 'object' ? history.state : {};
    if (to.key) {
      const st = { ...base, jellystream: to.key, jsPushed: to.replace ? base.jsPushed : true };
      if (to.replace) history.replaceState(st, ''); else history.pushState(st, '');
    } else if (base.jsPushed && base.jellystream && !to.replace) {
      history.back();
      return;
    } else if (new URLSearchParams((location.hash || '').split('?')[1] || '').get(PARAM)) {
      location.hash = '#/home'; // an old-style link: go to the plain home route
      return;
    } else {
      history.replaceState({ ...base, jellystream: null, jsPushed: false }, '');
    }
    sync();
  };

  // to: { href, key (service opening, or null for home), from (element to morph), fromKey (service being left), back, replace }
  const go = (to) => {
    if (!canMorph()) {
      navigate(to);
      return;
    }
    clearNames();
    if (to.from) to.from.style.viewTransitionName = 'js-logo';
    state.vt = true;
    let t;
    try {
      t = document.startViewTransition(async () => {
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
    } catch {
      state.vt = false;
      clearNames();
      navigate(to);
    }
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('.js-svc-card a, .js-switcher a, .js-back');
    if (!a || a.closest('.js-libview')) return;
    e.preventDefault();
    e.stopPropagation();
    const current = serviceKey();
    const heroImg = document.querySelector('.js-view .js-hero img');

    if (a.classList.contains('js-back') || a.getAttribute('href') === '#/home') {
      setLast('jellyfin');
      if (!current) return;
      state.fresh = true;
      // back to Jellyfin is a switch like any other: its intro plays (inside the press, so with sound)
      state.introDone = playIntro(jellyfin());
      state.introKey = 'jellyfin';
      go({ key: null, from: heroImg, fromKey: current, replace: true });
      return;
    }
    const key = new URLSearchParams(a.getAttribute('href').split('?')[1] || '').get(PARAM);
    if (!key || key === current) return;
    setLast(key);
    state.fresh = true;
    // the intro starts right here, inside the click / remote press, so browsers let it play sound
    const opening = state.cfg?.Services.find((x) => x.Key === key);
    if (opening && state.introKey !== key) {
      state.introDone = playIntro(opening);
      state.introKey = key;
    }
    // the service is now this device's home: it replaces the entry rather than stacking on Jellyfin's
    if (current) go({ key, from: null, replace: true });
    else navigate({ key, replace: true });
  }, true);

  // Jellyfin's own Home (header tab, home button, drawer link, tab bars added by other plugins) goes
  // back to the normal home screen. The route is already #/home, so without this nothing would change.
  const isHomeControl = (el) => {
    if (!el || el.closest('.js-view, .js-services, .jsd-panel')) return false;
    if (el.matches('.headerHomeButton, .headerHomeButton *')) return true;
    const href = el.closest('a')?.getAttribute('href') || '';
    if (/^#!?\/home(\.html)?\/?$/i.test(href)) return true;
    const ctl = el.closest('.emby-tab-button, .headerTabs button, .skinHeader a, .skinHeader button, .navMenuOption, .mainDrawer a, [role="tab"]');
    if (!ctl || !ctl.closest('.skinHeader, .headerTabs, .mainDrawer, .navDrawer, header, nav, [role="tablist"]')) return false;
    const text = (ctl.textContent || ctl.getAttribute('aria-label') || '').trim().toLowerCase();
    return text === 'home' || (ctl.matches('.headerTabs .emby-tab-button') && ctl.dataset.index === '0');
  };
  document.addEventListener('click', (e) => {
    if (!serviceKey() || !isHomeControl(e.target)) return;
    diag.add('nav', 'Jellyfin Home pressed on a service page: staying on it (it is the home now)');
    const view = document.querySelector('.js-view.js-libmode');
    if (view) closeLibrary(view); else scrollTo({ top: 0, behavior: 'smooth' });
  }, true);

  // ---------------------------------------------------------------- main loop
  let busy = false;
  const sync = async () => {
    if (busy || !window.ApiClient || !userId()) return;
    document.documentElement.classList.toggle('js-hero-fixed', heroFixed());
    if (!state.cfg && !state.cfgLoading) {
      state.cfgLoading = true;
      loadConfig().finally(() => { state.cfgLoading = false; diagUi(); });
    }
    if (!onHome()) {
      teardown();
      return;
    }
    // a service is this device's home: keep Jellyfin's own home hidden until it's on screen (no flash)
    const html = document.documentElement;
    if (!state.cfg && getLast() !== 'jellyfin' && !html.classList.contains('js-pending')) {
      html.classList.add('js-pending');
      setTimeout(() => html.classList.remove('js-pending'), 5000); // never stuck hidden
    }
    const sections = homeSections();
    if (!sections) return;

    busy = true;
    try {
      await loadConfig();
      if (!state.cfg) return;
      let key = serviceKey();
      const st = history.state && typeof history.state === 'object' ? history.state : {};
      if (!key) {
        const last = getLast();
        if (last !== 'jellyfin' && state.cfg.Services.some((x) => x.Key === last)) {
          state.introKey = last; // returning to the same home: no intro
          history.replaceState({ ...st, jellystream: last, jsPushed: false }, '');
          key = last;
          diag.add('nav', `Home: opening ${last} (picked last on this device)`);
        }
      }
      document.documentElement.classList.toggle('js-service-open', !!key);
      document.documentElement.classList.toggle('js-phone', isPhone());
      const svc = key ? state.cfg.Services.find((x) => x.Key === key) : null;
      if ((svc?.Key || null) !== state.brandKey) {
        state.brandKey = svc?.Key || null;
        applyBrand(svc);
        headerMark(svc);
      } else if (svc && look().headerMark && !document.querySelector('.js-hdr-mark')) {
        headerMark(svc); // Jellyfin re-drew its header
      }
      if (key) {
        sections.querySelector(':scope > .js-services')?.remove();
        await renderService(sections, key);
        if (document.querySelector('.js-view .js-rows .verticalSection')) freshHome();
        html.classList.remove('js-pending');
        if (!painted.includes(sections.closest('[data-role="page"], .page, .mainAnimatedPage'))) paintPage(true);
      } else {
        if (painted.length) paintPage(false);
        closeService(sections);
        if (state.introKey !== 'jellyfin') state.introKey = null;
        renderHomeRow(sections);
        freshHome();
        html.classList.remove('js-pending');
        state.introDone?.();
        state.introDone = null;
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
    navScroll,
    refresh: () => { state.cfgAt = 0; state.data.clear(); document.querySelectorAll('.js-services, .js-view').forEach((e) => e.remove()); sync(); },
  };
})();
