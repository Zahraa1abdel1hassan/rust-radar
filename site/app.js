/**
 * Rust Radar v2 — app.js
 * Features: Bento grid, Vanilla-Tilt 3D, Three.js radar, modal, world clock, TL;DR
 */

'use strict';

/* ── State ──────────────────────────────────────────────── */
let allStories   = [];
let activeFilter = 'all';
let searchQuery  = '';
let modalOpen    = false;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── DOM refs ───────────────────────────────────────────── */
const storiesList       = document.getElementById('stories-list');
const skeletonList      = document.getElementById('skeleton-list');
const emptyState        = document.getElementById('empty-state');
const searchInput       = document.getElementById('search-input');
const resultCount       = document.getElementById('result-count');
const storyCountChip    = document.getElementById('story-count-chip');
const lastUpdatedHeader = document.getElementById('last-updated-header');
const lastUpdatedFooter = document.getElementById('last-updated-footer');
const errorToast        = document.getElementById('error-toast');
const filterBtns        = document.querySelectorAll('.filter-btn');

/* Modal refs */
const modal        = document.getElementById('story-modal');
const modalClose   = document.getElementById('modal-close');
const modalRank    = document.getElementById('modal-rank');
const modalMetaTop = document.getElementById('modal-meta-top');
const modalTitle   = document.getElementById('modal-title');
const modalTldr    = document.getElementById('modal-desc');
const modalScoreRow= document.getElementById('modal-score-row');
const modalCta     = document.getElementById('modal-cta');

/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('ready');
  initRadarCanvas();
  initWorldClock();
  loadData();
  wireControls();
  wireModal();
});

/* ══════════════════════════════════════════════════════════
   THREE.JS RADAR BACKGROUND
   ══════════════════════════════════════════════════════════ */
function initRadarCanvas() {
  const canvas = document.getElementById('radar-canvas');
  if (!canvas || prefersReducedMotion) return;

  // Wait for Three.js to be available (deferred script)
  function tryInit() {
    if (typeof THREE === 'undefined') { setTimeout(tryInit, 100); return; }

    const W = window.innerWidth;
    const H = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(W, H);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
    camera.position.set(0, 0, 28);

    /* ── Grid plane ─────────────────────── */
    const gridMat = new THREE.LineBasicMaterial({
      color: 0xFF6B35, transparent: true, opacity: 0.18
    });
    const gridGroup = new THREE.Group();

    const gridSize = 40; const gridDiv = 20; const step = gridSize / gridDiv;
    for (let i = 0; i <= gridDiv; i++) {
      const pos = -gridSize / 2 + i * step;
      // horizontal
      const hGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-gridSize/2, pos, 0),
        new THREE.Vector3( gridSize/2, pos, 0)
      ]);
      gridGroup.add(new THREE.Line(hGeo, gridMat));
      // vertical
      const vGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(pos, -gridSize/2, 0),
        new THREE.Vector3(pos,  gridSize/2, 0)
      ]);
      gridGroup.add(new THREE.Line(vGeo, gridMat));
    }
    gridGroup.rotation.x = -Math.PI / 3;
    gridGroup.position.y = -5;
    scene.add(gridGroup);

    /* ── Radar sweep ring ───────────────── */
    const ringCount = 5;
    for (let r = 1; r <= ringCount; r++) {
      const ringGeo = new THREE.RingGeometry(r * 3.2, r * 3.2 + 0.05, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xFF6B35, transparent: true,
        opacity: 0.06 + (ringCount - r) * 0.025,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 3;
      ring.position.y = -5;
      scene.add(ring);
    }

    /* ── Floating particles ─────────────── */
    const pCount = 80;
    const pPositions = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPositions[i*3]   = (Math.random() - 0.5) * 60;
      pPositions[i*3+1] = (Math.random() - 0.5) * 40;
      pPositions[i*3+2] = (Math.random() - 0.5) * 20;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xFF8C5A, size: 0.18, transparent: true, opacity: 0.55 });
    scene.add(new THREE.Points(pGeo, pMat));

    /* ── Animate ────────────────────────── */
    let frame = 0;
    function animate() {
      requestAnimationFrame(animate);
      frame += 0.004;
      gridGroup.rotation.z  = frame * 0.05;
      camera.position.x = Math.sin(frame * 0.3) * 1.5;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    animate();

    /* ── Resize ─────────────────────────── */
    const onResize = () => {
      const nW = window.innerWidth; const nH = window.innerHeight;
      camera.aspect = nW / nH; camera.updateProjectionMatrix();
      renderer.setSize(nW, nH);
    };
    window.addEventListener('resize', onResize, { passive: true });
  }

  tryInit();
}

/* ══════════════════════════════════════════════════════════
   WORLD CLOCK  — Lebanon (Asia/Beirut), USA (America/New_York), UA (Europe/Kyiv)
   ══════════════════════════════════════════════════════════ */
function initWorldClock() {
  const zones = [
    { id: 'clock-lb', tz: 'Asia/Beirut' },
    { id: 'clock-us', tz: 'America/New_York' },
    { id: 'clock-ua', tz: 'Europe/Kyiv' },
  ];

  function tick() {
    const now = new Date();
    zones.forEach(({ id, tz }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = now.toLocaleTimeString('en-US', {
        timeZone: tz,
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    });
  }

  tick();
  setInterval(tick, 1000);
}

/* ══════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════ */
async function loadData() {
  try {
    const resp = await fetch('./data.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    hydrate(data);
  } catch (err) {
    showError(`Could not load data.json — run: python -m http.server inside site/`);
    hideSkeleton();
  }
}

function hydrate(data) {
  allStories = data.stories || [];
  storyCountChip.textContent = `${allStories.length} stories`;
  const upd = formatUpdated(data.generated_at);
  if (lastUpdatedHeader) lastUpdatedHeader.textContent = upd;
  if (lastUpdatedFooter) lastUpdatedFooter.textContent = upd;
  hideSkeleton();
  render();
}

/* ══════════════════════════════════════════════════════════
   RENDER — Bento Grid
   ══════════════════════════════════════════════════════════ */
function render() {
  const q = searchQuery.toLowerCase().trim();
  const filtered = allStories.filter(s => {
    const matchFilter = activeFilter === 'all' || s.source === activeFilter;
    const matchSearch = !q || s.title.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  resultCount.textContent = `${filtered.length} / ${allStories.length}`;
  storiesList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.add('visible');
    return;
  }
  emptyState.classList.remove('visible');

  const fragment = document.createDocumentFragment();

  filtered.forEach((story, idx) => {
    const rank   = idx + 1;
    const isHero = rank <= 3;
    const heat   = typeof story.heat === 'number' ? story.heat : 0;
    const heatPct= Math.round(heat * 100);

    const card = document.createElement('div');
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Story ${rank}: ${story.title}`);

    let rankClass = 'normal';
    if (rank === 1) rankClass = 'top-1';
    else if (rank === 2) rankClass = 'top-2';
    else if (rank === 3) rankClass = 'top-3';

    card.className = [
      'story-card',
      `rank-${rank}`,
      isHero ? 'bento-hero' : 'bento-sm',
    ].join(' ');

    /* Rank badge label */
    const rankLabel = rank === 1 ? '🥇 #1' : rank === 2 ? '🥈 #2' : rank === 3 ? '🥉 #3' : `#${rank}`;

    /* TL;DR (from scraper field, or empty) */
    const tldr = story.tldr ? escHtml(story.tldr) : '';

    card.innerHTML = `
      <div class="card-top">
        <span class="rank-badge ${rankClass}" aria-hidden="true">${rankLabel}</span>
        <span class="source-badge ${story.source === 'hn' ? 'hn' : 'rss'}"
              aria-label="Source: ${story.source === 'hn' ? 'Hacker News' : 'RSS'}">
          ${story.source === 'hn' ? 'HN' : 'RSS'}
        </span>
      </div>
      <div class="card-body">
        <p class="story-title">${escHtml(story.title)}</p>
        ${tldr ? `<p class="story-tldr">${tldr}</p>` : ''}
        <div class="story-meta">
          <span class="domain-badge" title="${escHtml(story.domain)}">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            ${escHtml(story.domain)}
          </span>
          <span class="meta-sep" aria-hidden="true"></span>
          <span class="meta-score" aria-label="Score ${Math.round(story.score)}">
            <span class="score-value">${Math.round(story.score)}</span> pts
          </span>
          ${story.hn_points ? `
          <span class="meta-sep" aria-hidden="true"></span>
          <span class="meta-score" aria-label="${story.hn_points} HN upvotes">▲ ${story.hn_points}</span>` : ''}
          <span class="meta-sep" aria-hidden="true"></span>
          <span class="meta-age">${formatAge(story.age_hours)}</span>
        </div>
      </div>
      <div class="heat-bar-h" title="Heat: ${heatPct}%" role="presentation">
        <div class="heat-bar-h-fill" style="width:0"
             role="progressbar" aria-valuenow="${heatPct}" aria-valuemin="0" aria-valuemax="100"
             aria-label="Story heat ${heatPct}%"></div>
      </div>
    `;

    /* Click → open modal */
    card.addEventListener('click', () => openModal(story, rank));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(story, rank); }
    });

    /* Animate heat bar in */
    requestAnimationFrame(() => {
      const fill = card.querySelector('.heat-bar-h-fill');
      if (fill) {
        setTimeout(() => { fill.style.width = `${heatPct}%`; }, 80 + idx * 25);
      }
    });

    fragment.appendChild(card);
  });

  storiesList.appendChild(fragment);

  /* Init Vanilla-Tilt on cards */
  if (!prefersReducedMotion) {
    initTilt();
  }
}

/* ══════════════════════════════════════════════════════════
   VANILLA-TILT 3D
   ══════════════════════════════════════════════════════════ */
function initTilt() {
  function tryTilt() {
    if (typeof VanillaTilt === 'undefined') { setTimeout(tryTilt, 150); return; }

    const cards = storiesList.querySelectorAll('.story-card');
    VanillaTilt.init(Array.from(cards), {
      max:           8,       // max tilt degrees
      speed:         400,     // ms transition speed
      glare:         true,
      'max-glare':   0.08,    // very subtle glare
      scale:         1.02,    // slight scale up on hover
      perspective:   900,
      gyroscope:     false,   // no gyroscope (avoid mobile jank)
      reset:         true,
    });
  }
  tryTilt();
}

/* ══════════════════════════════════════════════════════════
   READING MODAL
   ══════════════════════════════════════════════════════════ */
function openModal(story, rank) {
  if (!modal) return;
  modalOpen = true;

  /* Rank label */
  const rankLabel = rank === 1 ? '🥇 Rank #1' : rank === 2 ? '🥈 Rank #2' : rank === 3 ? '🥉 Rank #3' : `Rank #${rank}`;
  modalRank.textContent = rankLabel;

  /* Meta top */
  modalMetaTop.innerHTML = `
    <span class="domain-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      ${escHtml(story.domain)}
    </span>
    <span class="source-badge ${story.source === 'hn' ? 'hn' : 'rss'}">
      ${story.source === 'hn' ? 'HN' : 'RSS'}
    </span>
    <span class="meta-age">${formatAge(story.age_hours)}</span>
  `;

  /* Title */
  modalTitle.textContent = story.title;

  /* TL;DR */
  modalTldr.textContent = story.tldr || '';

  /* Score row */
  const hnPill = story.hn_points
    ? `<span class="modal-score-pill">▲ HN <span class="val">${story.hn_points}</span></span>`
    : '';
  modalScoreRow.innerHTML = `
    <span class="modal-score-pill">⚡ Score <span class="val">${Math.round(story.score)}</span></span>
    ${hnPill}
    <span class="modal-score-pill">🌡 Heat <span class="val">${Math.round((story.heat||0)*100)}%</span></span>
  `;

  /* CTA link */
  modalCta.href = story.url;

  /* Show */
  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  /* Focus trap — focus close button */
  requestAnimationFrame(() => { if (modalClose) modalClose.focus(); });
}

function closeModal() {
  if (!modal) return;
  modalOpen = false;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function wireModal() {
  if (!modal) return;

  /* Close button */
  modalClose?.addEventListener('click', closeModal);

  /* Overlay backdrop click */
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  /* Escape key */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOpen) closeModal();
  });
}

/* ══════════════════════════════════════════════════════════
   CONTROLS
   ══════════════════════════════════════════════════════════ */
function wireControls() {
  let searchTimer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = searchInput.value;
      render();
    }, 200);
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      filterBtns.forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      render();
    });
  });
}

/* ══════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════ */
function hideSkeleton() {
  if (skeletonList) {
    skeletonList.style.display = 'none';
    skeletonList.setAttribute('aria-hidden', 'true');
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAge(hours) {
  if (!hours && hours !== 0) return '';
  if (hours < 1)  return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const d = Math.floor(hours / 24);
  return d === 1 ? '1d ago' : `${d}d ago`;
}

function formatUpdated(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diffMins = Math.floor((Date.now() - d) / 60000);
    if (diffMins < 2)  return 'updated just now';
    if (diffMins < 60) return `updated ${diffMins}m ago`;
    const h = Math.floor(diffMins / 60);
    if (h < 24) return `updated ${h}h ago`;
    return `updated ${d.toLocaleDateString()}`;
  } catch { return ''; }
}

function showError(msg) {
  if (!errorToast) return;
  errorToast.textContent = `⚠ ${msg}`;
  errorToast.classList.add('show');
  setTimeout(() => errorToast.classList.remove('show'), 7000);
}
