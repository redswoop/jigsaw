#!/usr/bin/env python3
"""
Animate card images in a jigsaw pack using xAI's Grok Imagine video API.

For each card*.{png,webp} without a matching card*.mp4, submits to xAI for animation,
polls for completion, downloads the video, crops to 736x1024, and applies
faststart (moov atom before mdat) for iOS/Safari compatibility.

Usage:
    python scripts/animate_pack.py <pack-name>        # animate one pack
    python scripts/animate_pack.py --all               # animate all packs
    python scripts/animate_pack.py --status             # show what's missing

Requires XAI_API_KEY env var (or .env file in project root).
"""

import os
import sys
import base64
import struct
import subprocess
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import httpx
except ImportError:
    sys.exit("Missing httpx. Install with: pip install httpx python-dotenv")

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass  # dotenv optional if XAI_API_KEY already in env

API_KEY = os.environ.get("XAI_API_KEY")
BASE_URL = "https://api.x.ai/v1"
IMAGES_DIR = Path(__file__).parent.parent / "images"
PROMPT = "Subtle gentle animation, the scene comes alive with soft movement, wind, particles, ambient motion"
BATCH_SIZE = 10


def needs_faststart(mp4_path: Path) -> bool:
    """Check if moov atom comes after mdat (needs fixing)."""
    moov_pos = mdat_pos = None
    with open(mp4_path, "rb") as f:
        pos = 0
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            size, typ = struct.unpack(">I4s", hdr)
            typ = typ.decode("ascii", errors="replace")
            if typ == "moov":
                moov_pos = pos
            elif typ == "mdat":
                mdat_pos = pos
            if size < 8:
                break
            f.seek(pos + size)
            pos += size
    if moov_pos is not None and mdat_pos is not None:
        return moov_pos > mdat_pos
    return False


def apply_faststart(mp4_path: Path):
    """Move moov atom before mdat for iOS/Safari instant playback."""
    if not needs_faststart(mp4_path):
        return
    tmp = mp4_path.with_suffix(".tmp.mp4")
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp4_path), "-c", "copy", "-movflags", "+faststart", str(tmp)],
        capture_output=True, text=True,
    )
    if r.returncode == 0:
        tmp.replace(mp4_path)
    elif tmp.exists():
        tmp.unlink()


def submit_image(png_path: Path) -> tuple[Path, str | None, str | None]:
    """Submit an image for video generation. Returns (png_path, request_id_or_url, error)."""
    with open(png_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    mime = "image/webp" if png_path.suffix.lower() == ".webp" else "image/png"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    request_body = {
        "model": "grok-imagine-video",
        "prompt": PROMPT,
        "image": {"url": f"data:{mime};base64,{b64}", "detail": "auto"},
        "duration": 5,
        "aspect_ratio": "3:4",
        "resolution": "720p",
    }

    try:
        resp = httpx.post(
            f"{BASE_URL}/videos/generations",
            headers=headers,
            json=request_body,
            timeout=60,
        )
        result = resp.json()

        video_url = result.get("url") or (result.get("video", {}) or {}).get("url")
        if video_url:
            return png_path, video_url, None

        request_id = result.get("request_id")
        if request_id:
            return png_path, request_id, None

        # Check for known errors
        error_msg = result.get("error", "")
        if isinstance(error_msg, dict):
            error_msg = error_msg.get("message", str(error_msg))
        return png_path, None, f"Unexpected: {error_msg or result}"
    except Exception as e:
        return png_path, None, str(e)


def poll_for_video(png_path: Path, request_id: str) -> tuple[Path, str | None, str | None]:
    """Poll until video is ready. Returns (png_path, video_url, error)."""
    headers = {"Authorization": f"Bearer {API_KEY}"}
    label = f"{png_path.parent.name}/{png_path.stem}"

    for i in range(150):  # 5 min max
        time.sleep(2)
        try:
            resp = httpx.get(
                f"{BASE_URL}/videos/{request_id}",
                headers=headers,
                timeout=30,
            )
            poll = resp.json()
            status = poll.get("status", "unknown")

            video_url = poll.get("url") or (poll.get("video", {}) or {}).get("url")
            if video_url or status == "completed":
                return png_path, video_url, None
            elif status == "failed":
                err = poll.get("error", {})
                msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                return png_path, None, f"Failed: {msg}"
        except Exception as e:
            print(f"  {label}: poll error ({e}), retrying...")

    return png_path, None, "Timed out"


def download_and_crop(png_path: Path, video_url: str) -> str | None:
    """Download video, crop to 736x1024, apply faststart. Saves as .mp4 next to .png."""
    mp4_path = png_path.with_suffix(".mp4")
    raw_path = png_path.with_suffix(".raw.mp4")

    try:
        resp = httpx.get(video_url, timeout=60, follow_redirects=True)
        raw_path.write_bytes(resp.content)
    except Exception as e:
        return f"Download failed: {e}"

    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(raw_path),
            "-vf", "scale=-2:1024,crop=736:1024",
            "-c:a", "copy", str(mp4_path),
        ],
        capture_output=True, text=True,
    )
    raw_path.unlink(missing_ok=True)

    if result.returncode != 0:
        return f"ffmpeg failed: {result.stderr[-200:]}"

    apply_faststart(mp4_path)
    return None


def gather_work(pack_names: list[str] | None = None) -> list[Path]:
    """Find PNGs missing MP4s. If pack_names is None, check all packs."""
    todo = []
    for pack_dir in sorted(IMAGES_DIR.iterdir()):
        if not pack_dir.is_dir():
            continue
        if pack_names and pack_dir.name not in pack_names:
            continue
        for card in sorted([*pack_dir.glob("card*.png"), *pack_dir.glob("card*.webp")]):
            if not card.with_suffix(".mp4").exists():
                todo.append(card)
    return todo


def show_status():
    """Print status of all packs."""
    for pack_dir in sorted(IMAGES_DIR.iterdir()):
        if not pack_dir.is_dir():
            continue
        cards = sorted([*pack_dir.glob("card*.png"), *pack_dir.glob("card*.webp")])
        mp4s = sorted(pack_dir.glob("card*.mp4"))
        missing = [p for p in cards if not p.with_suffix(".mp4").exists()]
        status = "ok" if not missing else f"missing {len(missing)}"
        print(f"  {pack_dir.name}: {len(mp4s)}/{len(cards)} videos ({status})")
        for m in missing:
            print(f"    - {m.name}")


def process_batch(batch: list[Path]) -> list[Path]:
    """Submit, poll, download & crop a batch. Returns failed paths."""
    failed = []
    pending = {}
    labels = {p: f"{p.parent.name}/{p.stem}" for p in batch}

    # Submit with rate limiting
    for png_path in batch:
        label = labels[png_path]
        png_path, result, error = submit_image(png_path)
        if error:
            print(f"  {label}: SUBMIT FAILED - {error}")
            failed.append(png_path)
        elif result.startswith("http"):
            print(f"  {label}: immediate result!")
            err = download_and_crop(png_path, result)
            if err:
                print(f"  {label}: FAILED - {err}")
                failed.append(png_path)
            else:
                print(f"  {label}: DONE")
        else:
            print(f"  {label}: submitted")
            pending[result] = png_path
        time.sleep(1.1)

    if not pending:
        return failed

    print(f"  Polling {len(pending)} jobs...")

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(poll_for_video, png_path, req_id): png_path
            for req_id, png_path in pending.items()
        }
        for future in as_completed(futures):
            png_path, video_url, error = future.result()
            label = labels[png_path]
            if error:
                print(f"  {label}: FAILED - {error}")
                failed.append(png_path)
            else:
                print(f"  {label}: downloading & cropping...")
                err = download_and_crop(png_path, video_url)
                if err:
                    print(f"  {label}: FAILED - {err}")
                    failed.append(png_path)
                else:
                    print(f"  {label}: DONE")

    return failed


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python scripts/animate_pack.py <pack-name>   # animate one pack")
        print("  python scripts/animate_pack.py --all          # animate all packs")
        print("  python scripts/animate_pack.py --status        # show status")
        sys.exit(1)

    if sys.argv[1] == "--status":
        show_status()
        return

    if not API_KEY:
        sys.exit("XAI_API_KEY not set. Add it to .env or export it.")

    pack_names = None if sys.argv[1] == "--all" else sys.argv[1:]
    todo = gather_work(pack_names)

    if not todo:
        print("All images already have videos!")
        return

    by_pack = {}
    for p in todo:
        by_pack.setdefault(p.parent.name, []).append(p)
    for pack, files in sorted(by_pack.items()):
        print(f"  {pack}: {len(files)} to animate")
    print(f"Total: {len(todo)} images\n")

    all_failed = []
    for i in range(0, len(todo), BATCH_SIZE):
        batch = todo[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(todo) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"--- Batch {batch_num}/{total_batches} ({len(batch)} images) ---")
        failed = process_batch(batch)
        all_failed.extend(failed)

    print(f"\n{'='*40}")
    print(f"Completed: {len(todo) - len(all_failed)}/{len(todo)}")
    if all_failed:
        print(f"Failed ({len(all_failed)}):")
        for p in all_failed:
            print(f"  {p.parent.name}/{p.name}")


if __name__ == "__main__":
    main()
