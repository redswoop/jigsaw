#!/bin/bash
# Generate thumbnail versions of pack images (400px max dimension)
# Usage: ./scripts/generate-thumbs.sh [pack_name]
# If no pack specified, processes all packs.

IMAGES_DIR="$(cd "$(dirname "$0")/../images" && pwd)"
MAX_SIZE=400

process_pack() {
  local pack_dir="$1"
  local pack_name="$(basename "$pack_dir")"
  local thumbs_dir="$pack_dir/thumbs"
  mkdir -p "$thumbs_dir"

  local count=0
  for img in "$pack_dir"/*.{png,jpg,jpeg,webp}; do
    [ -f "$img" ] || continue
    local filename="$(basename "$img")"
    local thumb="$thumbs_dir/$filename"

    if [ -f "$thumb" ] && [ "$thumb" -nt "$img" ]; then
      continue
    fi

    sips --resampleHeightWidthMax "$MAX_SIZE" "$img" --out "$thumb" >/dev/null 2>&1
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
    # Skip thumbs directories
    [ "$(basename "$pack_dir")" = "thumbs" ] && continue
    process_pack "$pack_dir"
  done
fi
