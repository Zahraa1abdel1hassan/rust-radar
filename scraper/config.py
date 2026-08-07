"""
config.py — Rust Radar scraper configuration
Edit this file to change the niche (RSS sources + HN query).
Everything else is niche-agnostic.
"""

# ── RSS / Atom sources ───────────────────────────────────────
# Each entry: (url, weight)
# weight: relative importance (1.0 = baseline, 2.0 = double credit)
RSS_SOURCES = [
    # Official Rust blog
    ("https://blog.rust-lang.org/feed.xml", 2.0),
    # Inside Rust (compiler/lang team updates)
    ("https://blog.rust-lang.org/inside-rust/feed.xml", 1.8),
    # This Week in Rust
    ("https://this-week-in-rust.org/rss.xml", 2.0),
    # The Rust Programming Language Forum (announcements)
    ("https://users.rust-lang.org/c/announcements.rss", 1.5),
    # Are We Web Yet
    ("https://www.arewewebyet.org/rss.xml", 1.2),
    # Are We Game Yet
    ("https://arewegameyet.rs/rss.xml", 1.2),
    # r/rust (Reddit RSS)
    ("https://www.reddit.com/r/rust/.rss", 1.0),
    # Tokio blog
    ("https://tokio.rs/blog/rss.xml", 1.5),
]

# ── Hacker News Algolia search query ────────────────────────
# Used against https://hn.algolia.com/api/v1/search
# Examples: "rust programming", "web3", "llm", "ethereum"
HN_ALGOLIA_QUERY = "rust programming language"

# HN results to fetch (max 20 per request)
HN_NUM_RESULTS = 20

# HN score weighting factor (applied to raw HN points)
HN_WEIGHT = 3.0

# ── Scoring + freshness ──────────────────────────────────────
# RSS: score = weight * freshness_decay(age_hours)
# HN:  score = HN_WEIGHT * hn_points + freshness_bonus(age_hours)

# Half-life for RSS freshness decay (hours)
# Story at 0h → decay=1.0, at HALF_LIFE hours → decay=0.5
RSS_FRESHNESS_HALF_LIFE = 24.0  # hours

# Freshness bonus added to HN score (points equivalent)
HN_FRESHNESS_BONUS_MAX = 50.0   # bonus at age=0
HN_FRESHNESS_HALF_LIFE  = 12.0  # hours for the bonus to halve

# Maximum story age to include (hours)
MAX_AGE_HOURS = 72

# Maximum stories in output JSON
MAX_OUTPUT_STORIES = 30

# ── Output ───────────────────────────────────────────────────
import os
OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "site", "data.json"
)

NICHE_LABEL = "Rust"
