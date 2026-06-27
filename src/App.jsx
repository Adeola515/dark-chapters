#!/usr/bin/env python3
"""
🎬 YouTube Automation Pipeline — Dark Chapters
Micro-History & Obscure Facts Channel
Uses Google Gemini (FREE) for script generation
"""

import os
import json
import time
import pickle
import argparse
import requests
from pathlib import Path
from datetime import datetime

# ── Google / YouTube ──────────────────────────────────────────────────────────
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
CHANNEL_NICHE   = "Micro-History & Obscure Facts"
VIDEO_STYLE     = "cinematic documentary"

# FREE — get yours at https://aistudio.google.com
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY")
HEYGEN_API_KEY  = os.environ.get("HEYGEN_API_KEY",  "YOUR_HEYGEN_API_KEY")

YOUTUBE_SCOPES   = ["https://www.googleapis.com/auth/youtube.upload"]
CREDENTIALS_FILE = "client_secrets.json"
TOKEN_FILE       = "youtube_token.pickle"

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta"
    "/models/gemini-1.5-flash:generateContent"
)

OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Generate topic & script with Gemini (FREE)
# ─────────────────────────────────────────────────────────────────────────────

def generate_topic_and_script(custom_topic: str = "") -> dict:
    print("\n🧠 Generating topic & script with Google Gemini (free)...")

    if custom_topic:
        topic_instruction = f'The user suggested this topic: "{custom_topic}". Build the video around it.'
    else:
        topic_instruction = "Choose ONE genuinely obscure historical topic most people have never heard of."

    prompt = f"""You are a creative director for a YouTube channel called "Dark Chapters" — {CHANNEL_NICHE}.

{topic_instruction}

Return ONLY a valid JSON object (no markdown, no backticks, no extra text) with this exact structure:
{{
  "title": "Dramatic YouTube title under 70 chars",
  "topic": "One-sentence description of the obscure historical topic",
  "description": "YouTube description (2-3 paragraphs with relevant keywords, end with subscribe CTA)",
  "tags": ["tag1", "tag2", "tag3"],
  "scenes": [
    {{"scene_number": 1, "type": "hook",      "headline": "Short bold headline", "narration": "2-3 sentence narration"}},
    {{"scene_number": 2, "type": "narrative", "headline": "...", "narration": "..."}},
    {{"scene_number": 3, "type": "fact",      "headline": "...", "narration": "..."}},
    {{"scene_number": 4, "type": "dramatic",  "headline": "...", "narration": "..."}},
    {{"scene_number": 5, "type": "narrative", "headline": "...", "narration": "..."}},
    {{"scene_number": 6, "type": "fact",      "headline": "...", "narration": "..."}},
    {{"scene_number": 7, "type": "dramatic",  "headline": "...", "narration": "..."}},
    {{"scene_number": 8, "type": "outro",     "headline": "...", "narration": "..."}}
  ]
}}"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.9, "maxOutputTokens": 1500}
    }

    resp = requests.post(
        GEMINI_URL,
        params={"key": GEMINI_API_KEY},
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=30
    )
    resp.raise_for_status()

    raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    clean = raw.replace("```json", "").replace("```", "").strip()
    data = json.loads(clean)

    print(f"✅ Topic: {data['title']}")
    return data


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Create HeyGen HyperFrames video
# ─────────────────────────────────────────────────────────────────────────────

def build_heygen_prompt(script: dict) -> str:
    scenes_text = ""
    for s in script["scenes"]:
        scenes_text += (
            f"\nSCENE {s['scene_number']} ({s['type'].upper()}): "
            f"{s['headline']}\n  Narration: {s['narration']}\n"
        )

    return f"""Create a cinematic YouTube video for a "{CHANNEL_NICHE}" channel.

VIDEO TITLE: {script['title']}
TOPIC: {script['topic']}

SCENES:{scenes_text}

STYLE:
- Dark cinematic aesthetic — deep navy, gold, and aged parchment tones
- Dramatic serif typography — feels like a History Channel documentary
- Staggered text reveals and atmospheric transitions between scenes
- Ancient maps, textures, and dramatic lighting as visual elements
- signal design style: sober editorial briefing palette
- Each scene has a bold headline + narration text on screen
- Chapter/progress indicator visible throughout
- YouTube-ready 16:9 format
"""


def create_heygen_video(script: dict) -> str:
    print("\n🎬 Submitting to HeyGen HyperFrames...")

    payload = {
        "method": "tools/call",
        "params": {
            "name": "compose",
            "arguments": {
                "prompt": build_heygen_prompt(script),
                "designSource": "signal"
            }
        }
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {HEYGEN_API_KEY}"
    }

    resp = requests.post(
        "https://mcp.heygen.com/mcp/hyperframes",
        json=payload, headers=headers, timeout=60
    )
    resp.raise_for_status()
    data = resp.json()

    project_id = (
        data.get("result", {}).get("project_id")
        or data.get("project_id")
    )
    if not project_id:
        raise ValueError(f"No project_id in HeyGen response: {data}")

    print(f"✅ HeyGen project: {project_id}")
    return project_id


def wait_for_render(project_id: str, poll_interval=30, max_wait=600) -> str:
    print(f"\n⏳ Waiting for HeyGen render (project: {project_id})...")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {HEYGEN_API_KEY}"
    }
    elapsed = 0

    while elapsed < max_wait:
        payload = {
            "method": "tools/call",
            "params": {
                "name": "get_render_status",
                "arguments": {"projectId": project_id}
            }
        }
        resp = requests.post(
            "https://mcp.heygen.com/mcp/hyperframes",
            json=payload, headers=headers, timeout=30
        )
        resp.raise_for_status()
        result = resp.json().get("result", {})
        status = result.get("status", "unknown")

        print(f"  [{elapsed}s] Status: {status}")

        if status == "completed":
            video_url = result.get("video_url")
            if video_url:
                print(f"✅ Render complete: {video_url}")
                return video_url

        time.sleep(poll_interval)
        elapsed += poll_interval

    raise TimeoutError(f"HeyGen render timed out after {max_wait}s")


def download_video(video_url: str, title: str) -> Path:
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in title)[:60]
    path = OUTPUT_DIR / f"{safe}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"

    print(f"\n⬇️  Downloading to {path}...")
    with requests.get(video_url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

    print(f"✅ Downloaded ({path.stat().st_size / 1_000_000:.1f} MB)")
    return path


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — YouTube auth
# ─────────────────────────────────────────────────────────────────────────────

def get_youtube_client():
    creds = None
    if Path(TOKEN_FILE).exists():
        with open(TOKEN_FILE, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_FILE, YOUTUBE_SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "wb") as f:
            pickle.dump(creds, f)

    return build("youtube", "v3", credentials=creds)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Upload to YouTube
# ─────────────────────────────────────────────────────────────────────────────

def upload_to_youtube(youtube, video_path: Path, script: dict) -> str:
    print(f"\n📤 Uploading: {script['title']}")

    body = {
        "snippet": {
            "title":       script["title"],
            "description": script.get("description", script["topic"]),
            "tags":        script.get("tags", []),
            "categoryId":  "27",  # Education
        },
        "status": {
            "privacyStatus":           "public",  # Change to "private" to review first
            "selfDeclaredMadeForKids": False,
        }
    }

    media = MediaFileUpload(
        str(video_path), chunksize=-1,
        resumable=True, mimetype="video/mp4"
    )
    request  = youtube.videos().insert(
        part=",".join(body.keys()), body=body, media_body=media
    )
    response = None

    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"  Uploading... {int(status.progress() * 100)}%")

    url = f"https://www.youtube.com/watch?v={response['id']}"
    print(f"✅ Live: {url}")
    return url


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline(custom_topic: str = ""):
    print("=" * 60)
    print("🎬 Dark Chapters — YouTube Automation Pipeline")
    print("=" * 60)

    script     = generate_topic_and_script(custom_topic)
    script_out = OUTPUT_DIR / f"script_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(script_out, "w") as f:
        json.dump(script, f, indent=2)
    print(f"📝 Script saved: {script_out}")

    project_id = create_heygen_video(script)
    video_url  = wait_for_render(project_id)
    video_path = download_video(video_url, script["title"])

    youtube = get_youtube_client()
    yt_url  = upload_to_youtube(youtube, video_path, script)

    print("\n" + "=" * 60)
    print("🎉 DONE!")
    print(f"📺 YouTube : {yt_url}")
    print(f"🎬 File    : {video_path}")
    print(f"📝 Script  : {script_out}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dark Chapters YouTube Pipeline")
    parser.add_argument("--topic",   default="", help="Custom topic (leave blank for AI pick)")
    parser.add_argument("--dry-run", action="store_true", help="Generate script only, skip video & upload")
    args = parser.parse_args()

    if args.dry_run:
        script = generate_topic_and_script(args.topic)
        print(json.dumps(script, indent=2))
    else:
        run_pipeline(args.topic)
