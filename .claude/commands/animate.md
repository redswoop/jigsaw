Animate card images in one or more jigsaw packs, generating victory videos using xAI's Grok Imagine API.

## What this does

For each `card*.{png,webp}` in a pack that doesn't already have a matching `card*.mp4`, this:
1. Submits the image to xAI's video generation API (base64 data URL)
2. Polls for completion (~20s per video)
3. Downloads the video, crops to 736x1024 (matching card dimensions)
4. Applies faststart (moov before mdat) for iOS/Safari instant playback

## How to run

The animation script is at `scripts/animate_pack.py`. It requires `httpx` and `python-dotenv` (see `scripts/requirements.txt`). The `XAI_API_KEY` must be set — either in `.env` at the project root or as an environment variable.

```bash
# Check what needs animating
uv run --with httpx --with python-dotenv --python 3.12 python scripts/animate_pack.py --status

# Animate a specific pack
uv run --with httpx --with python-dotenv --python 3.12 python scripts/animate_pack.py <pack-name>

# Animate all packs with missing videos
uv run --with httpx --with python-dotenv --python 3.12 python scripts/animate_pack.py --all
```

Always use `uv run` — system Python may be too old for the type syntax in the script.

## Rate limits & costs

- xAI rate limit: 1 request/second, 60/minute
- The script submits in batches of 10 with 1.1s spacing
- Each video costs xAI credits (~$0.10-0.20 per video)
- A 20-card pack takes ~5 minutes and ~$2-4

## If it fails

- **Rate limit errors**: wait a minute and re-run (it skips already-done cards)
- **Credit exhaustion**: top up at console.x.ai, then re-run
- **Timeout on a single card**: just re-run; the script is idempotent
- **All videos should be 736x1024 with faststart** — verify with:
  ```bash
  ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 images/<pack>/card1.mp4
  ```

## Arguments

$ARGUMENTS
