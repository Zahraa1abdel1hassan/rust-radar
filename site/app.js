/**
 * Rust Radar — app.js
 * Loads data.json, renders stories, powers search + filter.
 * No dependencies, pure vanilla JS.
 */

'use strict';

/* ── State ──────────────────────────────────────────────── */
let allStories = [];
let activeFilter = 'all';
let searchQuery  = '';

/* ── DOM refs ───────────────────────────────────────────── */
const storiesList        = document.getElementById('stories-list');
const skeletonList       = document.getElementById('skeleton-list');
const emptyState         = document.getElementById('empty-state');
const searchInput        = document.getElementById('search-input');
const resultCount        = document.getElementById('result-count');
const storyCountChip     = document.getElementById('story-count-chip');
const lastUpdatedHeader  = document.getElementById('last-updated-header');
const lastUpdatedFooter  = document.getElementById('last-updated-footer');
const errorToast         = document.getElementById('error-toast');
const filterBtns         = document.querySelectorAll('.filter-btn');

/* ── Boot ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('ready');
  loadData();
  wireControls();
});

/* ── Data fetching ──────────────────────────────────────── */
async function loadData() {
  try {
    // Try fetch first (works when served via HTTP)
    const resp = await fetch('./data.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    hydrate(data);
  } catch (err) {
    showError(`Could not load data.json: ${err.message}. Run: python -m http.server inside site/`);
    hideSkeleton();
  }
}

function hydrate(data) {
  allStories = data.stories || [];

  // Update header stats
  storyCountChip.textContent = `${allStories.length} stories`;
  const updatedText = formatUpdated(data.generated_at);
  if (lastUpdatedHeader) lastUpdatedHeader.textContent = updatedText;
  if (lastUpdatedFooter) lastUpdatedFooter.textContent = updatedText;

  hideSkeleton();
  render();
}

/* ── Rendering ──────────────────────────────────────────── */
function render() {
  const q = searchQuery.toLowerCase().trim();

  const filtered = allStories.filter(story => {
    const matchFilter = activeFilter === 'all' || story.source === activeFilter;
    const matchSearch = !q ||
      story.title.toLowerCase().includes(q) ||
      story.domain.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  // Update result count
  resultCount.textContent = `${filtered.length} / ${allStories.length}`;

  // Clear old content
  storiesList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.add('visible');
    return;
  }

  emptyState.classList.remove('visible');

  const fragment = document.createDocumentFragment();

  filtered.forEach((story, idx) => {
    const rank  = idx + 1;
    const isTop = rank <= 3;
    const heat  = typeof story.heat === 'number' ? story.heat : 0;

    const li = document.createElement('li');
    li.setAttribute('role', 'listitem');
    li.className = `story-card${rank === 1 ? ' top-1' : rank === 2 ? ' top-2' : rank === 3 ? ' top-3' : ''}`;

    // Heat bar height: min 6px, max 60px
    const heatPx = Math.max(6, Math.round(heat * 60));
    const heatPct = Math.round(heat * 100);

    li.innerHTML = `
      <div class="rank-col" aria-hidden="true">
        <span class="rank-num${isTop ? ' top' : ''}">${rank}</span>
        <div class="heat-bar-track" title="Heat: ${heatPct}%">
          <div class="heat-bar-fill" style="height:${heatPx}px;" role="progressbar"
               aria-valuenow="${heatPct}" aria-valuemin="0" aria-valuemax="100"
               aria-label="Story heat ${heatPct}%"></div>
        </div>
      </div>
      <div class="story-content">
        <div class="story-title-row">
          <h3 class="story-title">
            <a href="${escHtml(story.url)}" target="_blank" rel="noopener noreferrer"
               id="story-${escHtml(story.id)}">
              ${escHtml(story.title)}
            </a>
          </h3>
        </div>
        <div class="story-meta">
          <span class="domain-badge" title="${escHtml(story.domain)}">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            ${escHtml(story.domain)}
          </span>
          <span class="source-badge ${story.source === 'hn' ? 'hn' : 'rss'}"
                aria-label="Source: ${story.source === 'hn' ? 'Hacker News' : 'RSS'}">
            ${story.source === 'hn' ? 'HN' : 'RSS'}
          </span>
          <span class="meta-sep" aria-hidden="true"></span>
          <span class="meta-score" aria-label="Score: ${Math.round(story.score)}">
            <span class="score-value">${Math.round(story.score)}</span> pts
          </span>
          ${story.hn_points ? `
          <span class="meta-sep" aria-hidden="true"></span>
          <span class="meta-score" aria-label="${story.hn_points} HN upvotes">▲ ${story.hn_points}</span>` : ''}
          <span class="meta-sep" aria-hidden="true"></span>
          <span class="meta-age">${formatAge(story.age_hours)}</span>
        </div>
      </div>
    `;

    // Animate heat bar in after a staggered delay
    requestAnimationFrame(() => {
      const fill = li.querySelector('.heat-bar-fill');
      if (fill) {
        fill.style.height = '0px';
        setTimeout(() => {
          fill.style.height = `${heatPx}px`;
        }, 60 + idx * 30);
      }
    });

    fragment.appendChild(li);
  });

  storiesList.appendChild(fragment);
}

/* ── Controls ───────────────────────────────────────────── */
function wireControls() {
  // Search — debounced 200ms
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = searchInput.value;
      render();
    }, 200);
  });

  // Filter buttons
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

/* ── Helpers ────────────────────────────────────────────── */
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
  if (hours < 1)   return `${Math.round(hours * 60)}m ago`;
  if (hours < 24)  return `${Math.round(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function formatUpdated(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 2)  return 'updated just now';
    if (diffMins < 60) return `updated ${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `updated ${diffHrs}h ago`;
    return `updated ${d.toLocaleDateString()}`;
  } catch { return ''; }
}

function showError(msg) {
  errorToast.textContent = `⚠ ${msg}`;
  errorToast.classList.add('show');
  setTimeout(() => errorToast.classList.remove('show'), 7000);
}
