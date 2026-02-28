# Fix Report: ABR Brush Thumbnail "Missing" Glitch

## Date

2026-02-27

## Context

This report documents how the "ABR thumbnails not rendering" issue was resolved in `Pictaflux`.

Initial symptom: after importing large `.abr` packs, most brush cells looked empty, and only a few thumbnails near the bottom appeared.

## Final Diagnosis

The main issue was **layout overlap**, not missing image data.

- Brush tiles were being visually stacked/painted on top of each other in the grid.
- Because of overlap, it looked like thumbnails were missing.
- In reality, many thumbnails were loaded, but hidden behind later-rendered tiles.

Contributing confusion during debugging:

- A stale dev instance can make it look like new code is not running.
- Reactive thumbnail storage was also improved during investigation, but the visible "only last few rows" glitch was caused by layout behavior.

## Root Cause (UI)

In `src/lib/components/BrushLibrary.svelte`, the grid used `aspect-ratio: 1` on `.brush-thumb` inside a scrollable CSS grid.

On WKWebView/WebKit, this combination can behave poorly in large dynamic lists (overlap/paint glitches).

## Code Changes Applied

## 1) Layout hardening (the actual visible fix)

File: `src/lib/components/BrushLibrary.svelte`

- Changed grid columns to:
  - `grid-template-columns: repeat(3, minmax(0, 1fr));`
- Added fixed auto row height:
  - `grid-auto-rows: 40px;`
- Added:
  - `align-content: start;`
- Updated `.brush-thumb`:
  - removed `aspect-ratio: 1`
  - added `width: 100%`, `height: 100%`, `min-height: 0`

Result: tiles flow correctly in rows and no longer overlap.

## 2) Data-path hardening (done during investigation)

File: `src/lib/types.ts`

- `BrushPreset` now includes optional:
  - `thumbnail?: string`

File: `src/lib/components/BrushLibrary.svelte`

- Thumbnail render now uses `preset.thumbnail` directly.
- Import assigns thumbnail directly to each preset.
- Fallback effect backfills missing `preset.thumbnail` values.

Why this helps:

- Removes fragile cross-lookup (`thumbnails[preset.id]`) path.
- Keeps each preset self-contained for rendering.

## 3) Temporary diagnostics

File: `src/lib/components/BrushLibrary.svelte`

- Added a small header counter:
  - `{thumbnailCount}/{presets.length}`

This was used to confirm whether thumbnails were generated vs. merely hidden by layout.

## Verification Outcome

User confirmed after layout fix:

- "Yes, this finally works."

Large ABR imports now display brush thumbnails in proper tiled rows without overlap.

## Suggested Cleanup (Optional)

Once your team is done validating:

1. Keep or remove the debug counter in the header (`thumbnailCount/presets.length`).
2. Keep the `preset.thumbnail` approach (recommended for robustness).
3. Add one regression test checklist item for large ABR packs (100+ brushes) on macOS/WebKit builds.

## Quick Summary for Another LLM

The bug looked like missing ABR thumbnails, but the real visual problem was CSS tile overlap in a scrollable grid using `aspect-ratio` on WebKit. Replacing that with explicit `grid-auto-rows` and full-size tile dimensions fixed rendering. Thumbnail storage was also simplified by placing `thumbnail` directly on each `BrushPreset`.
