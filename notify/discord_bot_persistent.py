"""
discord_bot_persistent.py — Always-on Discord bot
Schedules a daily digest post at 08:00 in DIGEST_TZ timezone.
Requires a bot token + channel ID (not a webhook URL).

Setup:
    cd notify
    pip install -r requirements-bot.txt
    export DISCORD_BOT_TOKEN=your_bot_token_here
    export DISCORD_CHANNEL_ID=your_channel_id_here
    export DIGEST_TZ=America/New_York   # optional, default UTC
    export DIGEST_HOUR=8                # optional, default 8
    python discord_bot_persistent.py

Needs somewhere to run continuously — a VPS, Fly.io, Railway, etc.
GitHub Actions is not suitable for always-on processes.
"""

import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

import discord
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("rust-radar-bot")

# ── Paths ────────────────────────────────────────────────────
HERE      = Path(__file__).parent
DATA_FILE = HERE.parent / "site" / "data.json"

# ── Config ───────────────────────────────────────────────────
BOT_TOKEN  = os.environ.get("DISCORD_BOT_TOKEN", "")
CHANNEL_ID = int(os.environ.get("DISCORD_CHANNEL_ID", "0"))
TZ_NAME    = os.environ.get("DIGEST_TZ", "UTC")
HOUR       = int(os.environ.get("DIGEST_HOUR", "8"))
TOP_N      = int(os.environ.get("DIGEST_TOP_N", "3"))
NICHE      = os.environ.get("DIGEST_NICHE", "Rust")

if not BOT_TOKEN:
    log.error("DISCORD_BOT_TOKEN is not set. Exiting.")
    sys.exit(1)
if not CHANNEL_ID:
    log.error("DISCORD_CHANNEL_ID is not set. Exiting.")
    sys.exit(1)


# ── Helpers ──────────────────────────────────────────────────

def load_stories() -> list[dict]:
    if not DATA_FILE.exists():
        log.warning("data.json not found at %s", DATA_FILE)
        return []
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("stories", [])
    except Exception as e:
        log.error("Failed to load data.json: %s", e)
        return []


def format_age(hours: float) -> str:
    if hours < 1:
        return f"{int(hours*60)}m ago"
    if hours < 24:
        return f"{int(hours)}h ago"
    return f"{int(hours//24)}d ago"


def medal(rank: int) -> str:
    return ["🥇", "🥈", "🥉"][rank - 1] if rank <= 3 else f"#{rank}"


def build_embeds(stories: list[dict]) -> list[discord.Embed]:
    colors = [0xFF6B35, 0xFFB347, 0x56D8C4]
    embeds = []
    for i, s in enumerate(stories[:TOP_N], 1):
        em = discord.Embed(
            title=f"{medal(i)} {s['title']}",
            url=s["url"],
            color=colors[i - 1] if i <= len(colors) else 0x8B949E,
        )
        em.add_field(name="Domain", value=f"`{s['domain']}`", inline=True)
        em.add_field(name="Score",  value=f"`{s['score']:.0f}`", inline=True)
        if s.get("hn_points"):
            em.add_field(name="HN ▲", value=str(s["hn_points"]), inline=True)
        em.set_footer(text=f"{format_age(s.get('age_hours', 0))} · source: {s.get('source','?').upper()}")
        embeds.append(em)
    return embeds


# ── Bot ──────────────────────────────────────────────────────

intents = discord.Intents.default()
client  = discord.Client(intents=intents)
scheduler = AsyncIOScheduler()


async def post_digest():
    log.info("Posting daily digest…")
    stories = load_stories()
    if not stories:
        log.warning("No stories to post.")
        return

    channel = client.get_channel(CHANNEL_ID)
    if channel is None:
        try:
            channel = await client.fetch_channel(CHANNEL_ID)
        except discord.NotFound:
            log.error("Channel %s not found.", CHANNEL_ID)
            return

    now_str = datetime.now(pytz.timezone(TZ_NAME)).strftime("%Y-%m-%d %H:%M %Z")
    embeds = build_embeds(stories[:TOP_N])

    await channel.send(
        content=f"🦀 **{NICHE} Radar — Daily Top {TOP_N}** · {now_str}",
        embeds=embeds,
    )
    log.info("Digest posted (%d stories)", min(TOP_N, len(stories)))


@client.event
async def on_ready():
    log.info("Logged in as %s (id=%s)", client.user, client.user.id)
    log.info("Digest scheduled at %02d:00 %s every day", HOUR, TZ_NAME)

    tz = pytz.timezone(TZ_NAME)
    scheduler.add_job(
        post_digest,
        trigger=CronTrigger(hour=HOUR, minute=0, timezone=tz),
        id="daily_digest",
        replace_existing=True,
    )
    scheduler.start()


def main():
    log.info("Starting %s Radar Bot…", NICHE)
    client.run(BOT_TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
