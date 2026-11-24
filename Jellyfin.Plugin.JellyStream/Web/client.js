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
  const VERSION = '1.17.2';

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
      rankShape: 'landscape',
      c1: '#f9f9f9', c2: '#0063e5', num: 'glass',
      base: '#1a1d29', bg: 'radial-gradient(130% 60% at 50% -5%, #2b3a66 0%, transparent 55%), linear-gradient(180deg, #1a1d29 0%, #14172a 100%)',
      shape: 'landscape', caption: 'overlay',
      nav: 'pill', tabs: ['For You', 'Series', 'Movies'],
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
      rankShape: 'landscape',
      c1: '#1a98ff', c2: '#0f79af', numA: '#1a98ff', numB: '#8fdcff', num: 'solid',
      base: '#0f171e', bg: '#0f171e', shape: 'landscape', caption: 'below',
      nav: 'rail', tabs: ['Home', 'TV Shows', 'Movies'],
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
    prime: '--js-num-fill: #1a98ff; --js-num-stroke: 0 transparent;',
    hulu: '--js-num-fill: #0b0c0f; --js-num-stroke: 3px #1ce783;',
    apple: '--js-num-fill: rgba(255,255,255,.1); --js-num-stroke: 2px rgba(255,255,255,.65);',
    paramount: '--js-num-fill: #0064ff; --js-num-stroke: 3px #7fb2ff;',
    peacock: '--js-num-fill: #000; --js-num-stroke: 3px #ffb000;',
  };

  // row sizing per service: card widths, spacing, and how wide a Top 10 slot is next to its poster
  const LAND = (w, cw) => `--js-rank-pw: ${w}; --js-rank-ph: calc(var(--js-rank-pw) * .5625); --js-rank-cw: ${cw};`;
  const LAYOUT = {
    netflix: '--js-port-w: clamp(170px, 14.6vw, 300px); --js-poster-w: clamp(160px, 13.6vw, 280px); --js-gap: .3em; --js-rank-cw: calc(var(--js-poster-w) * 1.62);',
    disney: `--js-land-w: clamp(240px, 19vw, 350px); --js-gap: .6em; ${LAND('clamp(240px, 19vw, 340px)', 'calc(var(--js-rank-pw) * 1.12)')}`,
    max: '--js-port-w: clamp(150px, 12vw, 225px); --js-gap: .45em; --js-rank-cw: calc(var(--js-poster-w) * 1.5);',
    prime: `--js-land-w: clamp(230px, 18vw, 320px); --js-gap: .4em; ${LAND('clamp(230px, 17vw, 310px)', 'calc(var(--js-rank-pw) + var(--js-rank-ph) * .66)')}`,
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
    // Disney+: wide tiles with a frosted edge; the rank stands over the tile's lower left
    disney: `
      .js-rank-num { z-index: 2 !important; left: 0 !important; bottom: -.1em !important; font-size: calc(var(--js-rank-ph) * .9) !important; font-weight: 800 !important; letter-spacing: -.04em !important; color: #f9f9f9 !important; -webkit-text-stroke: 0 !important; text-shadow: 0 6px 24px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.7); }
      .js-rank-poster { border-radius: 8px !important; box-shadow: 0 26px 30px -10px rgba(0,0,0,.69), inset 0 0 0 3px rgba(249,249,249,.1) !important; }
      .js-rank-card:is(:hover,:focus-within,.show-focus,.focused) .js-rank-poster { transform: scale(1.05) !important; box-shadow: 0 30px 40px -12px rgba(0,0,0,.8), inset 0 0 0 4px rgba(249,249,249,.85) !important; }`,
    // HBO Max: tall, light numerals beside the poster
    max: `
      .js-rank-num { font-weight: 200 !important; letter-spacing: -.07em !important; color: #fff !important; -webkit-text-stroke: 0 !important; bottom: -.08em !important; opacity: .95; }
      .js-rank-poster { border-radius: 6px !important; }`,
    // Prime Video: wide tiles, big numerals fading from white into Prime blue behind them
    prime: `
      .js-rank-num { font-size: calc(var(--js-rank-ph) * 1.08) !important; bottom: -.12em !important; color: transparent !important; -webkit-text-stroke: 0 !important; background: linear-gradient(180deg, #ffffff 20%, #1a98ff 100%); -webkit-background-clip: text; background-clip: text; font-weight: 800 !important; }
      .js-rank-poster { border-radius: 8px !important; }`,
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
      .js-tlogo { left: 50% !important; transform: translateX(-50%); object-position: center bottom !important; max-width: 66% !important; max-height: 40% !important; bottom: 11% !important; }
      .js-tshade { background: linear-gradient(0deg, rgba(0,0,0,.5), transparent 55%) !important; }
      .js-rank-poster .js-tlogo { left: auto !important; right: 6% !important; transform: none !important; object-position: right bottom !important; max-width: 55% !important; }
      .js-rank-poster .js-ovl { text-align: right !important; }
      .js-view .js-ovl { text-align: center; background: linear-gradient(0deg, rgba(0,0,0,.65), transparent) !important; }`,
    max: `
      .js-view .js-section .sectionTitle { font-size: 1.3em !important; letter-spacing: -.015em; }`,
    prime: `
      .js-view .js-lib .cardText-secondary bdi::before { content: "✓ Included with Prime"; color: #1a98ff; font-weight: 700; margin-right: .6em; }
      .js-view .js-lib .cardText-secondary { color: rgba(255,255,255,.55) !important; }
      .js-view .js-cap-below .cardText-first { font-weight: 700 !important; }`,
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
    ${NF_TV} .js-view .js-lib.overflowPortraitCard { width: var(--js-port-w) !important; min-width: var(--js-port-w) !important; }
    ${NF_TV} .js-view .js-lib.overflowPortraitCard, ${NF_TV} .js-view .js-rank-card { transition: width .28s cubic-bezier(.2,.9,.25,1), min-width .28s cubic-bezier(.2,.9,.25,1); }
    ${NF_TV} .js-view .js-rank-poster { transition: width .28s cubic-bezier(.2,.9,.25,1), box-shadow .2s ease !important; }
    ${NF_TV} .js-view .js-open .cardImageContainer, ${NF_TV} .js-view .js-rank-card.js-open .js-rank-poster {
      border-radius: 12px !important; box-shadow: 0 0 0 3px #fff, 0 18px 40px rgba(0,0,0,.6) !important; transform: none !important; }
    ${NF_TV} .js-view .js-lib:not(.js-open):is(:hover) .cardImageContainer { transform: none !important; }
    .js-nf-wide { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
    /* no theme frames: plain artwork like Netflix */
    ${NF} .js-view .card, ${NF} .js-view .cardBox, ${NF} .js-view .cardScalable { border: 0 !important; outline: 0 !important; box-shadow: none !important; background: transparent !important; }
    ${NF} .js-view .card:not(.js-open) .cardImageContainer, ${NF} .js-view .js-rank-card:not(.js-open) .js-rank-poster { border: 0 !important; outline: 0 !important; box-shadow: none !important; }
    ${NF_TV} .js-view .card:not(.js-open) .cardImageContainer, ${NF_TV} .js-view .js-rank-card:not(.js-open) .js-rank-poster { border-radius: 6px !important; }
    /* movement: nothing scales; the open card only widens while the row slides. The spacer lets the last titles reach the left edge too */
    ${NF_TV} .js-view .js-lib .cardImageContainer, ${NF_TV} .js-view .js-rank-card .js-rank-poster,
    ${NF_TV} .js-view .js-lib:is(:hover,:focus-within,.show-focus,.focused) .cardImageContainer,
    ${NF_TV} .js-view .js-rank-card:is(:hover,:focus-within,.show-focus,.focused) .js-rank-poster { transform: none !important; }
    ${NF_TV} .js-view .js-scroller { scroll-behavior: smooth; }
    ${NF_TV} .js-view .js-scroller > .itemsContainer::after { content: ""; flex: 0 0 62vw; }
    ${NF_TV}.js-nf-card-open #__jf_library_focus_ring__ { opacity: 0 !important; }
    ${NF}.js-service-open #__jf_library_focus_ring__ { border-color: #fff !important; box-shadow: 0 0 0 1px rgba(0,0,0,.5) !important; border-radius: 12px !important; }
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
    ${NF_PH} .js-bb-content { left: 6% !important; right: 6% !important; width: auto !important; bottom: 4% !important; align-items: center; text-align: center; gap: .75em !important; }
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
    }).join('\n') + NETFLIX_CSS;
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
    .js-view .cardBox, .js-view .cardScalable {
      border: 0 !important; outline: 0 !important; background: transparent !important; box-shadow: none !important;
    }
    .js-view .cardBox::before, .js-view .cardBox::after { display: none !important; }
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
    const l = look();
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
      extra: badgesFor(it.Id, false),
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
    const rankPills = look().badges ? (owned ? badgesFor(t.ItemId, true) : '') : '';
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
  const EXPANDABLE = '.js-view .js-lib.overflowPortraitCard, .js-view .js-rank-card:not(.js-rank-land)';
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
      card.style.setProperty('--js-rank-cw', `calc(var(--js-poster-w, 150px) * ${WIDE + 0.62})`);
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
  const navScroll = (kind, el) => {
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
    if (!focusOn() || matchMedia('(pointer: coarse)').matches) return;
    const card = e.target.closest?.(EXPANDABLE);
    clearTimeout(nfTimer);
    if (card && card !== nfCard) nfTimer = setTimeout(() => nfOpen(card, false), 140);
  }, { passive: true });
  // keyboard focus
  document.addEventListener('focusin', (e) => {
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

    const tiles = cfg.Services.map((s) => {
      const n = s.Movies + s.Shows;
      const known = brandKeyFor(s);
      const b = known ? BRANDS[known] : null;
      const t1 = tintOf(s);
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
                ${s.Logo ? `<img class="js-tile-logo" src="${esc(s.Logo)}" alt="" loading="lazy">` : '<span class="js-tile-bar"></span>'}
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
    matchTileSize(sections, row);
    stubRows(row);
    warmIntros();
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
    const list = state.cfg.Services.filter((x) => introVersion(x) && !introBlobs.has(x.Key + introVersion(x)));
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
  const playIntroAnim = (svc) => {
    document.querySelector('.js-intro')?.remove();
    const k = brandKeyFor(svc) || 'generic';
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
        setTimeout(() => el.remove(), 400);
      }, wait);
    };
    setTimeout(done, 2200); // about two seconds at most, even if the page is still loading
    return done;
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
    if (svc && state.introKey !== key) state.introDone = playIntro(svc);
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
        <button type="button" class="js-back">Back to Home</button>
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
              ${icon ? `<span class="material-icons js-sw-icon">${icon}</span>` : logo ? `<img class="js-sw-logo" src="${esc(logo)}" alt="" loading="lazy">` : `<span class="js-sw-dot"></span>`}
              <span class="js-sw-name" style="${SW_TEXT}">${esc(name)}</span>
            </a>
          </div>
        </div>
      </div>`;
    rows.push(section({
      title: 'Services',
      cls: 'js-switcher',
      cards: [sw('#/home', 'Home', null, false, null, 'arrow_back')].concat(cfg.Services.map((x) =>
        sw(`#/home?${PARAM}=${encodeURIComponent(x.Key)}`, x.Name, x.Logo, x.Key === svc.Key, tintOf(x)))),
    }));

    const topMovies = section({ title: `Top ${cfg.TopCount} Movies ${span}`.trim(), cards: uniqueTop(data.topMovies).map(rankCard), cls: 'js-top', attrs: 'data-kind="movie"' });
    const topShows = section({ title: `Top ${cfg.TopCount} Shows ${span}`.trim(), cards: uniqueTop(data.topShows).map(rankCard), cls: 'js-top', attrs: 'data-kind="tv"' });
    const head = [];
    const body = [];

    if (cfg.ShowContinueWatching) {
      const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();
      const resume = data.resume.filter((it) => onService.has(norm(it.Id)) || onService.has(norm(it.SeriesId)));
      head.push(section({
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
      body.push(section({ title: `All Shows (${shows.length})`, cards: az.map(libraryCard), attrs: 'data-kind="tv"' }));
    }
    if (movies.length) {
      const az = [...movies].sort((a, b) => a.Name.localeCompare(b.Name)).slice(0, 120);
      body.push(section({ title: `All Movies (${movies.length})`, cards: az.map(libraryCard), attrs: 'data-kind="movie"' }));
    }

    // the two Top 10s never sit next to each other: shows near the top, movies a few rows later
    const filled = body.filter(Boolean);
    rows.push(...head, topShows, ...filled.slice(0, 3), topMovies, ...filled.slice(3));

    const html = rows.join('');
    renderBillboard(view, svc, data);
    const box = view.querySelector('.js-rows');
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
      // phones show the title's poster (portrait) instead of the wide backdrop
      const poster = owned
        ? window.ApiClient.getImageUrl(pick.ItemId, { type: 'Primary', fillHeight: 1000, quality: 85, ...(pick.PrimaryTag ? { tag: pick.PrimaryTag } : {}) })
          + (pick.Poster ? `|${pick.Poster.replace('/w342/', '/w780/')}` : '')
        : (pick.Poster || '').replace('/w342/', '/w780/');
      bb.innerHTML = `
        <div class="js-bb-art"></div>
        <div class="js-bb-poster js-img" data-src="${esc(poster)}"></div>
        <div class="js-bb-shade"></div>
        <div class="js-bb-content">
          <div class="js-bb-tag">${esc(isTv ? l.labels.tagTv : l.labels.tagMovie)}</div>
          <h2 class="js-bb-title">${owned && pick.LogoTag
            ? `<img class="js-bb-logo" src="${esc(logoUrl(pick.ItemId, pick.LogoTag))}" alt="${esc(pick.Name)}">`
            : esc(pick.Name)}</h2>
          <div class="js-bb-rank">#1 in ${rank}${when ? ` ${when}` : ''}</div>
          <div class="js-bb-tags">${esc(isTv ? 'Show' : 'Movie')}</div>
          <p class="js-bb-overview"></p>
          <div class="js-bb-actions">
            ${owned
              ? `<a class="js-bb-btn js-primary" href="${esc(detailsHref(pick.ItemId))}" data-id="${esc(pick.ItemId)}"><span class="material-icons">play_arrow</span>${esc(l.labels.play)}</a>`
              : `<button type="button" class="js-bb-btn js-primary js-bb-request" data-jstmdb="${pick.TmdbId}" data-jstype="${pick.Type}"><span class="material-icons">add</span>${esc(l.labels.request)}</button>`}
            ${owned && l.labels.info
              ? `<a class="js-bb-btn js-secondary" href="${esc(detailsHref(pick.ItemId))}" data-id="${esc(pick.ItemId)}"><span class="material-icons">info</span>${esc(l.labels.info)}</a>`
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
        const tags = bb.querySelector('.js-bb-tags');
        if (tags && d?.Genres?.length) {
          tags.innerHTML = [isTv ? 'Show' : 'Movie', ...d.Genres.slice(0, 3)].map((x, i) => `<span${i ? '' : ' class="js-strong"'}>${esc(x)}</span>`).join('<i>•</i>');
        }
      }).catch(() => {});
      const posterEl = bb.querySelector('.js-bb-poster');
      if (posterEl) posterEl.style.backgroundImage = bgOf(posterEl.dataset.src);
    }
    hero.replaceWith(bb);
    bb.appendChild(hero); // the service chip (logo, name, Back) sits in the corner
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
    } else if (base.jsPushed && base.jellystream) {
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
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const current = serviceKey();
    const heroImg = document.querySelector('.js-view .js-hero img');

    if (a.classList.contains('js-back') || a.getAttribute('href') === '#/home') {
      go({ key: null, from: heroImg, fromKey: current });
      return;
    }
    const key = new URLSearchParams(a.getAttribute('href').split('?')[1] || '').get(PARAM);
    if (!key || key === current) return;
    // the intro starts right here, inside the click / remote press, so browsers let it play sound
    const opening = state.cfg?.Services.find((x) => x.Key === key);
    if (opening && state.introKey !== key) {
      state.introDone = playIntro(opening);
      state.introKey = key;
    }
    // switching services replaces the entry, so Back still goes home; opening one adds an entry
    if (current) go({ key, from: null, replace: true });
    else navigate({ key });
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
    diag.add('nav', 'Jellyfin Home pressed: closing the service page');
    navigate({ key: null });
  }, true);

  // ---------------------------------------------------------------- main loop
  let busy = false;
  const sync = async () => {
    if (busy || !window.ApiClient || !userId()) return;
    if (!state.cfg && !state.cfgLoading) {
      state.cfgLoading = true;
      loadConfig().finally(() => { state.cfgLoading = false; diagUi(); });
    }
    if (!onHome()) {
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
        if (!painted.includes(sections.closest('[data-role="page"], .page, .mainAnimatedPage'))) paintPage(true);
      } else {
        if (painted.length) paintPage(false);
        closeService(sections);
        state.introKey = null;
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
    navScroll,
    refresh: () => { state.cfgAt = 0; state.data.clear(); document.querySelectorAll('.js-services, .js-view').forEach((e) => e.remove()); sync(); },
  };
})();
