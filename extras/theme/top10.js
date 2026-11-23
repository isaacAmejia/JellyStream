(async () => {
  const TITLES = ['Most Popular Movies Today', 'Most Popular Shows Today'];
  const MAX = 10;          // how many items get a number
  const TAPER = 4;         // posters it takes to ease back to normal spacing after the top 10
  const SCALE = 0.95;      // poster size vs. default (1 = default)
  const GAP_RATIO = 0.34;  // space reserved for single-digit numbers, as a fraction of poster height
  const NUM_RATIO = 0.44;  // digit height, as a fraction of poster height
  const OVERLAP = 0.17;    // how far the digit reaches onto the poster, as a fraction of digit height
  const TIGHTEN = 10;      // px to pull cards closer together
  const RADIUS = 12;       // poster corner radius in px
  const FONT = '"Manrope", "SF Pro Display", "Inter", system-ui, sans-serif';

  // ---- font ----
  if (!document.getElementById('mp-top10-font')) {
    const l = document.createElement('link');
    l.id = 'mp-top10-font';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@800&display=swap';
    document.head.appendChild(l);
  }
  await Promise.race([document.fonts.load('800 100px Manrope'), new Promise(r => setTimeout(r, 2500))]);

  document.getElementById('mp-glass-svg')?.remove();
  document.documentElement.classList.remove('mp-refract');

  // ---- styles ----
  document.getElementById('mp-top10-css')?.remove();
  const css = document.createElement('style');
  css.id = 'mp-top10-css';
  css.textContent = `
    .mp-top10 .card::before { content: none !important; display: none !important; }

    /* clean poster edges: one radius on every layer, no theme frame behind the poster */
    .mp-top10 .cardScalable {
      overflow: visible !important;
      background-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      border-radius: ${RADIUS}px !important;
    }
    .mp-top10 .cardImageContainer,
    .mp-top10 .cardOverlayContainer,
    .mp-top10 .cardScalable img,
    .mp-top10 .cardScalable canvas {
      border-radius: ${RADIUS}px !important;
      border: none !important;
    }
    .mp-top10 .cardImageContainer {
      overflow: hidden !important;
      box-shadow: 0 14px 32px rgba(0,0,0,.45) !important;
      transition: filter .25s ease, box-shadow .25s ease;
    }

    /* stop the theme from highlighting the whole card (never touches the poster image) */
    .mp-top10 .card,
    .mp-top10 .card:is(:hover, :focus, :focus-within, .show-focus, .focused),
    .mp-top10 .card :is(.cardBox, .cardPadder, .cardFooter, .cardText):not(.cardImageContainer),
    .mp-top10 .card:is(:hover, :focus, :focus-within, .show-focus, .focused) :is(.cardBox, .cardScalable, .cardPadder, .cardFooter, .cardText):not(.cardImageContainer) {
      filter: none !important;
      background-color: transparent !important;
      box-shadow: none !important;
      outline: none !important;
      border-color: transparent !important;
      transform: none !important;
    }
    .mp-top10 .card :is(.cardBox, .cardScalable, .cardFooter, .cardPadder)::before,
    .mp-top10 .card :is(.cardBox, .cardScalable, .cardFooter, .cardPadder)::after,
    .mp-top10 .card::after {
      content: none !important;
      display: none !important;
    }

    /* poster-only highlight */
    .mp-top10 .card:is(:hover, :focus, :focus-within, .show-focus, .focused) .cardImageContainer {
      filter: brightness(1.12) !important;
      box-shadow:
        0 16px 36px rgba(0,0,0,.5),
        0 0 0 2px rgba(255,255,255,.55),
        0 0 24px rgba(255,255,255,.18) !important;
    }

    /* glass numbers */
    .mp-top10 .mp-rank { position: absolute; right: 100%; z-index: 3; pointer-events: none; user-select: none; }
    .mp-top10 .mp-rank > i { position: absolute; inset: 0; background-size: 100% 100%; background-repeat: no-repeat; }
    .mp-top10 .mp-shade { opacity: .45; filter: blur(10px); transform: translateY(10px); }
    .mp-top10 .mp-glass {
      -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      -webkit-backdrop-filter: blur(7px) saturate(180%) brightness(1.18);
      backdrop-filter: blur(7px) saturate(180%) brightness(1.18);
    }
  `;
  document.head.appendChild(css);

  // ---- render each number once: a shape mask + the glass surface ----
  const cache = new Map();
  const render = (txt) => {
    if (cache.has(txt)) return cache.get(txt);
    const fs = 400, pad = 28, font = `800 ${fs}px ${FONT}`;
    const spacing = txt.length > 1 ? '-24px' : '0px';
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    m.letterSpacing = spacing;
    const mt = m.measureText(txt);
    const L = mt.actualBoundingBoxLeft, R = mt.actualBoundingBoxRight;
    const A = mt.actualBoundingBoxAscent, D = mt.actualBoundingBoxDescent;
    const w = Math.ceil(L + R + pad * 2), h = Math.ceil(A + D + pad * 2);
    const ox = pad + L, oy = pad + A;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.font = font;
      x.letterSpacing = spacing;
      return [c, x];
    };

    const [mc, mx] = mk();
    mx.fillStyle = '#000';
    mx.fillText(txt, ox, oy);

    const [gc, gx] = mk();
    const tint = gx.createLinearGradient(0, pad, 0, h - pad);
    tint.addColorStop(0, 'rgba(255,255,255,0.34)');
    tint.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    tint.addColorStop(1, 'rgba(255,255,255,0.12)');
    gx.fillStyle = tint;
    gx.fillText(txt, ox, oy);
    gx.globalCompositeOperation = 'source-atop';

    const [nc, nx] = mk();
    const id = nx.createImageData(w, h);
    for (let k = 0; k < id.data.length; k += 4) {
      const v = Math.random() * 255;
      id.data[k] = id.data[k + 1] = id.data[k + 2] = v;
      id.data[k + 3] = Math.random() * 42;
    }
    nx.putImageData(id, 0, 0);
    gx.drawImage(nc, 0, 0);

    const sheen = gx.createLinearGradient(0, pad, w, h - pad);
    sheen.addColorStop(0, 'rgba(255,255,255,0.24)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
    gx.fillStyle = sheen;
    gx.fillRect(0, 0, w, h);

    const edge = (dx, dy, alpha) => {
      const [ec, ex] = mk();
      ex.fillStyle = '#fff';
      ex.fillText(txt, ox, oy);
      ex.globalCompositeOperation = 'destination-out';
      ex.fillText(txt, ox + dx, oy + dy);
      gx.globalAlpha = alpha;
      gx.drawImage(ec, 0, 0);
      gx.globalAlpha = 1;
    };
    edge(0, 5, 0.9);
    edge(4, 0, 0.35);
    edge(-3, 0, 0.25);
    edge(0, -3, 0.3);

    const out = { mask: mc.toDataURL(), art: gc.toDataURL(), w, h, pad, gw: L + R, gh: A + D };
    cache.set(txt, out);
    return out;
  };

  // ---- layout ----
  const setup = (sec) => {
    if (sec.dataset.mpGap) return true;
    const h = sec.querySelector('.card .cardScalable')?.getBoundingClientRect().height;
    if (!h) return false;
    const ph = h * SCALE;
    sec.dataset.mpGap = Math.round(ph * GAP_RATIO);
    sec.dataset.mpSize = Math.round(ph * NUM_RATIO);
    sec.classList.add('mp-top10');
    return true;
  };

  const setWidth = (card, px) => {
    for (const p of ['width', 'min-width', 'max-width']) card.style.setProperty(p, px, 'important');
    card.style.setProperty('flex', '0 0 auto', 'important');
  };

  const apply = () => {
    const secs = new Set();
    document.querySelectorAll('.sectionTitle, h2').forEach(t => {
      if (!TITLES.some(x => t.textContent.trim().startsWith(x))) return;
      const sec = t.closest('.verticalSection') || t.parentElement?.parentElement;
      if (sec) secs.add(sec);
    });
    // rows that ask for top 10 styling themselves (JellyStream service pages)
    document.querySelectorAll('.verticalSection[data-mp-top10]').forEach(sec => secs.add(sec));
    secs.forEach(sec => {
      if (!setup(sec)) return;
      const baseGap = +sec.dataset.mpGap, size = +sec.dataset.mpSize, ov = size * OVERLAP;

      sec.querySelectorAll('.card').forEach((card, i) => {
        const box = card.querySelector('.cardScalable');
        const cardBox = card.querySelector('.cardBox');
        if (!box || !cardBox) return;

        const after = i - MAX; // 0 = first card after the top 10
        const key = after < 0 ? String(i + 1) : 'p' + Math.min(after, TAPER + 1);
        if (card.dataset.mpDone === key) return;

        if (!card.dataset.mpW) {
          const w = card.getBoundingClientRect().width;
          if (!w) return;
          card.dataset.mpW = w;
          card.dataset.mpMr = parseFloat(getComputedStyle(cardBox).marginRight) || 0;
        }
        const w = +card.dataset.mpW, mr = +card.dataset.mpMr;
        const mrT = Math.max(0, mr - TIGHTEN);
        const poster = w * SCALE - mr;
        cardBox.style.setProperty('margin-right', mrT + 'px', 'important');

        let rank = box.querySelector(':scope > .mp-rank');

        // after the top 10: one full empty slot, then ease back to normal spacing
        if (after >= 0) {
          rank?.remove();
          const t = Math.min(after, TAPER) / TAPER;            // 0 → 1 across the taper
          const ease = 1 - Math.pow(1 - t, 2);                 // ease-out for a smooth slowdown
          const ml = baseGap + (mrT - baseGap) * ease;
          cardBox.style.setProperty('margin-left', ml + 'px', 'important');
          setWidth(card, (poster + ml + mrT) + 'px');
          card.dataset.mpDone = key;
          return;
        }

        const r = render(key);
        const s = size / r.gh;
        const gap = Math.max(baseGap, r.gw * s - ov + 6);
        cardBox.style.setProperty('margin-left', gap + 'px', 'important');
        setWidth(card, (poster + gap + mrT) + 'px');

        if (!rank) {
          rank = document.createElement('span');
          rank.className = 'mp-rank';
          rank.setAttribute('aria-hidden', 'true');
          rank.innerHTML = '<i class="mp-shade"></i><i class="mp-glass"></i>';
          box.appendChild(rank);
        }
        rank.style.width = r.w * s + 'px';
        rank.style.height = r.h * s + 'px';
        rank.style.bottom = -(r.pad * s) + 'px';
        rank.style.marginRight = -(r.pad * s + ov) + 'px';
        const glass = rank.querySelector('.mp-glass'), shade = rank.querySelector('.mp-shade');
        glass.style.backgroundImage = `url(${r.art})`;
        glass.style.webkitMaskImage = glass.style.maskImage = `url(${r.mask})`;
        shade.style.backgroundImage = `url(${r.mask})`;
        card.dataset.mpDone = key;
      });
    });
  };

  const reset = () => {
    document.querySelectorAll('.mp-top10').forEach(sec => {
      sec.classList.remove('mp-top10');
      delete sec.dataset.mpGap;
      delete sec.dataset.mpSize;
      sec.querySelectorAll('.card').forEach(c => {
        for (const p of ['width', 'min-width', 'max-width', 'flex', 'display']) c.style.removeProperty(p);
        const cb = c.querySelector('.cardBox');
        cb?.style.removeProperty('margin-left');
        cb?.style.removeProperty('margin-right');
        delete c.dataset.mpW;
        delete c.dataset.mpMr;
        delete c.dataset.mpDone;
      });
    });
    apply();
  };

  let queued = false, rt;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }).observe(document.body, { childList: true, subtree: true });
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(reset, 200); });
  apply();
})();