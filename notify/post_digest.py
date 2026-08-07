"""
post_digest.py — One-shot daily digest
Posts the top 3 stories from site/data.json to Discord and/or Slack.

Usage (locally):
    export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
    export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
    python notify/post_digest.py

In GitHub Actions the env vars come from repo secrets (see daily-digest.yml).
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

import requests

# ── Paths ────────────────────────────────────────────────────
HERE      = Path(__file__).parent
DATA_FILE = HERE.parent / "site" / "data.json"

# ── Config from environment ──────────────────────────────────
DISCORD_WEBHOOK = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
SLACK_WEBHOOK   = os.getenv("SLACK_WEBHOOK_URL", "").strip()
TOP_N           = int(os.getenv("DIGEST_TOP_N", "3"))
NICHE           = os.getenv("DIGEST_NICHE", "Rust")    # override label if desired


# ── Load data ────────────────────────────────────────────────

def load_stories() -> list[dict]:
    if not DATA_FILE.exists():
        print(f"ERROR: {DATA_FILE} not found. Run the scraper first.", file=sys.stderr)
        sys.exit(1)
    with open(DATA_FILE, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("stories", [])


# ── Format helpers ────────────────────────────────────────────

def format_age(hours: float) -> str:
    if hours < 1:
        return f"{int(hours*60)}m ago"
    if hours < 24:
        return f"{int(hours)}h ago"
    return f"{int(hours//24)}d ago"


def medal(rank: int) -> str:
    return ["🥇", "🥈", "🥉"][rank - 1] if rank <= 3 else f"#{rank}"


# ── Discord ──────────────────────────────────────────────────

def build_discord_payload(stories: list[dict]) -> dict:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    embeds = []

    for i, s in enumerate(stories[:TOP_N], 1):
        color_map = {1: 0xFF6B35, 2: 0xFFB347, 3: 0x56D8C4}
        color = color_map.get(i, 0x8B949E)

        desc_parts = []
        if s.get("hn_points"):
            desc_parts.append(f"▲ **{s['hn_points']}** HN points")
        desc_parts.append(f"⚡ score `{s['score']:.0f}`")
        desc_parts.append(f"🕐 {format_age(s.get('age_hours', 0))}")
        desc_parts.append(f"🔗 [{s['domain']}]({s['url']})")

        embeds.append({
            "title":       f"{medal(i)} {s['title']}",
            "url":         s["url"],
            "description": " · ".join(desc_parts),
            "color":       color,
        })

    return {
        "username":   f"{NICHE} Radar",
        "avatar_url": "https://www.rust-lang.org/static/images/rust-logo-blk.svg",
        "content":    f"🦀 **{NICHE} Radar — Daily Top {TOP_N}** · {now}",
        "embeds":     embeds,
    }


def post_discord(stories: list[dict]) -> bool:
    if not DISCORD_WEBHOOK:
        print("  Discord: skipped (DISCORD_WEBHOOK_URL not set)")
        return False

    payload = build_discord_payload(stories)
    try:
        resp = requests.post(DISCORD_WEBHOOK, json=payload, timeout=15)
        resp.raise_for_status()
        print(f"  Discord: ✓ posted (HTTP {resp.status_code})")
        return True
    except requests.RequestException as e:
        print(f"  Discord: ✗ failed — {e}", file=sys.stderr)
        return False


# ── Slack ────────────────────────────────────────────────────

def build_slack_payload(stories: list[dict]) -> dict:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🦀 {NICHE} Radar — Daily Top {TOP_N}",
                "emoji": True,
            },
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"_{now}_"}],
        },
        {"type": "divider"},
    ]

    for i, s in enumerate(stories[:TOP_N], 1):
        meta_parts = []
        if s.get("hn_points"):
            meta_parts.append(f"▲ {s['hn_points']} pts")
        meta_parts.append(f"⚡ {s['score']:.0f}")
        meta_parts.append(format_age(s.get("age_hours", 0)))

        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"{medal(i)} *<{s['url']}|{s['title']}>*\n"
                    f"`{s['domain']}` · {' · '.join(meta_parts)}"
                ),
            },
        })

    return {"blocks": blocks}


def post_slack(stories: list[dict]) -> bool:
    if not SLACK_WEBHOOK:
        print("  Slack:   skipped (SLACK_WEBHOOK_URL not set)")
        return False

    payload = build_slack_payload(stories)
    try:
        resp = requests.post(SLACK_WEBHOOK, json=payload, timeout=15)
        resp.raise_for_status()
        print(f"  Slack:   ✓ posted (HTTP {resp.status_code})")
        return True
    except requests.RequestException as e:
        print(f"  Slack:   ✗ failed — {e}", file=sys.stderr)
        return False


# ── Main ─────────────────────────────────────────────────────

def main():
    print(f"[post_digest] Loading {DATA_FILE}…")
    stories = load_stories()

    if not stories:
        print("No stories found in data.json — nothing to post.")
        sys.exit(0)

    top = stories[:TOP_N]
    print(f"  Top {len(top)} stories:")
    for i, s in enumerate(top, 1):
        print(f"    {i}. {s['title'][:70]}")

    print("\nPosting digest…")
    discord_ok = post_discord(top)
    slack_ok   = post_slack(top)

    if not discord_ok and not slack_ok:
        print(
            "\n⚠  No webhooks configured. "
            "Set DISCORD_WEBHOOK_URL and/or SLACK_WEBHOOK_URL.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("\n✓ Done.")


if __name__ == "__main__":
    main()
