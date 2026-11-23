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
    /* service tiles on the home screen */
    .js-services .js-svc-card .cardImageContainer {
      border-radius: 18px !important;
      overflow: hidden;
      display: flex !important;
      align-items: center;
      justify-content: center;
      background:
        radial-gradient(120% 120% at 20% 0%, color-mix(in srgb, var(--js-accent, #8899aa) 55%, transparent) 0%, transparent 60%),
        linear-gradient(160deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,.03) 45%, rgba(0,0,0,.25) 100%),
        rgba(22,24,30,.92) !important;
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 12px 28px rgba(0,0,0,.35);
    }
    .js-services .js-svc-card .js-logo {
      width: 34%;
      aspect-ratio: 1;
      border-radius: 22%;
      object-fit: cover;
      box-shadow: 0 8px 22px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.12);
      transition: transform .25s ease;
    }
    .js-services .js-svc-card .js-logo-text {
      font: 800 1.4em/1.1 ${FONT};
      letter-spacing: -.02em;
      color: #fff;
      text-align: center;
      padding: 0 .6em;
    }
    .js-services .js-svc-card:is(:hover, :focus-within) .js-logo { transform: scale(1.06); }
    .js-services .cardText-secondary { opacity: .6; }

    /* service page */
    .js-hide-native > :not(.js-view) { display: none !important; }
    /* the featured banner (Media Bar etc.) belongs to the normal home screen */
    html.js-service-open #slides-container,
    html.js-service-open .js-hide-with-service { display: none !important; }
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
        radial-gradient(90% 140% at 0% 0%, color-mix(in srgb, var(--js-accent, #8899aa) 45%, transparent) 0%, transparent 65%),
        linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.015));
      border: 1px solid rgba(255,255,255,.09);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 20px 50px rgba(0,0,0,.25);
    }
    .js-hero img {
      width: 72px; height: 72px; border-radius: 18px; object-fit: cover; flex: none;
      box-shadow: 0 10px 26px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.14);
    }
    .js-hero .js-eyebrow {
      font-size: .72em; font-weight: 700; letter-spacing: .26em; text-transform: uppercase;
      color: rgba(255,255,255,.55);
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
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      scroll-behavior: smooth;
      padding: 0 3.3%;
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
      if (el.dataset.src) el.style.backgroundImage = `url("${el.dataset.src}")`;
    }
  }, { rootMargin: '400px 600px' }) : null;
  const lazy = (root) => root.querySelectorAll('.js-img[data-src]').forEach((el) => {
    if (io) io.observe(el); else el.style.backgroundImage = `url("${el.dataset.src}")`;
  });

  // ---------------------------------------------------------------- cards
  const imgUrl = (id) => window.ApiClient.getImageUrl(id, { type: 'Primary', maxHeight: 480, quality: 90 });

  const card = ({ id, name, sub, img, href, cls = '', attrs = '', badge = '', type = '' }) => `
    <div class="card overflowPortraitCard card-hoverable js-card ${cls}" ${id ? `data-id="${esc(id)}" data-serverid="${esc(serverId())}"` : ''} ${type ? `data-type="${type}"` : ''} ${attrs}>
      <div class="cardBox cardBox-bottompadded">
        <div class="cardScalable">
          <div class="cardPadder cardPadder-overflowPortrait"></div>
          <a class="cardImageContainer coveredImage cardContent itemAction js-img" href="${esc(href)}" aria-label="${esc(name)}" ${img ? `data-src="${esc(img)}"` : ''}></a>
          ${badge}
        </div>
        <div class="cardFooter">
          <div class="cardText cardTextCentered cardText-first"><bdi>${esc(name)}</bdi></div>
          <div class="cardText cardTextCentered cardText-secondary"><bdi>${esc(sub ?? '')}</bdi></div>
        </div>
      </div>
    </div>`;

  const detailsHref = (id) => `#/details?id=${id}&serverId=${serverId()}`;

  const libraryCard = (it) => card({
    id: it.Id,
    name: it.Name,
    sub: it.Year || '',
    img: imgUrl(it.Id),
    href: detailsHref(it.Id),
    type: it.Type === 'tv' ? 'Series' : 'Movie',
  });

  const BADGES = {
    missing: '<span class="js-badge" title="Not in your library"><span class="material-icons">add</span></span>',
    requested: '<span class="js-badge js-requested" title="Requested"><span class="material-icons">schedule</span></span>',
    partial: '<span class="js-badge" title="Partly available"><span class="material-icons">timelapse</span></span>',
  };

  const titleCard = (t) => {
    if (t.ItemId) {
      return card({
        id: t.ItemId, name: t.Name, sub: t.Year || '', img: imgUrl(t.ItemId),
        href: detailsHref(t.ItemId), type: t.Type === 'tv' ? 'Series' : 'Movie',
        badge: t.Status === 'partial' ? BADGES.partial : '',
      });
    }
    const status = t.Status === 'available' ? 'missing' : t.Status;
    return card({
      name: t.Name,
      sub: t.Year || '',
      img: t.Poster,
      href: '#',
      cls: 'js-missing',
      attrs: `data-jstmdb="${t.TmdbId}" data-jstype="${t.Type}" data-jsstatus="${status}"`,
      badge: BADGES[status] || BADGES.missing,
    });
  };

  const section = ({ title, cards, attrs = '', cls = '' }) => cards.length ? `
    <div class="verticalSection js-section ${cls}" ${attrs}>
      <div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
        <h2 class="sectionTitle sectionTitle-cards">${esc(title)}</h2>
      </div>
      <div class="emby-scroller js-scroller">
        <div class="itemsContainer scrollSlider focuscontainer-x">${cards.join('')}</div>
      </div>
    </div>` : '';

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
      return `
      <div class="card overflowBackdropCard card-hoverable js-svc-card" data-jskey="${esc(s.Key)}">
        <div class="cardBox cardBox-bottompadded">
          <div class="cardScalable">
            <div class="cardPadder cardPadder-overflowBackdrop"></div>
            <a class="cardImageContainer cardContent itemAction" href="#/home?${PARAM}=${encodeURIComponent(s.Key)}" aria-label="${esc(s.Name)}">
              ${s.Logo ? `<img class="js-logo" src="${esc(s.Logo)}" alt="" loading="lazy" crossorigin="anonymous">` : `<span class="js-logo-text">${esc(s.Name)}</span>`}
            </a>
          </div>
          <div class="cardFooter">
            <div class="cardText cardTextCentered cardText-first"><bdi>${esc(s.Name)}</bdi></div>
            <div class="cardText cardTextCentered cardText-secondary"><bdi>${n ? `${n} title${n === 1 ? '' : 's'}` : 'Browse'}</bdi></div>
          </div>
        </div>
      </div>`;
    });

    const wrap = document.createElement('div');
    wrap.innerHTML = section({ title: cfg.HomeRowTitle || 'Streaming services', cards: tiles, cls: 'js-services' });
    row = wrap.firstElementChild;
    row.dataset.v = String(state.cfgAt);
    if (cfg.HomeRowPosition === 'bottom') sections.appendChild(row); else sections.prepend(row);

    cfg.Services.forEach((s) => autoAccent(s).then((col) => {
      if (col) row.querySelector(`[data-jskey="${CSS.escape(s.Key)}"]`)?.style.setProperty('--js-accent', col);
    }));
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
    view.className = 'js-view';
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
    const top = (label) => `data-mp-top10="1" data-mp-label="${label}" data-mp-eyebrow="Trending on ${esc(svc.Name)}"`;
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

    rows.push(section({ title: `Top ${cfg.TopCount} Movies on ${svc.Name}`, cards: data.topMovies.map(titleCard), attrs: top('Movies') }));
    rows.push(section({ title: `Top ${cfg.TopCount} Shows on ${svc.Name}`, cards: data.topShows.map(titleCard), attrs: top('Shows') }));

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
      rows.push(section({ title: 'Popular Movies to Request', cards: data.missMovies.map(titleCard) }));
      rows.push(section({ title: 'Popular Shows to Request', cards: data.missShows.map(titleCard) }));
    }

    const html = rows.join('');
    const box = view.querySelector('.js-rows');
    box.innerHTML = html || `<div class="js-empty">Nothing from ${esc(svc.Name)} yet. If you just set JellyStream up, run the sync from its settings page.</div>`;
    lazy(box);
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

  // clicks: service tiles, back button, and titles you don't have
  document.addEventListener('click', (e) => {
    const missing = e.target.closest?.('.js-missing');
    if (missing && !e.target.closest('.mp-x')) {
      e.preventDefault();
      e.stopPropagation();
      request(missing);
      return;
    }
    if (e.target.closest?.('.js-back')) {
      e.preventDefault();
      if (history.length > 1) history.back(); else location.hash = '#/home';
    }
  }, true);

  // ---------------------------------------------------------------- main loop
  let busy = false;
  const sync = async () => {
    if (busy || !window.ApiClient || !userId()) return;
    const h = location.hash || '';
    if (!/^#!?\/home/i.test(h) && h !== '' && h !== '#/') {
      document.documentElement.classList.remove('js-service-open');
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
