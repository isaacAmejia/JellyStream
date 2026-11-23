(() => {
  // ---- settings ----
  const HOVER_DELAY = 350;   // ms the mouse must rest on a poster before it opens (desktop mouse only)
  const KEY_DELAY = 280;     // ms a remote/keyboard selection must rest before it opens or closes (JellyNav)
  const LEAVE_DELAY = 160;   // ms after the mouse leaves the posters before the open card closes
  const DUR = 420;           // open/close animation length in ms
  const EASE = 'cubic-bezier(.22,.8,.24,1)';
  const GROW = 1.18;         // how much bigger the open poster gets (the row grows taller with it)
  const WIDTH_RATIO = 1.25;  // info panel width, as a fraction of the open poster's height
  const WIDTH_MIN = 260;     // px
  const WIDTH_MAX = 520;     // px
  const RADIUS = 12;         // poster corner radius, same as the top 10 script
  const EDGE = 70;           // keep the open card this far inside the row edges (panel inset + edge fade)
  const ROW_BG = 0.36;       // how strongly the backdrop shows behind the whole glass panel (0 = off)
  const PANEL_X = 14;        // same as the header script, so the row backdrop lines up with the glass panel
  const M_BREAKPOINT = 640;  // phone layout: no expanding
  const FONT = '"Manrope", "SF Pro Display", "Inter", system-ui, sans-serif';

  // ---- font: the other scripts only load weight 800, so lighter text would render bold ----
  if (!document.getElementById('mp-x-font')) {
    const l = document.createElement('link');
    l.id = 'mp-x-font';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap';
    document.head.appendChild(l);
  }

  // ---- styles ----
  document.getElementById('mp-x-css')?.remove();
  const css = document.createElement('style');
  css.id = 'mp-x-css';
  css.textContent = `
    @keyframes mpx-pulse {
      0%, 100% { opacity: 1;  box-shadow: 0 0 0 3px rgba(255,255,255,.12), 0 0 8px rgba(255,255,255,.5); }
      50%      { opacity: .5; box-shadow: 0 0 0 5px rgba(255,255,255,.03), 0 0 3px rgba(255,255,255,.15); }
    }

    /* the card widens to the right; the poster keeps its size */
    .mp-top10 .card.mp-x-anim {
      transition: width ${DUR}ms ${EASE}, min-width ${DUR}ms ${EASE}, max-width ${DUR}ms ${EASE} !important;
    }
    .mp-top10 .card.mp-x-anim .cardBox { transition: margin-right ${DUR}ms ${EASE} !important; }

    /* line the row up along the bottom, so the open poster grows upward and the row gets taller */
    .mp-top10 .itemsContainer { align-items: flex-end !important; }
    .mp-top10 .itemsContainer > .card { vertical-align: bottom !important; }

    /* glass info panel, tucked under the poster's right edge and revealed left to right */
    .mp-top10 .mp-x {
      position: absolute;
      top: 0; bottom: 0;
      left: calc(100% - ${RADIUS}px);
      width: var(--mpx-w, 0px);
      overflow: hidden;
      border-radius: 0 ${RADIUS + 4}px ${RADIUS + 4}px 0;
      font-family: ${FONT};
      font-size: clamp(11px, calc(var(--mpx-h, 300px) * .046), 17px);
      color: #fff;
      text-align: left;
      white-space: normal; /* the row is nowrap, which was squeezing text onto one line */
      cursor: pointer;
      pointer-events: none;
      background:
        linear-gradient(135deg, rgba(255,255,255,.11) 0%, rgba(255,255,255,.035) 60%),
        rgba(14,16,22,.55);
      -webkit-backdrop-filter: blur(20px) saturate(170%);
      backdrop-filter: blur(20px) saturate(170%);
      border: 1px solid rgba(255,255,255,.14);
      border-left: none;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.2),
        inset 0 -1px 0 rgba(255,255,255,.04),
        0 10px 28px rgba(0,0,0,.4);
      clip-path: inset(-40px 100% -40px 0);
      transition: clip-path ${DUR}ms ${EASE};
    }
    .mp-top10 .card.mp-x-open .mp-x {
      clip-path: inset(-40px -40px -40px 0);
      pointer-events: auto;
    }
    .mp-top10 .card.mp-x-open .mp-x { border-color: rgba(255,255,255,.2); }

    /* top sheen, like the glass numbers */
    .mp-top10 .mp-x::before {
      content: "";
      position: absolute; inset: 0;
      z-index: 1;
      pointer-events: none;
      background: linear-gradient(160deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 38%);
    }

    /* the item's backdrop, fading in from the right */
    .mp-top10 .mp-x-art {
      position: absolute; inset: 0;
      background-size: cover;
      background-position: 60% 25%;
      opacity: 0;
      transition: opacity .5s ease;
      -webkit-mask-image: linear-gradient(90deg, rgba(0,0,0,.2) 0%, #000 62%);
      mask-image: linear-gradient(90deg, rgba(0,0,0,.2) 0%, #000 62%);
    }
    .mp-top10 .mp-x-art.on { opacity: .9; }
    .mp-top10 .mp-x-shade {
      position: absolute; inset: 0;
      background:
        linear-gradient(90deg, rgba(10,12,18,.86) 0%, rgba(10,12,18,.62) 45%, rgba(10,12,18,.18) 100%),
        linear-gradient(0deg, rgba(10,12,18,.55) 0%, rgba(10,12,18,0) 45%);
    }

    .mp-top10 .mp-x-body {
      position: relative;
      z-index: 2;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: .6em;
      padding: 1.25em 1.3em 1.2em calc(${RADIUS}px + 1.15em);
      opacity: 0;
      transform: translateX(-12px);
      transition: opacity .2s ease, transform .45s ${EASE};
    }
    .mp-top10 .card.mp-x-open .mp-x-body {
      opacity: 1;
      transform: none;
      transition: opacity .3s ease .12s, transform .45s ${EASE} .08s;
    }

    /* jump straight to closed (used on resize and page changes) */
    .mp-top10 .card.mp-x-snap .mp-x,
    .mp-top10 .card.mp-x-snap .mp-x-body { transition: none !important; }

    .mp-top10 .mp-x-eb {
      display: flex;
      align-items: center;
      gap: .7em;
      font-size: .66em;
      font-weight: 700;
      letter-spacing: .24em;
      text-transform: uppercase;
      color: rgba(255,255,255,.62);
      white-space: nowrap;
    }
    .mp-top10 .mp-x-eb::before {
      content: "";
      flex: none;
      width: 5px; height: 5px;
      border-radius: 50%;
      background: #fff;
      animation: mpx-pulse 2.6s ease-in-out infinite;
    }

    .mp-top10 .mp-x-head { flex: none; }
    .mp-top10 .mp-x-title {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 1.45em;
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -.02em;
      color: #f5f7fa;
      text-shadow: 0 2px 12px rgba(0,0,0,.45);
    }
    .mp-top10 .mp-x-logo {
      display: block;
      max-width: 82%;
      max-height: 3.4em;
      object-fit: contain;
      object-position: left center;
      filter: drop-shadow(0 2px 10px rgba(0,0,0,.55));
    }

    .mp-top10 .mp-x-meta { display: flex; flex-wrap: wrap; gap: .4em; font-size: .76em; font-weight: 700; }
    .mp-top10 .mp-x-meta:empty { display: none; }
    .mp-top10 .mp-x-chip {
      padding: .3em .7em;
      border-radius: 999px;
      white-space: nowrap;
      color: rgba(255,255,255,.92);
      background: rgba(255,255,255,.09);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
    }
    .mp-top10 .mp-x-cert { background: transparent; border-color: rgba(255,255,255,.34); }
    .mp-top10 .mp-x-star { color: #ffd36e; font-weight: 800; margin-right: .3em; }

    .mp-top10 .mp-x-genres {
      font-size: .74em;
      font-weight: 600;
      letter-spacing: .06em;
      color: rgba(255,255,255,.58);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mp-top10 .mp-x-genres:empty { display: none; }

    .mp-top10 .mp-x-ov { flex: 1 1 auto; min-height: 0; overflow: hidden; }
    .mp-top10 .mp-x-ov p {
      margin: 0;
      font-size: .86em;
      font-weight: 400;
      line-height: 1.45;
      color: rgba(255,255,255,.82);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* the open item's backdrop behind the whole glass panel */
    .mp-x-bg {
      position: absolute;
      top: -0.8em; bottom: -0.4em;
      left: ${PANEL_X}px; right: ${PANEL_X}px;
      border-radius: 26px;
      overflow: hidden;
      z-index: -2;
      pointer-events: none;
      opacity: 0;
      transition: opacity .6s ease;
    }
    .mp-x-bg.live { opacity: 1; }
    .mp-x-bg > i {
      position: absolute;
      inset: -24px;
      background-size: cover;
      background-position: center 30%;
      opacity: 0;
      transform: scale(1.04);
      filter: blur(6px) saturate(1.15);
      transition: opacity .7s ease;
      -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,.9), rgba(0,0,0,.3));
      mask-image: linear-gradient(180deg, rgba(0,0,0,.9), rgba(0,0,0,.3));
    }
    .mp-x-bg > i.on { opacity: ${ROW_BG}; }
    .mp-x-bg::after {
      content: "";
      position: absolute; inset: 0;
      background: radial-gradient(120% 95% at 70% 0%, rgba(6,8,12,0) 0%, rgba(6,8,12,.5) 100%);
    }
    @media (max-width: ${M_BREAKPOINT}px) { .mp-x-bg { display: none; } }
    .layout-mobile .mp-x-bg { display: none; }
  `;
  document.head.appendChild(css);

  // ---- helpers ----
  const enabled = () =>
    !document.documentElement.classList.contains('layout-mobile') && innerWidth > M_BREAKPOINT;
  const canHover = matchMedia('(hover: hover)');
  const isTop = (card) => !!card?.querySelector('.cardScalable > .mp-rank');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setW = (card, px) => {
    for (const p of ['width', 'min-width', 'max-width']) card.style.setProperty(p, px, 'important');
  };
  const rankOf = (card) => [...card.closest('.mp-top10').querySelectorAll('.card')].indexOf(card) + 1;
  const labelOf = (sec) =>
    /Shows/i.test(sec.querySelector('.sectionTitle, h2')?.textContent || '') ? 'shows' : 'movies';

  // ---- data from the Jellyfin server ----
  const serverBase = () => location.origin + location.pathname.replace(/\/web(\/.*)?$/, '');
  const creds = () => {
    try { return JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}').Servers?.[0]; }
    catch { return null; }
  };

  const items = new Map();
  const getItem = (id) => {
    if (!items.has(id)) {
      const p = (async () => {
        const a = window.ApiClient;
        if (a?.getItem) return a.getItem(a.getCurrentUserId(), id);
        const c = creds();
        if (!c?.AccessToken) throw new Error('no session');
        const r = await fetch(`${serverBase()}/Users/${c.UserId}/Items/${id}`, {
          headers: { Authorization: `MediaBrowser Token="${c.AccessToken}"` },
        });
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })();
      p.catch(() => items.delete(id));
      items.set(id, p);
    }
    return items.get(id);
  };

  // JellyStream cards for titles you don't have carry a TMDB id instead of a Jellyfin id
  const itemFor = (card) => {
    if (card.dataset.id) return getItem(card.dataset.id);
    const tmdb = card.dataset.jstmdb, type = card.dataset.jstype;
    if (!tmdb || !window.ApiClient) return Promise.reject(new Error('no id'));
    const key = `tmdb:${type}:${tmdb}`;
    if (!items.has(key)) {
      const p = window.ApiClient.getJSON(window.ApiClient.getUrl('JellyStream/Details', { type, tmdbId: tmdb }));
      p.catch(() => items.delete(key));
      items.set(key, p);
    }
    return items.get(key);
  };

  const imageUrl = (id, type, tag, maxWidth) => {
    const a = window.ApiClient;
    if (a?.getImageUrl) return a.getImageUrl(id, { type, tag, maxWidth, quality: 85 });
    return `${serverBase()}/Items/${id}/Images/${type}?tag=${tag}&maxWidth=${maxWidth}&quality=85`;
  };
  const backdropOf = (it) =>
    it.BackdropUrl ? it.BackdropUrl
    :     it.BackdropImageTags?.length ? imageUrl(it.Id, 'Backdrop', it.BackdropImageTags[0], 1280)
    : it.ParentBackdropImageTags?.length ? imageUrl(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], 1280)
    : it.ImageTags?.Thumb ? imageUrl(it.Id, 'Thumb', it.ImageTags.Thumb, 1280)
    : null;
  const logoOf = (it) =>
    it.BackdropUrl ? null
    :     it.ImageTags?.Logo ? imageUrl(it.Id, 'Logo', it.ImageTags.Logo, 600)
    : it.ParentLogoImageTag ? imageUrl(it.ParentLogoItemId, 'Logo', it.ParentLogoImageTag, 600)
    : null;

  const images = new Map();
  const load = (url) => {
    if (!url) return Promise.resolve(null);
    if (!images.has(url)) {
      images.set(url, new Promise((res) => {
        const i = new Image();
        i.onload = () => res(url);
        i.onerror = () => res(null);
        i.src = url;
      }));
    }
    return images.get(url);
  };

  const prefetch = (card) => {
    itemFor(card).then((it) => { load(backdropOf(it)); load(logoOf(it)); }).catch(() => {});
  };

  // ---- the info panel ----
  const build = (card, box) => {
    const sec = card.closest('.mp-top10');
    const name = card.querySelector('.cardText')?.textContent.trim() || '';
    const p = document.createElement('div');
    p.className = 'mp-x';
    p.setAttribute('aria-hidden', 'true');
    p.innerHTML = `
      <i class="mp-x-art"></i><i class="mp-x-shade"></i>
      <div class="mp-x-body">
        <div class="mp-x-eb">No. ${rankOf(card)} ${sec.dataset.mpEyebrow ? esc(sec.dataset.mpEyebrow.replace(/^Trending /, "")) : `in ${labelOf(sec)} today`}</div>
        <div class="mp-x-head"><span class="mp-x-title">${esc(name)}</span></div>
        <div class="mp-x-meta"></div>
        <div class="mp-x-genres"></div>
        <div class="mp-x-ov"><p></p></div>
      </div>`;
    box.prepend(p); // first child, so the poster paints over the tucked-in edge
    return p;
  };

  // show as many whole lines of the description as fit
  const clampOv = (p) => {
    const box = p.querySelector('.mp-x-ov'), t = box.firstElementChild;
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 16;
    const n = Math.floor(box.clientHeight / lh);
    t.style.display = n < 1 || !t.textContent ? 'none' : '';
    t.style.webkitLineClamp = String(Math.max(1, n));
  };

  const fill = (p, it) => {
    if (p.dataset.filled) return;
    p.dataset.filled = '1';
    const series = it.Type === 'Series';
    const y0 = it.ProductionYear;
    const y1 = it.EndDate ? new Date(it.EndDate).getFullYear() : null;
    const year = !y0 ? ''
      : !series ? y0
      : it.Status === 'Continuing' ? `${y0}–Present`
      : y1 && y1 !== y0 ? `${y0}–${y1}` : y0;

    let len = '';
    if (series && it.ChildCount) len = `${it.ChildCount} Season${it.ChildCount === 1 ? '' : 's'}`;
    else if (it.RunTimeTicks) {
      const m = Math.round(it.RunTimeTicks / 6e8), h = Math.floor(m / 60), mm = m % 60;
      len = h ? `${h}h${mm ? ` ${mm}m` : ''}` : `${mm}m`;
    }

    const chips = [];
    if (year) chips.push(`<span class="mp-x-chip">${year}</span>`);
    if (it.OfficialRating) chips.push(`<span class="mp-x-chip mp-x-cert">${esc(it.OfficialRating)}</span>`);
    if (it.CommunityRating) chips.push(`<span class="mp-x-chip"><b class="mp-x-star">★</b>${it.CommunityRating.toFixed(1)}</span>`);
    if (len) chips.push(`<span class="mp-x-chip">${len}</span>`);

    p.querySelector('.mp-x-meta').innerHTML = chips.join('');
    p.querySelector('.mp-x-genres').textContent = (it.Genres || []).slice(0, 3).join('  ·  ');
    if (it.Name) p.querySelector('.mp-x-title').textContent = it.Name;
    p.querySelector('.mp-x-ov p').textContent = it.Overview || it.Taglines?.[0] || '';
    clampOv(p);
  };

  const setLogo = (p, url, name) => {
    const img = document.createElement('img');
    img.className = 'mp-x-logo';
    img.alt = name || '';
    img.src = url;
    p.querySelector('.mp-x-head').replaceChildren(img);
    clampOv(p);
  };

  const setArt = (p, url) => {
    const a = p.querySelector('.mp-x-art');
    a.style.backgroundImage = `url("${url}")`;
    a.classList.add('on');
    p.dataset.bg = url;
  };

  // ---- backdrop behind the whole glass panel (crossfades between two layers) ----
  const setBg = (sec, url) => {
    if (!sec || !ROW_BG || !sec.classList.contains('mp-feature')) return;
    let bg = sec.querySelector(':scope > .mp-x-bg');
    if (!url) { bg?.classList.remove('live'); return; }
    if (!bg) {
      bg = document.createElement('div');
      bg.className = 'mp-x-bg';
      bg.setAttribute('aria-hidden', 'true');
      bg.innerHTML = '<i></i><i></i>';
      sec.prepend(bg);
    }
    const [a, b] = bg.children;
    const on = a.classList.contains('on') ? a : b.classList.contains('on') ? b : null;
    if (on?.dataset.url !== url) {
      const next = on === a ? b : a;
      next.style.backgroundImage = `url("${url}")`;
      next.dataset.url = url;
      next.classList.add('on');
      on?.classList.remove('on');
    }
    bg.classList.add('live');
  };

  // ---- keep the open card inside the visible part of the row ----
  const ensureVisible = (card) => {
    const sc = card.closest('.emby-scroller') || card.closest('.itemsContainer')?.parentElement;
    if (!sc) return;
    const r = card.getBoundingClientRect(), s = sc.getBoundingClientRect();
    let d = 0;
    if (r.right > s.right - EDGE) d = r.right - (s.right - EDGE);
    if (r.left - d < s.left + EDGE) d = r.left - (s.left + EDGE);
    if (Math.abs(d) < 2) return;
    const native = /(auto|scroll)/.test(getComputedStyle(sc).overflowX) && sc.scrollWidth > sc.clientWidth;
    if (native) sc.scrollBy({ left: d, behavior: 'smooth' });
    else if (sc.scrollToPosition && sc.getScrollPosition) sc.scrollToPosition(sc.getScrollPosition() + d, false);
  };

  // ---- open / close ----
  let open = null, tScroll;

  const collapse = (card = open, { instant = false, keepBg = false } = {}) => {
    if (!card) return;
    if (instant) card.classList.add('mp-x-snap'), card.classList.remove('mp-x-anim');
    card.classList.remove('mp-x-open');
    if (card.dataset.mpxBase) {
      setW(card, card.dataset.mpxBase + 'px');
      card.querySelector('.cardBox')?.style.setProperty('margin-right', card.dataset.mpxMr + 'px', 'important');
    }
    delete card.dataset.mpxBase;
    delete card.dataset.mpxMr;
    if (!keepBg) setBg(card.closest('.mp-top10'), null);
    if (open === card) open = null;
  };

  const expand = (card) => {
    if (!enabled() || !card?.isConnected || !isTop(card)) return;
    if (open && !open.isConnected) open = null;
    if (open === card) return;

    const box = card.querySelector('.cardScalable'), cb = card.querySelector('.cardBox');
    const base = parseFloat(card.style.width); // set by the top 10 script
    if (!box || !cb || !base) return;
    const sec = card.closest('.mp-top10');
    if (open) collapse(open, { keepBg: open.closest('.mp-top10') === sec });

    const mr = parseFloat(cb.style.marginRight) || 0;
    const rect = box.getBoundingClientRect();
    const grow = Math.round(rect.width * (GROW - 1)); // extra poster width; height follows the poster shape
    const ph = rect.height * GROW;
    const E = Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, ph * WIDTH_RATIO)));
    card.dataset.mpxBase = base;
    card.dataset.mpxMr = mr;
    card.style.setProperty('--mpx-h', ph + 'px');
    card.style.setProperty('--mpx-w', (E + RADIUS - 6) + 'px');

    const p = box.querySelector(':scope > .mp-x') || build(card, box);
    card.classList.remove('mp-x-snap');
    card.classList.add('mp-x-anim');
    void p.offsetWidth; // start the animation from the closed state

    setW(card, base + grow + E + 'px');
    cb.style.setProperty('margin-right', mr + E + 'px', 'important');
    card.classList.add('mp-x-open');
    open = card;

    if (p.dataset.filled) clampOv(p);
    if (p.dataset.bg) setBg(sec, p.dataset.bg);

    if ((card.dataset.id || card.dataset.jstmdb) && !p.dataset.filled) {
      itemFor(card).then(async (it) => {
        if (!card.isConnected) return;
        fill(p, it);
        const [bu, lu] = await Promise.all([load(backdropOf(it)), load(logoOf(it))]);
        if (lu) setLogo(p, lu, it.Name);
        if (bu) { setArt(p, bu); if (open === card) setBg(sec, bu); }
      }).catch(() => {});
    }

    clearTimeout(tScroll);
    tScroll = setTimeout(() => open === card && ensureVisible(card), DUR + 30);
  };

  // ---- which input is in charge: mouse (hover) or keys/remote (selection) ----
  let lastInput = canHover.matches ? 'pointer' : 'key';
  addEventListener('keydown', () => { lastInput = 'key'; queueSync(); }, true);
  addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);

  // mouse: open after resting on a top 10 poster, swap straight to the next one, close when leaving
  let hoverCard = null, tHover;
  const onHover = (card) => {
    if (card === hoverCard) return;
    hoverCard = card;
    clearTimeout(tHover);
    if (card && isTop(card)) {
      prefetch(card);
      if (open !== card) tHover = setTimeout(() => expand(card), HOVER_DELAY);
    } else if (open) {
      tHover = setTimeout(() => collapse(), card ? HOVER_DELAY : LEAVE_DELAY);
    }
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !(e.movementX || e.movementY)) return; // ignore synthetic moves
    lastInput = 'pointer';
    if (!canHover.matches || !enabled()) return;
    onHover(e.target.closest?.('.mp-top10 .card') || null);
  }, { passive: true, capture: true });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'mouse' && !e.relatedTarget && lastInput === 'pointer') onHover(null);
  });

  // keys / remote: the selected top 10 card opens right away; anything else closes it
  let synced = false;
  const queueSync = () => {
    if (synced) return;
    synced = true;
    requestAnimationFrame(() => { synced = false; sync(); });
  };
  const sync = () => {
    if (lastInput !== 'key' || !enabled()) return;
    const sel = ringCard()
      || document.activeElement?.closest?.('.mp-top10 .card')
      || document.querySelector('.mp-top10 .card:is(.focused, .show-focus), .mp-top10 .card :is(.focused, .show-focus)')?.closest('.card');
    // wait until the selection settles, so fast D-pad presses don't open every poster on the way
    clearTimeout(tKey);
    if (sel && isTop(sel)) {
      if (open === sel) return;
      prefetch(sel);
      tKey = setTimeout(() => expand(sel), KEY_DELAY);
    } else if (open) {
      tKey = setTimeout(() => collapse(), KEY_DELAY);
    }
  };
  let tKey;
  document.addEventListener('focusin', queueSync);
  document.addEventListener('focusout', queueSync);

  // JellyNav: it never moves browser focus and swallows key presses, but it draws one floating
  // ring over the selected poster. Watch that ring and open whichever card sits under it.
  const RING_ID = '__jf_library_focus_ring__';
  let ring = null, ringObs = null, lastRing, ringQueued = false;

  const ringCard = () => {
    if (!ring?.isConnected || ring.style.display === 'none' || ring.style.opacity === '0') return null;
    const b = ring.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    // centre of the ring, kept on screen in case the poster is partly scrolled out of view
    const x = Math.min(innerWidth - 2, Math.max(2, b.left + b.width / 2));
    const y = Math.min(innerHeight - 2, Math.max(2, b.top + b.height / 2));
    return document.elementFromPoint(x, y)?.closest?.('.card') || null;
  };

  const onRing = () => {
    if (ringQueued) return;
    ringQueued = true;
    requestAnimationFrame(() => {
      ringQueued = false;
      const c = ringCard();
      if (c === lastRing) return; // same card (the ring also moves while the poster grows or the row scrolls)
      lastRing = c;
      lastInput = 'key';
      clearTimeout(tHover);
      hoverCard = null;
      sync();
    });
  };

  const watchRing = () => {
    const r = document.getElementById(RING_ID);
    if (r === ring) return;
    ringObs?.disconnect();
    ring = r;
    lastRing = undefined;
    if (!r) return;
    ringObs = new MutationObserver(onRing);
    ringObs.observe(r, { attributes: true, attributeFilter: ['style'] });
    onRing();
  };
  watchRing();

  // clicking the info panel opens the item, same as clicking the poster
  document.addEventListener('click', (e) => {
    const p = e.target.closest?.('.mp-x');
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    const card = p.closest('.card');
    const target = card.querySelector('.cardImageContainer.itemAction')
      || card.querySelector('a.cardImageContainer')
      || (card.classList.contains('itemAction') ? card : null)
      || card.querySelector('.cardImageContainer');
    target?.click();
  }, true);

  // close instantly before the top 10 script re-measures, and when leaving the page
  const snapClose = () => { clearTimeout(tHover); clearTimeout(tKey); hoverCard = null; collapse(open, { instant: true }); };
  addEventListener('resize', snapClose);
  addEventListener('hashchange', snapClose);
  addEventListener('popstate', snapClose);
  document.addEventListener('viewbeforehide', snapClose, true);

  // selection classes added by TV navigation, and rows being re-rendered
  new MutationObserver((ms) => {
    if (open && !open.isConnected) open = null;
    if (ring !== document.getElementById(RING_ID)) watchRing();
    if (lastInput !== 'key') return;
    for (const m of ms) {
      if (m.type === 'attributes' && m.target.closest?.('.mp-top10')) { queueSync(); break; }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
})();
