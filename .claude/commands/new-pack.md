Create a new image pack for the jigsaw puzzle game. The user will describe the theme (e.g., "foxes", "Art Deco architecture", "deep sea creatures"). You source, download, crop, and deploy the images.

Source images are managed in the sibling repo at `../image_packs/`. Finished cards are deployed to `images/<pack-name>/` in this repo.

## Image Spec

- **Resolution**: 736x1024 pixels (portrait, ~5:7 aspect ratio)
- **Format**: WebP (quality 90) for deployment; PNG masters kept in `../image_packs/`
- **Naming**: `card1.webp`, `card2.webp`, etc. (sequential, starting at 1)
- **Resampling**: Pillow `Image.LANCZOS`
- **Color mode**: RGB (convert with `.convert("RGB")` before saving)
- **Optional**: matching MP4 victory videos (`card1.mp4`, etc.)

## Cropping Rules

Center-crop to the 5:7 target ratio, then resize to 736x1024:

```python
from PIL import Image

TARGET_W, TARGET_H = 736, 1024
TARGET_RATIO = TARGET_W / TARGET_H  # ~0.71875

img = Image.open(src).convert("RGB")
w, h = img.size

if w / h > TARGET_RATIO:
    # Too wide — crop width
    new_w = int(h * TARGET_RATIO)
    left = (w - new_w) // 2
    img = img.crop((left, 0, left + new_w, h))
else:
    # Too tall — crop height
    new_h = int(w / TARGET_RATIO)
    top = (h - new_h) // 2
    img = img.crop((0, top, w, top + new_h))

img = img.resize((TARGET_W, TARGET_H), Image.LANCZOS)
img.save(dst, "PNG")
```

**When the subject is off-center** (e.g., a fox sitting to the left), adjust the crop origin to center the subject rather than using a blind center crop. Read the raw image first to check composition.

## Sourcing Images

### Best free sources (no API key needed)

| Source | API / URL | License | Best for |
|--------|-----------|---------|----------|
| Wikimedia Commons | `commons.wikimedia.org/w/api.php` | Varies (filter CC0/CC BY) | Everything — largest free image collection |
| NASA Images API | `images-api.nasa.gov/search?q=QUERY&media_type=image` | Public domain | Space, astronomy, rockets |
| Met Museum | `collectionapi.metmuseum.org/public/collection/v1/` | CC0 | Fine art, historical |
| Art Institute of Chicago | `api.artic.edu/api/v1/artworks/search` | CC0 | Impressionism, prints |
| Library of Congress | `loc.gov/collections/?fo=json` | Public domain | Architecture, WPA, vintage photos |
| Internet Archive | `archive.org/advancedsearch.php` | Varies | Comics, pulps, vintage books |

### Sources needing API keys

| Source | Key signup | Best for |
|--------|-----------|----------|
| Smithsonian Open Access | api.si.edu | Art, natural history, space artifacts |
| Unsplash | unsplash.com/developers | Wildlife, nature, street art photography |
| BHL (Biodiversity Heritage Library) | biodiversitylibrary.org/docs/api3.html | Natural history illustrations |
| NYPL Digital Collections | api.repo.nypl.org | Historical NYC photos, maps |
| Rijksmuseum | data.rijksmuseum.nl | Dutch masters |

### Wikimedia Commons API patterns

Search for images:
```
curl -s 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=QUERY&gsrnamespace=6&prop=imageinfo&iiprop=url|size&iiurlwidth=2000&format=json'
```

Browse a category:
```
curl -s 'https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=Category:CATEGORY_NAME&gcmtype=file&gcmlimit=20&prop=imageinfo&iiprop=url|size&iiurlwidth=2000&format=json'
```

Parse response: `pages -> {pageid} -> imageinfo[0] -> thumburl` (or `url` for full size).

### NASA Images API pattern

```
curl -s 'https://images-api.nasa.gov/search?q=QUERY&media_type=image'
```

Results in `collection.items[].links[0].href` for preview. For full res, fetch `collection.items[].href` (asset manifest).

## Workflow

1. **Download raws** to `/tmp/<pack>_raw/` — use background agents in parallel (group by 5-7 images per agent)
2. **Verify downloads** — check file sizes (`< 10KB` = failed), run `file` command to confirm they're actual images not HTML error pages
3. **Crop and resize** all images to 736x1024 using the cropping code above
4. **Save processed cards** to `../image_packs/<pack-name>/`
5. **Review the contact sheet** — generate with `python3 ../image_packs/contact_sheet.py ../image_packs/<pack-name>`, then read the PNG to visually check for:
   - Rotated images (rockets/buildings should point up)
   - Bad crops (subject cut off or too small)
   - Text pages instead of artwork (common BHL failure)
   - Duplicate images
6. **Fix issues** — re-crop with adjusted origin, re-download from alternate source, or rotate as needed
7. **Deploy** to jigsaw — convert PNGs to WebP and copy:
   ```bash
   mkdir -p images/<pack-name>
   for f in ../image_packs/<pack-name>/card*.png; do
     base=$(basename "$f" .png)
     cwebp -q 90 "$f" -o "images/<pack-name>/${base}.webp" -quiet
   done
   ```
   Requires `cwebp` (`brew install webp`). Keep PNG masters in `../image_packs/`.
8. **Generate thumbnails** — WebP thumbnails (400px max, quality 80) for fast browsing:
   ```bash
   ./scripts/generate-thumbs.sh <pack-name>
   ```
   This creates `images/<pack-name>/thumbs/*.webp`. Requires `cwebp` (`brew install webp`).
9. **Create `names.json`** in `images/<pack-name>/` with display names for each card (see Naming Cards below).

## Naming Cards

Each pack needs a `names.json` in its deployed `images/<pack-name>/` directory. This provides display names shown in the puzzle toolbar and victory screen.

### Format

```json
{
  "card1.png": "Display Name Here",
  "card2.png": "Another Name",
  ...
}
```

### Naming conventions by pack type

| Pack type | Format | Example |
|-----------|--------|---------|
| Fine art | `Title — Artist` | `"The Starry Night — Van Gogh"` |
| Natural history plates | `Subject — Illustrator, Year` | `"Discomedusae (Jellyfish) — Haeckel"` |
| Architecture/photography | `Subject — Photographer/Source, Year` | `"Chrysler Building from Empire State — Gottscho, 1932"` |
| Space/NASA | `Subject — Mission/Telescope` | `"Earthrise — Apollo 8"` |
| Comics/pulps | `Title #Issue — Publisher, Year` | `"Planet Comics #1 — Fiction House, 1940"` |
| Posters | `Title — Artist/Program, Year` | `"Beat the Whites with the Red Wedge — Lissitzky, 1919"` |
| Wildlife photography | Short evocative name | `"Arctic Ghost"`, `"Desert Ears"` |

### Guidelines

- Use em dash ` — ` (not hyphen) to separate title from attribution
- Include the artist/source/mission when known — it adds context during gameplay
- For wildlife and nature photography where there's no artist attribution, use short evocative names instead
- Keep names concise — they display in a toolbar, not a museum placard
- Include species names for scientific illustrations: `"Nudibranchia — Haeckel"`
- Include year when it adds historical context: `"Gottscho, 1932"`
- Every card must have an entry — the UI falls back to "Jigsaw" if missing, but completeness is better

## Directory structure

```
jigsaw/
├── images/
│   ├── <pack-name>/          # Deployed cards + names
│   │   ├── names.json        # Display names for each card
│   │   ├── card1.webp
│   │   ├── card2.webp
│   │   ├── ...
│   │   └── thumbs/           # WebP thumbnails for browsing
│   │       ├── card1.webp
│   │       ├── card2.webp
│   │       └── ...
│   └── ...
├── scripts/
│   ├── generate-thumbs.sh    # Thumbnail generator (requires cwebp)
│   └── animate_pack.py       # Victory video generator
│
image_packs/                  # Sibling repo (../image_packs/)
├── <pack-name>/
│   ├── _contact_sheet.png    # Thumbnail grid (not deployed)
│   ├── card1.png             # 736x1024 processed cards
│   ├── card2.png
│   └── ...
├── contact_sheet.py          # Contact sheet generator
└── download_masters.py       # Example download script
```

## Quality checklist

- [ ] Every image is 736x1024 WebP (q90)
- [ ] Subject is prominent and well-centered (not tiny in the distance)
- [ ] No rotated images
- [ ] No duplicate images
- [ ] No text pages or error pages
- [ ] Source images were at least 800px on the shorter dimension (avoid upscaling mush)
- [ ] Contact sheet generated and visually reviewed
- [ ] Cards saved to `../image_packs/<pack-name>/`
- [ ] Deployed to `images/<pack-name>/`
- [ ] WebP thumbnails generated in `images/<pack-name>/thumbs/`
- [ ] `names.json` created with display names for every card

## Rate limiting

- **Wikimedia Commons**: 10-15 second delays between downloads if scripting sequentially. Parallel agents with 1 request each are fine.
- **NASA API**: No rate limiting observed.
- **LOC**: Cloudflare may block rapid requests. Fall back to Wikimedia for LOC-sourced images.
- **ESA Hubble CDN**: Some paths return 404. Try `archives/images/large/` instead of `archives/images/publicationjpg/`.

## Existing packs

Update this list when adding new packs:

- **masters** (20) — Famous paintings (da Vinci, Van Gogh, Vermeer, Hokusai, Klimt, Monet, etc.)
- **space** (10) — Nebulae and galaxies (Hubble, JWST)
- **natural_history** (10) — Haeckel, Audubon, Redoute, Seguy illustrations
- **architecture** (20) — NYC Art Deco, Chicago, architectural drawings
- **marine** (20) — Reef photography and vintage ichthyology plates
- **pop** (20) — Golden Age comics, WPA posters, Soviet constructivist, street art, pulps
- **space_age** (20) — Apollo, rockets, spacewalks, NASA hardware, JPL posters
- **constructivist** (20) — Stenberg, Lissitzky, Rodchenko, Malevich, Popova
- **foxes** (22) — Red, arctic, fennec, gray, island, swift foxes
- **pokemon** (23) — Full-art Pokemon cards (not managed in image_packs)
