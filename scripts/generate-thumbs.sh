#!/bin/bash
# Generate WebP thumbnail versions of pack images (400px max dimension)
# Requires: cwebp (brew install webp), sips (macOS built-in)
# Usage: ./scripts/generate-thumbs.sh [pack_name]
# If no pack specified, processes all packs.

IMAGES_DIR="$(cd "$(dirname "$0")/../images" && pwd)"
MAX_SIZE=400
QUALITY=80

process_pack() {
  local pack_dir="$1"
  local pack_name="$(basename "$pack_dir")"
  local thumbs_dir="$pack_dir/thumbs"
  mkdir -p "$thumbs_dir"

  local count=0
  for img in "$pack_dir"/*.{png,jpg,jpeg,webp}; do
    [ -f "$img" ] || continue
    local filename="$(basename "$img")"
    local base="${filename%.*}"
    local thumb="$thumbs_dir/${base}.webp"

    if [ -f "$thumb" ] && [ "$thumb" -nt "$img" ]; then
      continue
    fi

    # Resize with sips to a temp PNG, then convert to WebP with cwebp
    local tmp="/tmp/thumb_$$_${base}.png"
    sips --resampleHeightWidthMax "$MAX_SIZE" "$img" --out "$tmp" >/dev/null 2>&1
    cwebp -q "$QUALITY" "$tmp" -o "$thumb" >/dev/null 2>&1
    rm -f "$tmp"
    count=$((count + 1))
  done
  echo "$pack_name: $count thumbnails generated"
}

if [ -n "$1" ]; then
  pack_dir="$IMAGES_DIR/$1"
  if [ ! -d "$pack_dir" ]; then
    echo "Pack not found: $1"
    exit 1
  fi
  process_pack "$pack_dir"
else
  for pack_dir in "$IMAGES_DIR"/*/; do
    [ -d "$pack_dir" ] || continue
    [ "$(basename "$pack_dir")" = "thumbs" ] && continue
    process_pack "$pack_dir"
  done
fi
