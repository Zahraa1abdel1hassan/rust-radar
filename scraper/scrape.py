"""
scrape.py — Rust Radar main scraper
Pulls RSS feeds + HN Algolia, scores & deduplicates stories,
writes site/data.json.

Usage:
    cd scraper
    pip install -r requirements.txt
    python scrape.py
"""

import json
import math
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

import feedparser
import requests

import config

# ── Helpers ──────────────────────────────────────────────────

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_dt(dt_struct) -> datetime | None:
    """Convert a feedparser time struct to a timezone-aware datetime."""
    if not dt_struct:
        return None
    try:
        ts = time.mktime(dt_struct)
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except Exception:
        return None


def age_hours(published: datetime | None) -> float:
    """Hours since published; returns MAX_AGE_HOURS+1 if unknown."""
    if not published:
        return config.MAX_AGE_HOURS + 1
    delta = utcnow() - published
    return max(0.0, delta.total_seconds() / 3600)


def rss_freshness(hours: float) -> float:
    """Exponential decay: 1.0 at t=0, 0.5 at t=HALF_LIFE."""
    return math.pow(0.5, hours / config.RSS_FRESHNESS_HALF_LIFE)


def hn_freshness_bonus(hours: float) -> float:
    """Additive freshness bonus for HN items."""
    return config.HN_FRESHNESS_BONUS_MAX * math.pow(
        0.5, hours / config.HN_FRESHNESS_HALF_LIFE
    )


def clean_url(url: str) -> str:
    """Normalize URL for deduplication (strip query/fragment)."""
    try:
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")
    except Exception:
        return url.strip()


def extract_domain(url: str) -> str:
    try:
        host = urlparse(url).netloc
        # Strip www.
        return re.sub(r"^www\.", "", host)
    except Exception:
        return ""


def sanitize_title(title: str) -> str:
    """Remove HTML tags and collapse whitespace."""
    title = re.sub(r"<[^>]+>", "", title)
    return re.sub(r"\s+", " ", title).strip()


# ── RSS scraper ───────────────────────────────────────────────

def fetch_rss(url: str, weight: float) -> list[dict]:
    print(f"  [RSS] {url} (weight={weight})")
    stories = []
    try:
        feed = feedparser.parse(url)
    except Exception as e:
        print(f"    ✗ feedparser error: {e}", file=sys.stderr)
        return []

    for entry in feed.entries:
        link = entry.get("link") or entry.get("id") or ""
        if not link:
            continue

        title = sanitize_title(entry.get("title", "Untitled"))
        published = parse_dt(entry.get("published_parsed") or entry.get("updated_parsed"))
        hours = age_hours(published)

        if hours > config.MAX_AGE_HOURS:
            continue

        score = weight * rss_freshness(hours) * 100  # scale to ~0-200

        stories.append({
            "id":           f"rss-{clean_url(link).__hash__() & 0xFFFFFFFF:08x}",
            "title":        title,
            "url":          link,
            "domain":       extract_domain(link),
            "score":        round(score, 2),
            "hn_points":    None,
            "source":       "rss",
            "age_hours":    round(hours, 2),
            "published_at": published.isoformat() if published else None,
            "_clean_url":   clean_url(link),
        })

    print(f"    → {len(stories)} items fetched")
    return stories


# ── HN Algolia scraper ────────────────────────────────────────

HN_API = "https://hn.algolia.com/api/v1/search"

def fetch_hn(query: str, num: int) -> list[dict]:
    print(f"  [HN ] query='{query}' n={num}")
    stories = []
    try:
        resp = requests.get(
            HN_API,
            params={
                "query":        query,
                "tags":         "story",
                "numericFilters": f"created_at_i>{int((utcnow() - timedelta(hours=config.MAX_AGE_HOURS)).timestamp())}",
                "hitsPerPage":  num,
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"    ✗ HN API error: {e}", file=sys.stderr)
        return []

    for hit in data.get("hits", []):
        url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        title = sanitize_title(hit.get("title", "Untitled"))
        hn_points = hit.get("points") or 0

        # Parse created_at_i (Unix timestamp)
        created_ts = hit.get("created_at_i")
        published = (
            datetime.fromtimestamp(created_ts, tz=timezone.utc) if created_ts else None
        )
        hours = age_hours(published)

        if hours > config.MAX_AGE_HOURS:
            continue

        score = config.HN_WEIGHT * hn_points + hn_freshness_bonus(hours)

        stories.append({
            "id":           f"hn-{hit.get('objectID', 'x')}",
            "title":        title,
            "url":          url,
            "domain":       extract_domain(url),
            "score":        round(score, 2),
            "hn_points":    hn_points,
            "source":       "hn",
            "age_hours":    round(hours, 2),
            "published_at": published.isoformat() if published else None,
            "_clean_url":   clean_url(url),
        })

    print(f"    → {len(stories)} items fetched")
    return stories


# ── Deduplicate ───────────────────────────────────────────────

def deduplicate(stories: list[dict]) -> list[dict]:
    """Keep highest-scoring story per clean URL."""
    seen: dict[str, dict] = {}
    for s in stories:
        key = s["_clean_url"]
        if key not in seen or s["score"] > seen[key]["score"]:
            seen[key] = s
    return list(seen.values())


# ── Normalize heat ─────────────────────────────────────────────

def normalize_heat(stories: list[dict]) -> list[dict]:
    """Add heat field: each story's score / top story's score."""
    if not stories:
        return stories
    top_score = max(s["score"] for s in stories)
    if top_score == 0:
        for s in stories:
            s["heat"] = 0.0
    else:
        for s in stories:
            s["heat"] = round(s["score"] / top_score, 4)
    return stories


# ── Main ──────────────────────────────────────────────────────

def main():
    print("=" * 56)
    print(f"  Rust Radar Scraper — {utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 56)

    all_stories: list[dict] = []

    # Fetch RSS sources
    print("\n[1/3] Fetching RSS feeds…")
    for url, weight in config.RSS_SOURCES:
        stories = fetch_rss(url, weight)
        all_stories.extend(stories)
        time.sleep(0.5)   # be polite

    # Fetch HN
    print("\n[2/3] Querying Hacker News Algolia API…")
    hn_stories = fetch_hn(config.HN_ALGOLIA_QUERY, config.HN_NUM_RESULTS)
    all_stories.extend(hn_stories)

    # Deduplicate + sort + trim
    print("\n[3/3] Deduplicating, scoring, writing output…")
    unique = deduplicate(all_stories)
    ranked = sorted(unique, key=lambda s: s["score"], reverse=True)
    ranked = ranked[:config.MAX_OUTPUT_STORIES]
    ranked = normalize_heat(ranked)

    # Remove internal key before writing
    for s in ranked:
        s.pop("_clean_url", None)

    output = {
        "generated_at": utcnow().isoformat(),
        "niche":        config.NICHE_LABEL,
        "stories":      ranked,
    }

    import os
    out_path = os.path.abspath(config.OUTPUT_PATH)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n  ✓ Wrote {len(ranked)} stories → {out_path}")
    print(f"  Top story: {ranked[0]['title'][:60]}…" if ranked else "  (no stories)")
    print("=" * 56)


if __name__ == "__main__":
    main()
