/* JellyStream: glass Top 10 numbers for JellyStream's Top 10 rows (based on the Top 10 theme script). */
(async () => {
  if (window.__jstTop10) return;
  window.__jstTop10 = true;
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
  if (!document.getElementById('jst-top10-font')) {
    const l = document.createElement('link');
    l.id = 'jst-top10-font';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@800&display=swap';
    document.head.appendChild(l);
  }
  await Promise.race([document.fonts.load('800 100px Manrope'), new Promise(r => setTimeout(r, 2500))]);

  document.getElementById('jst-glass-svg')?.remove();
  document.documentElement.classList.remove('jst-refract');

  // ---- styles ----
  document.getElementById('jst-top10-css')?.remove();
  const css = document.createElement('style');
  css.id = 'jst-top10-css';
  css.textContent = `
    .jst-top10 .card::before { content: none !important; display: none !important; }

    /* clean poster edges: one radius on every layer, no theme frame behind the poster */
    .jst-top10 .cardScalable {
      overflow: visible !important;
      background-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      border-radius: ${RADIUS}px !important;
    }
    .jst-top10 .cardImageContainer,
    .jst-top10 .cardOverlayContainer,
    .jst-top10 .cardScalable img,
    .jst-top10 .cardScalable canvas {
      border-radius: ${RADIUS}px !important;
      border: none !important;
    }
    .jst-top10 .cardImageContainer {
      overflow: hidden !important;
      box-shadow: 0 14px 32px rgba(0,0,0,.45) !important;
      transition: filter .25s ease, box-shadow .25s ease;
    }

    /* stop the theme from highlighting the whole card (never touches the poster image) */
    .jst-top10 .card,
    .jst-top10 .card:is(:hover, :focus, :focus-within, .show-focus, .focused),
    .jst-top10 .card :is(.cardBox, .cardPadder, .cardFooter, .cardText):not(.cardImageContainer),
    .jst-top10 .card:is(:hover, :focus, :focus-within, .show-focus, .focused) :is(.cardBox, .cardScalable, .cardPadder, .cardFooter, .cardText):not(.cardImageContainer) {
      filter: none !important;
      background-color: transparent !important;
      box-shadow: none !important;
      outline: none !important;
      border-color: transparent !important;
      transform: none !important;
    }
    .jst-top10 .card :is(.cardBox, .cardScalable, .cardFooter, .cardPadder)::before,
    .jst-top10 .card :is(.cardBox, .cardScalable, .cardFooter, .cardPadder)::after,
    .jst-top10 .card::after {
      content: none !important;
      display: none !important;
    }

    /* poster-only highlight */
    .jst-top10 .card:is(:hover, :focus, :focus-within, .show-focus, .focused) .cardImageContainer {
      filter: brightness(1.12) !important;
      box-shadow:
        0 16px 36px rgba(0,0,0,.5),
        0 0 0 2px rgba(255,255,255,.55),
        0 0 24px rgba(255,255,255,.18) !important;
    }

    /* glass numbers */
    .jst-top10 .jst-rank { position: absolute; right: 100%; z-index: 3; pointer-events: none; user-select: none; }
    .jst-top10 .jst-rank > i { position: absolute; inset: 0; background-size: 100% 100%; background-repeat: no-repeat; }
    .jst-top10 .jst-shade {
      opacity: .55; filter: blur(12px); transform: translateY(8px);
      background-color: var(--js-c1, #000);
      -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
    }
    html[data-jst-num="outline"] .jst-top10 .jst-glass,
    html[data-jst-num="solid"] .jst-top10 .jst-glass { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
    .jst-top10 .jst-glass {
      -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      -webkit-backdrop-filter: blur(7px) saturate(180%) brightness(1.18);
      backdrop-filter: blur(7px) saturate(180%) brightness(1.18);
    }
  `;
  document.head.appendChild(css);

  // ---- render each number once: a shape mask + the glass surface ----
  const cache = new Map();
  // the service page sets the number style: glass (default), outline (dark fill, colored edge) or solid (gradient fill)
  const numStyle = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return { kind: v('--jst-num', 'glass'), a: v('--jst-num-a', '#ffffff'), b: v('--jst-num-b', '#aaaaaa') };
  };
  const render = (txt, st = { kind: 'glass' }) => {
    const ck = `${st.kind}|${st.a}|${st.b}|${txt}`;
    if (cache.has(ck)) return cache.get(ck);
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

    if (st.kind === 'outline' || st.kind === 'solid') {
      const out = { mask: null, art: null, w, h, pad, gw: L + R, gh: A + D };
      if (st.kind === 'outline') {
        // dark numeral with a thick colored edge (the classic streaming Top 10 look)
        gx.lineJoin = 'round';
        gx.lineWidth = 14;
        gx.strokeStyle = st.b;
        gx.strokeText(txt, ox, oy);
        gx.fillStyle = st.a;
        gx.fillText(txt, ox, oy);
        mx.lineJoin = 'round';
        mx.lineWidth = 14;
        mx.strokeStyle = '#000';
        mx.strokeText(txt, ox, oy);
      } else {
        const g = gx.createLinearGradient(0, pad, 0, h - pad);
        g.addColorStop(0, st.b);
        g.addColorStop(1, st.a);
        gx.fillStyle = g;
        gx.fillText(txt, ox, oy);
        gx.globalCompositeOperation = 'source-atop';
        const sheen = gx.createLinearGradient(0, pad, w, h - pad);
        sheen.addColorStop(0, 'rgba(255,255,255,0.3)');
        sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
        gx.fillStyle = sheen;
        gx.fillRect(0, 0, w, h);
      }
      out.mask = mc.toDataURL();
      out.art = gc.toDataURL();
      cache.set(ck, out);
      return out;
    }

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
    cache.set(ck, out);
    return out;
  };

  // ---- layout ----
  const setup = (sec) => {
    if (sec.dataset.jstGap) return true;
    const h = sec.querySelector('.card .cardScalable')?.getBoundingClientRect().height;
    if (!h) return false;
    const ph = h * SCALE;
    sec.dataset.jstGap = Math.round(ph * GAP_RATIO);
    sec.dataset.jstSize = Math.round(ph * NUM_RATIO);
    sec.classList.add('jst-top10');
    return true;
  };

  const setWidth = (card, px) => {
    for (const p of ['width', 'min-width', 'max-width']) card.style.setProperty(p, px, 'important');
    card.style.setProperty('flex', '0 0 auto', 'important');
  };

  const apply = () => {
    const secs = new Set();
    document.querySelectorAll('.verticalSection[data-jst-top10]').forEach(sec => secs.add(sec));
    const st = numStyle(), sig = `${st.kind}${st.a}${st.b}`;
    secs.forEach(sec => {
      if (!setup(sec)) return;
      const baseGap = +sec.dataset.jstGap, size = +sec.dataset.jstSize, ov = size * OVERLAP;

      sec.querySelectorAll('.card').forEach((card, i) => {
        const box = card.querySelector('.cardScalable');
        const cardBox = card.querySelector('.cardBox');
        if (!box || !cardBox) return;

        const after = i - MAX; // 0 = first card after the top 10
        const key = after < 0 ? String(i + 1) : 'p' + Math.min(after, TAPER + 1);
        const doneKey = after < 0 ? `${key}|${sig}` : key;
        if (card.dataset.jstDone === doneKey) return;

        if (!card.dataset.jstW) {
          const w = card.getBoundingClientRect().width;
          if (!w) return;
          card.dataset.jstW = w;
          card.dataset.jstMr = parseFloat(getComputedStyle(cardBox).marginRight) || 0;
        }
        const w = +card.dataset.jstW, mr = +card.dataset.jstMr;
        const mrT = Math.max(0, mr - TIGHTEN);
        const poster = w * SCALE - mr;
        cardBox.style.setProperty('margin-right', mrT + 'px', 'important');

        let rank = box.querySelector(':scope > .jst-rank');

        // after the top 10: one full empty slot, then ease back to normal spacing
        if (after >= 0) {
          rank?.remove();
          const t = Math.min(after, TAPER) / TAPER;            // 0 → 1 across the taper
          const ease = 1 - Math.pow(1 - t, 2);                 // ease-out for a smooth slowdown
          const ml = baseGap + (mrT - baseGap) * ease;
          cardBox.style.setProperty('margin-left', ml + 'px', 'important');
          setWidth(card, (poster + ml + mrT) + 'px');
          card.dataset.jstDone = doneKey;
          return;
        }

        const r = render(key, st);
        const s = size / r.gh;
        const gap = Math.max(baseGap, r.gw * s - ov + 6);
        cardBox.style.setProperty('margin-left', gap + 'px', 'important');
        setWidth(card, (poster + gap + mrT) + 'px');

        if (!rank) {
          rank = document.createElement('span');
          rank.className = 'jst-rank';
          rank.setAttribute('aria-hidden', 'true');
          rank.innerHTML = '<i class="jst-shade"></i><i class="jst-glass"></i>';
          box.appendChild(rank);
        }
        rank.style.width = r.w * s + 'px';
        rank.style.height = r.h * s + 'px';
        rank.style.bottom = -(r.pad * s) + 'px';
        rank.style.marginRight = -(r.pad * s + ov) + 'px';
        const glass = rank.querySelector('.jst-glass'), shade = rank.querySelector('.jst-shade');
        glass.style.backgroundImage = `url(${r.art})`;
        glass.style.webkitMaskImage = glass.style.maskImage = `url(${r.mask})`;
        shade.style.webkitMaskImage = shade.style.maskImage = `url(${r.mask})`;
        card.dataset.jstDone = doneKey;
      });
    });
  };

  const reset = () => {
    document.querySelectorAll('.jst-top10').forEach(sec => {
      sec.classList.remove('jst-top10');
      delete sec.dataset.jstGap;
      delete sec.dataset.jstSize;
      sec.querySelectorAll('.card').forEach(c => {
        for (const p of ['width', 'min-width', 'max-width', 'flex', 'display']) c.style.removeProperty(p);
        const cb = c.querySelector('.cardBox');
        cb?.style.removeProperty('margin-left');
        cb?.style.removeProperty('margin-right');
        delete c.dataset.jstW;
        delete c.dataset.jstMr;
        delete c.dataset.jstDone;
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