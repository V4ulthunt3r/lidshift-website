/* The lid demo.
   LidShift is one continuous gesture, so the page lets you perform it:
   grab the lid, move it, and the mock desktop answers on the same frame.
   Motion is spring-based and therefore interruptible — you can catch the
   lid mid-settle and take it the other way without waiting. */
(() => {
  const stage = document.querySelector('[data-lid-stage]');
  if (!stage) return;

  const hinge     = stage.querySelector('[data-lid]');
  const screen    = stage.querySelector('[data-screen]');
  const gaugeArm  = document.querySelector('[data-gauge-arm]');
  const gaugeArc  = document.querySelector('[data-gauge-arc]');
  const readout   = document.querySelector('[data-angle-value]');
  const slider    = document.querySelector('[data-angle-slider]');
  const caption   = document.querySelector('[data-caption-out]');
  const hint      = document.querySelector('[data-hint]');
  /* Scoped to the picker: the screen itself also carries data-effect. */
  const cards     = Array.from(document.querySelectorAll('.fx-card[data-effect]'));

  const MIN = 12, MAX = 132, REST = 106;
  const START_ANGLE = 90;          // the app's default arming angle
  const CLOSED = 20;               // full effect progress, as in FoldSettings
  const MAX_FLICK = 480;           // degrees per second a throw may carry
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let angle = REST;                // the presentation value — the only truth
  let velocity = 0;                // degrees per second
  let target = null;               // non-null while a spring is running
  let dragging = false;
  let touched = false;
  let raf = null;
  let effect = 'glass';

  /* ---- easing helpers ------------------------------------------------- */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  /* Apple's projection from Designing Fluid Interfaces. A hinge carries only
     a little, so the deceleration rate is well below scroll's 0.998. */
  const project = (v, rate = 0.975) => (v / 1000) * rate / (1 - rate);
  /* Progressive resistance past a bound instead of a hard stop. */
  const rubberband = (overshoot, range, c = 0.55) =>
    (overshoot * range * c) / (range + c * Math.abs(overshoot));

  /* ---- painting -------------------------------------------------------- */
  function paint() {
    const shown = clamp(angle, 0, 180);
    const p = clamp((START_ANGLE - shown) / (START_ANGLE - CLOSED), 0, 1);

    /* The lid tips about its hinge. Rotation is compressed against the real
       angle so the desktop stays legible at every position; the gauge beside
       it reports the true degrees. */
    const tilt = (shown - START_ANGLE) * 0.52;
    hinge.style.transform = `perspective(1400px) rotateX(${tilt}deg)`;

    readout.textContent = Math.round(shown);
    hinge.setAttribute('aria-valuenow', Math.round(shown));
    hinge.setAttribute('aria-valuetext', hinge.dataset.valuetext
      ? hinge.dataset.valuetext.replace('%d', Math.round(shown))
      : Math.round(shown) + '\u00B0');
    if (slider && document.activeElement !== slider) slider.value = Math.round(shown);

    /* The gauge repeats the app icon: a hinge and an amber arc. */
    if (gaugeArm && gaugeArc) {
      gaugeArm.setAttribute('transform', `rotate(${-shown} 10 46)`);
      const r = 26;
      const rad = shown * Math.PI / 180;
      const x = 10 + r * Math.cos(rad);
      const y = 46 - r * Math.sin(rad);
      gaugeArc.setAttribute('d', `M ${10 + r} 46 A ${r} ${r} 0 0 0 ${x.toFixed(2)} ${y.toFixed(2)}`);
    }

    /* One set of variables drives every effect layer; each layer reads the
       ones it needs, matching the ranges in FoldShaders.metal. */
    const s = screen.style;
    s.setProperty('--p', p.toFixed(4));
    s.setProperty('--dim', (p * 0.6).toFixed(4));

    if (effect === 'glass')   s.setProperty('--edge', (-25 + 150 * p).toFixed(2));
    if (effect === 'shutter') s.setProperty('--edge', (-4 + 108 * p).toFixed(2));
    if (effect === 'paper') {
      s.setProperty('--edge', (-9 + 119 * p).toFixed(2));
      s.setProperty('--roll', smoothstep(0, 0.16, p).toFixed(3));
    }
    if (effect === 'crt') {
      const collapse = smoothstep(0, 0.88, p);
      const band = (1 - collapse) * 100 + collapse * 0.3;
      s.setProperty('--band', band.toFixed(3));
      s.setProperty('--collapse', (band / 100).toFixed(4));
      s.setProperty('--line', smoothstep(0.65, 0.9, p).toFixed(3));
      s.setProperty('--fade', (1 - smoothstep(0.9, 1, p)).toFixed(3));
    } else {
      s.setProperty('--collapse', '1');
      s.setProperty('--fade', '1');
    }
    if (effect === 'burn') {
      /* The front starts just offscreen and moves inward by the same distance
         from every edge, measured in screen heights, as in the shader. */
      s.setProperty('--burn', Math.min(50, -2.5 + 66.5 * p).toFixed(2));
      s.setProperty('--ember', (smoothstep(0, 0.03, p) * (1 - smoothstep(0.84, 0.9, p))).toFixed(3));
      s.setProperty('--out', (1 - smoothstep(0.94, 1, p)).toFixed(3));
    }
    if (effect === 'freeze') paintFreeze(p);
    if (effect === 'dust') paintDust(p);
  }

  /* ---- Freeze & Shatter ------------------------------------------------- */
  /* The desktop is cut into triangular shards on a jittered grid — half the
     app's 16×10 mesh — each holding its own copy of the scene. Frost and
     cracks build first; from halfway on, shards turn, narrow and fall. */
  const freezeLayer = screen.querySelector('.fx-freeze');
  const iceMatrix = document.querySelector('[data-ice-matrix]');
  const iceRime = document.querySelector('[data-ice-rime]');
  const iceBend = document.querySelector('[data-ice-bend]');
  const hash = (x, y) => {
    const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * fx;
    const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  let shards = null;

  function buildShards() {
    const COLS = 8, ROWS = 5;
    const source = screen.querySelector('.desktop');
    const point = (gx, gy) => {
      let jx = hash(gx, gy) - 0.5, jy = hash(gx + 53.2, gy) - 0.5;
      if (gx === 0 || gx === COLS) jx = 0;
      if (gy === 0 || gy === ROWS) jy = 0;
      return [(gx + jx * 0.65) / COLS * 100, (gy + jy * 0.65) / ROWS * 100];
    };
    shards = [];
    const frag = document.createDocumentFragment();
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const c = [point(gx, gy), point(gx + 1, gy), point(gx, gy + 1), point(gx + 1, gy + 1)];
        [[c[0], c[1], c[2]], [c[2], c[1], c[3]]].forEach((tri, t) => {
          const poly = tri.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(',');
          const el = document.createElement('div');
          el.className = 'shard';
          el.style.clipPath = `polygon(${poly})`;
          const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
          const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          el.style.transformOrigin = `${cx.toFixed(2)}% ${cy.toFixed(2)}%`;
          el.appendChild(source.cloneNode(true));
          const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          edges.setAttribute('viewBox', '0 0 100 100');
          edges.setAttribute('preserveAspectRatio', 'none');
          edges.setAttribute('aria-hidden', 'true');
          const pts = tri.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
          edges.innerHTML = `<polygon class="rim" points="${pts}"/><polygon class="crack" points="${pts}"/>`;
          el.appendChild(edges);
          frag.appendChild(el);
          shards.push({ el, edges, cx: cx / 100, random: hash(gx + t * 31, gy + 17) });
        });
      }
    }
    freezeLayer.appendChild(frag);
  }

  function paintFreeze(p) {
    if (!freezeLayer) return;
    if (!shards) buildShards();
    const frost = smoothstep(0, 0.36, p);
    const out = 1 - smoothstep(0.88, 1, p);
    /* Translucent blue ice: color * (0.43, 0.72, 0.91) + (0.12, 0.24, 0.34). */
    if (iceMatrix) {
      const k = frost * 0.85;
      const row = (m) => (1 - k + k * m).toFixed(3);
      iceMatrix.setAttribute('values',
        `${row(0.43)} 0 0 0 ${(k * 0.12).toFixed(3)} ` +
        `0 ${row(0.72)} 0 0 ${(k * 0.24).toFixed(3)} ` +
        `0 0 ${row(0.91)} 0 ${(k * 0.34).toFixed(3)} ` +
        `0 0 0 1 0`);
    }
    if (iceRime) iceRime.setAttribute('slope', (frost * 0.42).toFixed(3));
    if (iceBend) iceBend.setAttribute('scale', (frost * 5).toFixed(2));
    for (const sh of shards) {
      const r = sh.random;
      const a = smoothstep(0.48 + r * 0.1, 1, p);
      const cracks = smoothstep(0.2 + r * 0.13, 0.48, p);
      const angle = (r - 0.5) * 5 * a;
      const dx = (sh.cx - 0.5) * 80 * a;
      const dy = (60 + r * 100) * a * a;
      sh.el.style.transform = a > 0
        ? `translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%) scale(${(1 - 0.3 * a).toFixed(3)}) scaleX(${(1 - 0.85 * a).toFixed(3)}) rotate(${angle.toFixed(3)}rad)`
        : '';
      sh.el.style.opacity = ((1 - a * 0.45) * out).toFixed(3);
      sh.edges.style.opacity = cracks.toFixed(3);
    }
  }

  /* ---- Dust ------------------------------------------------------------- */
  /* Each grain keeps its own patch of the scene. Progress alone decides
     release and flight, so reversing retraces every trajectory exactly. */
  const dustLayer = screen.querySelector('.fx-dust');
  const dustCanvas = dustLayer ? dustLayer.querySelector('canvas') : null;
  const GX = 112, GY = 70;
  let grains = null, dustSize = null;

  /* The scene's colours at grain resolution, read from the mock desktop's
     own boxes with the lid laid flat for a moment. */
  function sampleScene() {
    const map = document.createElement('canvas');
    map.width = GX; map.height = GY;
    const g = map.getContext('2d');
    const desktop = screen.querySelector('.desktop');
    const saved = hinge.style.transform;
    hinge.style.transform = 'none';
    const box = desktop.getBoundingClientRect();
    const sx = GX / box.width, sy = GY / box.height;
    const wall = g.createLinearGradient(0, 0, GX * 0.55, GY);
    wall.addColorStop(0, '#14306C'); wall.addColorStop(0.58, '#0A1836'); wall.addColorStop(1, '#070F24');
    g.fillStyle = wall; g.fillRect(0, 0, GX, GY);
    const glow = (x, y, rad, color) => {
      const rg = g.createRadialGradient(x * GX, y * GY, 0, x * GX, y * GY, rad * GX);
      rg.addColorStop(0, color); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(0, 0, GX, GY);
    };
    glow(0.22, 0.08, 0.6, 'rgba(255,165,36,0.26)');
    glow(0.84, 0.92, 0.62, 'rgba(72,128,255,0.38)');
    desktop.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      let fill = cs.backgroundColor;
      const stops = cs.backgroundImage.match(/rgba?\([^)]+\)/g);
      if (stops) fill = stops[Math.floor(stops.length / 2)];
      if (!fill || fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent') return;
      const r = el.getBoundingClientRect();
      g.fillStyle = fill;
      g.fillRect((r.left - box.left) * sx, (r.top - box.top) * sy, r.width * sx, r.height * sy);
    });
    hinge.style.transform = saved;
    return g.getImageData(0, 0, GX, GY).data;
  }

  function buildGrains() {
    const px = sampleScene();
    grains = [];
    for (let y = 0; y < GY; y++) {
      for (let x = 0; x < GX; x++) {
        const cx = (x + 0.5) / GX, cy = (y + 0.5) / GY;
        const random = hash(x + 19.7, y);
        const i = (y * GX + x) * 4;
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        /* Original colours soften toward warm neutral dust. */
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const warm = (c, tint, glow) =>
          Math.round(Math.min(255, c + (lum * tint - c) * 0.55 + glow * (0.3 + random * 0.7)));
        grains.push({
          cx, cy, random,
          release: 0.04 + cx * 0.42 + cy * 0.09 + 0.16 * noise(cx * 9, cy * 7) + 0.07 * random,
          stream: noise(cx * 3, cy * 6),
          scatter: hash(x + 73.1, y) - 0.5,
          plume: noise(cx * 5, cy * 12),
          color: `rgb(${warm(r, 1.06, 25.5)},${warm(g, 1.01, 21.7)},${warm(b, 0.93, 16.6)})`,
        });
      }
    }
  }

  function paintDust(p) {
    if (!dustCanvas) return;
    const w = screen.clientWidth, h = screen.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!grains || !dustSize || dustSize.w !== w || dustSize.h !== h) {
      dustCanvas.width = Math.round(w * dpr);
      dustCanvas.height = Math.round(h * dpr);
      dustSize = { w, h };
      buildGrains();
    }
    const g = dustCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (p <= 0) return;
    const cw = w / GX, ch = h / GY, aspect = w / h;
    const out = 1 - smoothstep(0.9, 1, p);

    /* Where a grain has left, the display behind it is black. */
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    for (const d of grains) {
      if (p > d.release) g.fillRect((d.cx * GX - 0.5) * cw - 0.3, (d.cy * GY - 0.5) * ch - 0.3, cw + 0.6, ch + 0.6);
    }
    if (out < 1) {
      g.globalAlpha = 1 - out;
      g.fillRect(0, 0, w, h);
    }

    for (const d of grains) {
      const flight = Math.max(0, (p - d.release) / (1 - d.release));
      if (flight <= 0 || flight >= 0.95) continue;
      const lift = smoothstep(0, 0.045, flight);
      const travel = flight * (0.65 + d.stream * 0.8);
      const phase = d.cy * 16 + d.stream * 5;
      let wx = 0.65 * travel + 1.1 * travel * travel;
      let wy = -0.28 * travel - 0.18 * travel * travel;
      wx += (Math.sin(phase + travel * 5) - Math.sin(phase)) * 0.12 * lift;
      wy += (Math.cos(phase + travel * 5) - Math.cos(phase)) * 0.12 * lift;
      wy += Math.sin(d.cy * 36 + d.stream * 3) * 0.035 * lift;
      wx += d.scatter * 0.035 * flight;
      wy += (d.random - 0.5) * 0.035 * flight;
      const size = (1 + (0.22 + 0.43 * d.random - 1) * lift) * (1 - smoothstep(0.6, 1, flight));
      const alpha = (1 + ((0.25 + 0.75 * smoothstep(0.25, 0.7, d.plume)) - 1) * lift)
        * (1 - smoothstep(0.35, 0.95, flight)) * out;
      if (alpha <= 0.01 || size <= 0.02) continue;
      const x = (d.cx + wx / aspect) * w, y = (d.cy + wy) * h;
      const gw = cw * size, gh = ch * size;
      g.globalAlpha = alpha;
      g.fillStyle = d.color;
      g.fillRect(x - gw / 2, y - gh / 2, gw, gh);
    }
    g.globalAlpha = 1;
  }

  /* ---- spring ---------------------------------------------------------- */
  /* Critically damped by default: a hinge settles, it does not wobble.
     Response 0.4s, the value Apple ships for repositioning. */
  function springTo(to, initialVelocity = velocity, { damping = 1, response = 0.4 } = {}) {
    target = to;
    velocity = initialVelocity;
    if (reduceMotion.matches) {          // no vestibular motion: land it
      angle = to; velocity = 0; target = null; paint(); return;
    }
    if (raf) return;                      // already stepping; new target is enough
    const omega = 2 * Math.PI / response;
    let last = performance.now();
    const step = (now) => {
      raf = null;
      if (target === null) return;
      let dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      /* Fixed substeps keep the integration stable on long frames. */
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = -omega * omega * (angle - target) - 2 * damping * omega * velocity;
        velocity += a * h;
        angle += velocity * h;
      }
      /* However it was thrown, the lid stays within reach of its stops. */
      angle = clamp(angle, MIN - 14, MAX + 14);
      paint();
      if (Math.abs(angle - target) < 0.05 && Math.abs(velocity) < 1.5) {
        angle = target; velocity = 0; target = null; paint(); return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function stopSpring() {
    target = null;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  /* ---- dragging -------------------------------------------------------- */
  let grabY = 0, grabAngle = 0, gain = 1;
  let history = [];

  function firstTouch() {
    if (touched) return;
    touched = true;
    if (hint) { hint.classList.add('gone'); setTimeout(() => hint.remove(), 400); }
  }

  hinge.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    firstTouch();
    hinge.setPointerCapture(e.pointerId);   /* keep tracking outside the bounds */
    stopSpring();                            /* grab the value that is on screen */
    dragging = true;
    hinge.classList.add('dragging');
    grabY = e.clientY;
    grabAngle = angle;                       /* respect where they grabbed */
    /* A full sweep of the range takes a little under the stage's height,
       whatever size the stage happens to be. */
    gain = (MAX - MIN) / Math.max(220, stage.getBoundingClientRect().height * 0.85);
    history = [{ y: e.clientY, t: e.timeStamp }];
    hinge.focus({ preventScroll: true });
  });

  hinge.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const raw = grabAngle - (e.clientY - grabY) * gain;
    /* Soft boundaries: resistance grows the further past the stop you push. */
    if (raw > MAX)      angle = MAX + rubberband(raw - MAX, MAX - MIN);
    else if (raw < MIN) angle = MIN - rubberband(MIN - raw, MAX - MIN);
    else                angle = raw;
    history.push({ y: e.clientY, t: e.timeStamp });
    if (history.length > 6) history.shift();
    paint();                                 /* 1:1, every move, no waiting */
  });

  function release(e) {
    if (!dragging) return;
    dragging = false;
    hinge.classList.remove('dragging');

    /* Velocity from the last few samples, handed straight to the spring so
       there is no seam between the drag and the motion that follows.
       Samples closer together than a frame say nothing useful, and a hinge
       can only be thrown so hard — both are bounded rather than trusted. */
    const a = history[0], b = history[history.length - 1];
    let v = 0;
    if (a && b && b.t - a.t >= 8) v = -((b.y - a.y) / (b.t - a.t)) * 1000 * gain;
    if (e && e.timeStamp - (b ? b.t : 0) > 90) v = 0;   /* held still: no throw */
    v = clamp(v, -MAX_FLICK, MAX_FLICK);

    const projected = clamp(angle + project(v), MIN, MAX);
    springTo(projected, v);
  }

  hinge.addEventListener('pointerup', release);
  hinge.addEventListener('pointercancel', release);

  /* Keyboard: the lid is a slider, and so is the range input below it. */
  hinge.addEventListener('keydown', (e) => {
    const stepBy = e.shiftKey ? 10 : 2;
    let next = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = angle + stepBy;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = angle - stepBy;
    if (e.key === 'Home') next = MAX;
    if (e.key === 'End') next = MIN;
    if (e.key === 'PageUp') next = angle + 20;
    if (e.key === 'PageDown') next = angle - 20;
    if (next === null) return;
    e.preventDefault();
    firstTouch();
    stopSpring();
    angle = clamp(next, MIN, MAX);
    velocity = 0;
    paint();
  });

  if (slider) {
    slider.addEventListener('input', () => {
      firstTouch();
      stopSpring();
      angle = clamp(Number(slider.value), MIN, MAX);
      velocity = 0;
      paint();
    });
  }

  /* ---- effect selection ------------------------------------------------ */
  function selectEffect(name, card) {
    effect = name;
    screen.dataset.effect = name;
    cards.forEach((c) => c.setAttribute('aria-pressed', String(c === card)));
    if (caption && card) caption.innerHTML = card.dataset.caption || '';
    paint();
  }

  cards.forEach((card) => {
    card.addEventListener('click', () => selectEffect(card.dataset.effect, card));
  });
  const initial = cards.find((c) => c.getAttribute('aria-pressed') === 'true') || cards[0];
  if (initial) selectEffect(initial.dataset.effect, initial);

  /* ---- an invitation, once --------------------------------------------- */
  /* One slow sweep when the demo first comes into view, so it is obvious the
     lid can be grabbed. Any input cancels it. */
  paint();
  if (!reduceMotion.matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || touched) return;
        io.disconnect();
        setTimeout(() => {
          if (touched) return;
          springTo(34, 0, { response: 1.5 });
          setTimeout(() => { if (!touched) springTo(REST, 0, { response: 1.1 }); }, 2100);
        }, 500);
      });
    }, { threshold: 0.45 });
    io.observe(stage);
  }
})();
