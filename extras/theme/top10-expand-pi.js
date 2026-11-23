/*
 * Top 10 expand: JellyNav / Raspberry Pi version
 * Load after the top 10 script and the header script, instead of top10-expand.js.
 *
 * Built for slow GPUs:
 *  - the row changes size in one step, and the motion is done with transforms (cheap to animate)
 *  - no blur behind the info panel; the glass look comes from gradients and edges instead
 *  - the row backdrop is blurred once on a small canvas, then stretched up (no live blur filter)
 *  - no page-wide observers or mouse tracking; it only watches JellyNav's selection ring
 */
(() => {
  // ---- settings ----
  const KEY_DELAY = 200;     // ms the selection must rest on a poster before it opens or closes
  const ANIM = 170;          // ms for the slide/grow motion (0 = no animation, snaps instantly)
  const EASE = 'cubic-bezier(.2,.9,.25,1)'; // fast start, soft landing
  const RESERVE_HEIGHT = true; // keep room for the taller open poster, so opening never pushes the page below
  const GROW = 1.18;         // how much bigger the open poster gets (the row grows taller with it)
  const WIDTH_RATIO = 1.25;  // info panel width, as a fraction of the open poster's height
  const WIDTH_MIN = 260;     // px
  const WIDTH_MAX = 520;     // px
  const RADIUS = 12;         // poster corner radius, same as the top 10 script
  const ROW_BG = 0.4;        // how strongly the backdrop shows behind the whole row (0 = off)
  const PANEL_X = 14;        // same as the header script

  // speed-ups for the other two scripts (set any to false to keep the original look)
  const LITE_NUMBERS = true; // glass numbers without the live blur behind them (10 blur layers that redraw on every scroll)
  const CALM_HEADER = true;  // stop the pulsing dot animation, which redraws every frame
  const NO_EDGE_FADE = true; // drop the fade at the row edges; the fade mask makes every scroll frame expensive

  const EDGE = NO_EDGE_FADE ? PANEL_X + 16 : 70; // keep the open card this far inside the row edges
  const RING_ID = '__jf_library_focus_ring__';   // JellyNav's selection ring
  const FONT = '"Manrope", "SF Pro Display", "Inter", system-ui, sans-serif';

  if (!document.getElementById('mp-x-font')) {
    const l = document.createElement('link');
    l.id = 'mp-x-font';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&display=swap';
    document.head.appendChild(l);
  }

  // ---- styles ----
  document.getElementById('mp-x-css')?.remove();
  const css = document.createElement('style');
  css.id = 'mp-x-css';
  css.textContent = `
    /* line the row up along the bottom, so the open poster grows upward */
    .mp-top10 .itemsContainer { align-items: flex-end !important; }
    .mp-top10 .itemsContainer > .card { vertical-align: bottom !important; will-change: transform; }
    /* keep size changes inside the row from re-laying out the rest of the page */
    .mp-top10 .itemsContainer { contain: layout style; }

    /* glass info panel, tucked under the poster's right edge */
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
      white-space: normal;
      background:
        linear-gradient(160deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 36%),
        linear-gradient(135deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.02) 60%),
        rgba(18,20,27,.93);
      border: 1px solid rgba(255,255,255,.16);
      border-left: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 8px 20px rgba(0,0,0,.35);
      visibility: hidden;
      opacity: 0;
      transform: translateX(-10px);
      will-change: opacity, transform;
    }
    .mp-top10 .card.mp-x-open .mp-x {
      visibility: visible;
      opacity: 1;
      transform: none;
      transition: opacity ${Math.round(ANIM * 0.8)}ms ease-out, transform ${ANIM}ms ${EASE};
    }

    .mp-top10 .mp-x-art {
      position: absolute; inset: 0;
      background-size: cover;
      background-position: 60% 25%;
      opacity: 0;
      transition: opacity .2s ease-out;
      will-change: opacity;
    }
    .mp-top10 .mp-x-art.on { opacity: .85; }
    .mp-top10 .mp-x-shade {
      position: absolute; inset: 0;
      background:
        linear-gradient(90deg, rgba(14,16,22,.97) 0%, rgba(14,16,22,.8) 42%, rgba(14,16,22,.25) 100%),
        linear-gradient(0deg, rgba(14,16,22,.6) 0%, rgba(14,16,22,0) 45%);
    }

    .mp-top10 .mp-x-body {
      position: relative;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: .6em;
      padding: 1.25em 1.3em 1.2em calc(${RADIUS}px + 1.15em);
    }

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
      box-shadow: 0 0 0 3px rgba(255,255,255,.12), 0 0 8px rgba(255,255,255,.45);
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
    }
    .mp-top10 .mp-x-logo {
      display: block;
      max-width: 82%;
      max-height: 3.4em;
      object-fit: contain;
      object-position: left center;
    }

    .mp-top10 .mp-x-meta { display: flex; flex-wrap: wrap; gap: .4em; font-size: .76em; font-weight: 700; }
    .mp-top10 .mp-x-meta:empty { display: none; }
    .mp-top10 .mp-x-chip {
      padding: .3em .7em;
      border-radius: 999px;
      white-space: nowrap;
      color: rgba(255,255,255,.92);
      background: linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06));
      border: 1px solid rgba(255,255,255,.15);
    }
    .mp-top10 .mp-x-cert { background: transparent; border-color: rgba(255,255,255,.34); }
    .mp-top10 .mp-x-star { color: #ffd36e; font-weight: 800; margin-right: .3em; }

    .mp-top10 .mp-x-genres {
      font-size: .74em;
      font-weight: 700;
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
      color: rgba(255,255,255,.84);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* the open item's backdrop behind the whole row: a small, pre-blurred copy stretched up */
    .mp-x-bg {
      position: absolute;
      top: -0.8em; bottom: -0.4em;
      left: ${PANEL_X}px; right: ${PANEL_X}px;
      border-radius: 26px;
      overflow: hidden;
      z-index: -2;
      pointer-events: none;
      opacity: 0;
      transition: opacity .3s ease-out;
      will-change: opacity;
    }
    .mp-x-bg.live { opacity: 1; }
    .mp-x-bg > i {
      position: absolute; inset: 0;
      background-size: cover;
      background-position: center 30%;
      opacity: 0;
      transition: opacity .3s ease-out;
      will-change: opacity;
    }
    .mp-x-bg > i.on { opacity: ${ROW_BG}; }
    .mp-x-bg::after {
      content: "";
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(8,10,14,.05) 0%, rgba(8,10,14,.65) 100%);
    }

    ${LITE_NUMBERS ? `
    .mp-top10 .mp-glass { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
    .mp-top10 .mp-shade { display: none !important; }` : ''}
    ${CALM_HEADER ? `.mp-eyebrow::before { animation: none !important; }` : ''}
    ${NO_EDGE_FADE ? `.mp-fade { -webkit-mask-image: none !important; mask-image: none !important; }` : ''}
  `;
  document.head.appendChild(css);

  // ---- helpers ----
  const isTop = (card) => !!card?.querySelector('.cardScalable > .mp-rank');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setW = (card, px) => {
    for (const p of ['width', 'min-width', 'max-width']) card.style.setProperty(p, px, 'important');
  };
  const rowCards = (sec) => [...sec.querySelectorAll('.card')];
  const labelOf = (sec) =>
    /Shows/i.test(sec.querySelector('.sectionTitle, h2')?.textContent || '') ? 'shows' : 'movies';

  // ---- data from the Jellyfin server ----
  const serverBase = () => location.origin + location.pathname.replace(/\/web(\/.*)?$/, '');
  const items = new Map();
  const getItem = (id) => {
    if (!items.has(id)) {
      const p = (async () => {
        const a = window.ApiClient;
        if (a?.getItem) return a.getItem(a.getCurrentUserId(), id);
        const c = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}').Servers?.[0];
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
    if (a?.getImageUrl) return a.getImageUrl(id, { type, tag, maxWidth, quality: 80 });
    return `${serverBase()}/Items/${id}/Images/${type}?tag=${tag}&maxWidth=${maxWidth}&quality=80`;
  };
  const backdropOf = (it, w) =>
    it.BackdropUrl ? it.BackdropUrl.replace('/w1280/', w <= 480 ? '/w300/' : '/w780/')
    :     it.BackdropImageTags?.length ? imageUrl(it.Id, 'Backdrop', it.BackdropImageTags[0], w)
    : it.ParentBackdropImageTags?.length ? imageUrl(it.ParentBackdropItemId, 'Backdrop', it.ParentBackdropImageTags[0], w)
    : it.ImageTags?.Thumb ? imageUrl(it.Id, 'Thumb', it.ImageTags.Thumb, w)
    : null;
  const logoOf = (it) =>
    it.BackdropUrl ? null
    :     it.ImageTags?.Logo ? imageUrl(it.Id, 'Logo', it.ImageTags.Logo, 400)
    : it.ParentLogoImageTag ? imageUrl(it.ParentLogoItemId, 'Logo', it.ParentLogoImageTag, 400)
    : null;

  // download and decode off the main thread before showing, so the Pi doesn't stall mid-animation
  const images = new Map();
  const load = (url) => {
    if (!url) return Promise.resolve(null);
    if (!images.has(url)) {
      const i = new Image();
      i.src = url;
      images.set(url, (i.decode ? i.decode() : Promise.resolve()).then(() => url, () => null));
    }
    return images.get(url);
  };

  // row backdrop: blur a small copy once on a canvas, so stretching it up stays smooth (no pixels)
  const softs = new Map();
  const soft = (url) => {
    if (!url) return Promise.resolve(null);
    if (!softs.has(url)) {
      softs.set(url, load(url).then((ok) => new Promise((res) => {
        if (!ok) return res(null);
        try {
          const img = new Image();
          img.src = url;
          const W = 320, H = 180, pad = 24;
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          const x = c.getContext('2d');
          x.filter = 'blur(7px)';
          // draw a little past the edges so the blur doesn't fade to transparent at the sides
          const s = Math.max((W + pad * 2) / img.naturalWidth, (H + pad * 2) / img.naturalHeight);
          const w = img.naturalWidth * s, h = img.naturalHeight * s;
          x.drawImage(img, (W - w) / 2, (H - h) * 0.3, w, h);
          c.toBlob((b) => res(b ? URL.createObjectURL(b) : url), 'image/jpeg', 0.9);
        } catch {
          res(url); // e.g. the image came from another server and the canvas can't read it
        }
      })));
    }
    return softs.get(url);
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
        <div class="mp-x-eb">No. ${rowCards(sec).indexOf(card) + 1} ${sec.dataset.mpEyebrow ? esc(sec.dataset.mpEyebrow.replace(/^Trending /, "")) : `in ${labelOf(sec)} today`}</div>
        <div class="mp-x-head"><span class="mp-x-title">${esc(name)}</span></div>
        <div class="mp-x-meta"></div>
        <div class="mp-x-genres"></div>
        <div class="mp-x-ov"><p></p></div>
      </div>`;
    box.prepend(p); // first child, so the poster paints over the tucked-in edge
    return p;
  };

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

  // ---- backdrop behind the whole row (crossfades between two layers) ----
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

  // ---- motion: change the layout once, then slide everything from where it was (transforms only) ----
  // anything that isn't the motion itself (images, text, backdrop, scrolling) waits until it finishes
  let busyUntil = 0;
  const later = (fn) => setTimeout(fn, Math.max(0, busyUntil - performance.now()) + 16);

  const imp = (el, prop, val) => (val ? el.style.setProperty(prop, val, 'important') : el.style.removeProperty(prop));

  const flip = (sec, change) => {
    if (!ANIM) { change(); return; }
    busyUntil = performance.now() + ANIM + 30;
    const cards = rowCards(sec);
    const before = cards.map((c) => {
      const r = c.getBoundingClientRect();
      return { left: r.left, w: c.querySelector('.cardScalable')?.getBoundingClientRect().width || 0 };
    });
    change();
    // drop any motion still running, so the new positions are measured without it
    for (const c of cards) {
      imp(c, 'transition', 'none'); imp(c, 'transform', '');
      const b = c.querySelector('.cardScalable');
      if (b) { imp(b, 'transition', 'none'); imp(b, 'transform', ''); }
    }
    const moved = [];
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const on = (x) => x < innerWidth && x + r.width > 0;
      if (!on(r.left) && !on(before[i].left)) return; // off screen either way: just jump
      const dx = before[i].left - r.left;
      const box = c.querySelector('.cardScalable');
      const w = box?.getBoundingClientRect().width || 0;
      const s = w && before[i].w ? before[i].w / w : 1;
      if (Math.abs(dx) >= 1) {
        imp(c, 'transition', 'none');
        imp(c, 'transform', `translateX(${dx}px)`);
        moved.push(c);
      }
      if (box && Math.abs(s - 1) > 0.005) {
        imp(box, 'transition', 'none');
        imp(box, 'transform-origin', 'left bottom');
        imp(box, 'transform', `scale(${s})`);
        moved.push(box);
      }
    });
    if (!moved.length) return;
    void moved[0].offsetWidth;
    requestAnimationFrame(() => {
      for (const el of moved) {
        imp(el, 'transition', `transform ${ANIM}ms ${EASE}`);
        imp(el, 'transform', '');
      }
      setTimeout(() => { for (const el of moved) { imp(el, 'transition', ''); imp(el, 'transform-origin', ''); } }, ANIM + 40);
    });
  };

  const ensureVisible = (card) => {
    const sc = card.closest('.emby-scroller') || card.closest('.itemsContainer')?.parentElement;
    if (!sc) return;
    const r = card.getBoundingClientRect(), s = sc.getBoundingClientRect();
    let d = 0;
    if (r.right > s.right - EDGE) d = r.right - (s.right - EDGE);
    if (r.left - d < s.left + EDGE) d = r.left - (s.left + EDGE);
    if (Math.abs(d) < 2) return;
    if (/(auto|scroll)/.test(getComputedStyle(sc).overflowX)) sc.scrollBy({ left: d, behavior: 'smooth' });
    else if (sc.scrollToPosition && sc.getScrollPosition) sc.scrollToPosition(sc.getScrollPosition() + d, false);
  };

  // ---- open / close ----
  let open = null, tScroll;

  const shrink = (card) => {
    card.classList.remove('mp-x-open');
    if (card.dataset.mpxBase) {
      setW(card, card.dataset.mpxBase + 'px');
      card.querySelector('.cardBox')?.style.setProperty('margin-right', card.dataset.mpxMr + 'px', 'important');
    }
    delete card.dataset.mpxBase;
    delete card.dataset.mpxMr;
  };

  const collapse = ({ instant = false } = {}) => {
    const card = open;
    open = null;
    if (!card) return;
    const sec = card.closest('.mp-top10');
    if (card.isConnected && sec) {
      if (instant) shrink(card); else flip(sec, () => shrink(card));
    }
    setBg(sec, null);
  };

  const expand = (card) => {
    if (open && !open.isConnected) open = null;
    if (open === card || !card.isConnected || !isTop(card)) return;

    const box = card.querySelector('.cardScalable'), cb = card.querySelector('.cardBox');
    const base = parseFloat(card.style.width); // set by the top 10 script
    if (!box || !cb || !base) return;
    const sec = card.closest('.mp-top10');
    const prev = open && open.closest('.mp-top10') === sec ? open : null;
    if (open && !prev) collapse();

    const rect = box.getBoundingClientRect();
    const grow = Math.round(rect.width * (GROW - 1));
    const ph = rect.height * GROW;
    const E = Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, ph * WIDTH_RATIO)));
    const mr = parseFloat(cb.style.marginRight) || 0;
    const p = box.querySelector(':scope > .mp-x') || build(card, box);

    // one layout change for both cards: close the old one and open the new one together
    flip(sec, () => {
      if (prev) shrink(prev);
      card.dataset.mpxBase = base;
      card.dataset.mpxMr = mr;
      card.style.setProperty('--mpx-h', ph + 'px');
      card.style.setProperty('--mpx-w', (E + RADIUS - 6) + 'px');
      setW(card, base + grow + E + 'px');
      cb.style.setProperty('margin-right', mr + E + 'px', 'important');
      card.classList.add('mp-x-open');
    });
    open = card;

    later(() => {
      if (open !== card) return;
      if (p.dataset.filled) clampOv(p);
      if (p.dataset.bg) setBg(sec, p.dataset.bg);
    });

    if ((card.dataset.id || card.dataset.jstmdb) && !p.dataset.filled) {
      itemFor(card).then(async (it) => {
        if (!card.isConnected) return;
        await new Promise(later);
        fill(p, it);
        const [art, lu, small] = await Promise.all([
          load(backdropOf(it, 780)), load(logoOf(it)), soft(ROW_BG ? backdropOf(it, 480) : null),
        ]);
        await new Promise(later);
        if (lu) {
          const img = document.createElement('img');
          img.className = 'mp-x-logo';
          img.alt = it.Name || '';
          img.src = lu;
          p.querySelector('.mp-x-head').replaceChildren(img);
          clampOv(p);
        }
        if (art) {
          const a = p.querySelector('.mp-x-art');
          a.style.backgroundImage = `url("${art}")`;
          a.classList.add('on');
        }
        if (small) { p.dataset.bg = small; if (open === card) setBg(sec, small); }
      }).catch(() => {});
    }

    // fetch the neighbours' details now (text only), so the next one opens with its info ready
    const cards = rowCards(sec), i = cards.indexOf(card);
    for (const n of [cards[i + 1], cards[i - 1]]) if (n && isTop(n)) itemFor(n).catch(() => {});

    clearTimeout(tScroll);
    tScroll = setTimeout(() => open === card && ensureVisible(card), ANIM + 40);
  };

  // ---- reserve the open poster's extra height up front ----
  const reserve = () => {
    if (!RESERVE_HEIGHT) return;
    document.querySelectorAll('.mp-top10').forEach((sec) => {
      if (sec.dataset.mpxRes || (open && sec.contains(open))) return;
      const ic = sec.querySelector('.itemsContainer');
      const top = [...sec.querySelectorAll('.card')].find(isTop);
      const ph = top?.querySelector('.cardScalable')?.getBoundingClientRect().height;
      if (!ic || !ph) return;
      ic.style.minHeight = Math.ceil(ic.getBoundingClientRect().height + ph * (GROW - 1)) + 'px';
      sec.dataset.mpxRes = '1';
    });
  };
  const unreserve = () => document.querySelectorAll('.mp-top10[data-mpx-res]').forEach((sec) => {
    delete sec.dataset.mpxRes;
    sec.querySelector('.itemsContainer')?.style.removeProperty('min-height');
  });

  // ---- follow JellyNav's selection ring ----
  let ring = null, ringObs = null, tKey, lastCard;

  const ringCard = () => {
    if (!ring?.isConnected || ring.style.display === 'none' || ring.style.opacity === '0') return null;
    const b = ring.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    const x = Math.min(innerWidth - 2, Math.max(2, b.left + b.width / 2));
    const y = Math.min(innerHeight - 2, Math.max(2, b.top + b.height / 2));
    return document.elementFromPoint(x, y)?.closest?.('.card') || null;
  };

  // the ring moves every frame while the row scrolls or a poster grows; only look once it has stopped
  const settle = () => {
    clearTimeout(tKey);
    tKey = setTimeout(() => {
      const c = ringCard();
      if (c === lastCard) return;
      lastCard = c;
      reserve();
      if (c && isTop(c) && c.closest('.mp-top10')) expand(c);
      else if (open) collapse();
    }, KEY_DELAY);
  };

  const watchRing = () => {
    const r = document.getElementById(RING_ID);
    if (r === ring) return;
    ringObs?.disconnect();
    ring = r;
    lastCard = undefined;
    if (!r) return;
    ringObs = new MutationObserver(settle);
    ringObs.observe(r, { attributes: true, attributeFilter: ['style'] });
    settle();
  };
  watchRing();
  setInterval(() => {
    if (ring !== document.getElementById(RING_ID)) watchRing();
    if (open && !open.isConnected) { open = null; lastCard = undefined; }
    reserve();
  }, 1500);

  // clicking the info panel opens the item, same as the poster
  document.addEventListener('click', (e) => {
    const p = e.target.closest?.('.mp-x');
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    const card = p.closest('.card');
    (card.querySelector('.cardImageContainer.itemAction')
      || card.querySelector('a.cardImageContainer')
      || (card.classList.contains('itemAction') ? card : null)
      || card.querySelector('.cardImageContainer'))?.click();
  }, true);

  // close instantly before the top 10 script re-measures, and when leaving the page
  const snapClose = () => { clearTimeout(tKey); lastCard = undefined; collapse({ instant: true }); };
  addEventListener('resize', () => { snapClose(); unreserve(); });
  addEventListener('hashchange', snapClose);
  addEventListener('popstate', snapClose);
  document.addEventListener('viewbeforehide', snapClose, true);
})();
