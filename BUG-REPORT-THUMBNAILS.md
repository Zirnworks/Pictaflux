# Bug Report: ABR Brush Thumbnails Not Rendering for Large Packs

## Summary

When importing a large Photoshop .abr brush pack (~214 brushes) in a Tauri + Svelte 5 desktop app, the brush grid shows empty cells instead of thumbnail images. Small packs (~10 brushes) work fine. Once a large pack fails, subsequent small pack imports also fail — the app gets "stuck" until restarted.

## Stack

- **Tauri 2** (Rust backend, WKWebView on macOS)
- **Svelte 5** (runes mode: `$state`, `$effect`, `$bindable`, `$props`)
- **macOS** (Apple Silicon M4 Max)
- **Vite** dev server

## The Bug — What Happens

1. User clicks "+" to import an `.abr` file
2. `loadAbrFile()` parses the binary ABR data → returns array of `{ tip: BrushTip, dynamics?, presetName? }` where `tip.bitmap` is an `ImageBitmap`
3. `handleImport()` creates `BrushPreset` objects and generates 48×48 thumbnail data URLs
4. Presets are added to the reactive `presets` array
5. The `{#each}` template renders buttons for each preset
6. **Bug**: The `{#if thumbnails[preset.id]}` check appears falsy for most presets — only ~3 thumbnails at the very bottom of the grid render

## Key Observations

- **Small packs work**: Importing ~10 brushes → all thumbnails appear correctly
- **Large packs fail**: Importing ~214 brushes → only the last ~3 thumbnails appear
- **Failure is sticky**: Once a large pack fails, even a previously-working small pack import will also fail. Only an app restart clears this state.
- **Parsing succeeds**: Console logs confirm all 214 brushes parse correctly with valid names, dimensions (up to 2448×3264, capped to 1024), and `ImageBitmap` objects
- **No errors thrown**: No exceptions in console from thumbnail generation. The try-catch blocks never fire.
- **Brushes work for painting**: Selecting a brush with no thumbnail and drawing with it works — the `ImageBitmap` is alive and functional
- **The grid buttons DO render**: You can see 214 empty button cells in the grid. It's just the `<img>` inside each that's missing.

## Relevant Code

### Types (`src/lib/types.ts`)

```typescript
export interface BrushTip {
  name: string;
  bitmap: ImageBitmap;  // The actual brush shape
  diameter: number;
  spacing: number;
}

export interface BrushPreset {
  id: string;
  name: string;
  tip: BrushTip;
  dynamics: BrushDynamics;
}
```

### ABR Parser (`src/lib/abr-parser.ts`) — relevant excerpt

```typescript
const MAX_TIP_SIZE = 1024;

export async function rawBrushToTip(raw: AbrRawBrush): Promise<BrushTip> {
  const imageData = new ImageData(raw.width, raw.height);
  for (let i = 0; i < raw.width * raw.height; i++) {
    imageData.data[i * 4] = 255;     // R
    imageData.data[i * 4 + 1] = 255; // G
    imageData.data[i * 4 + 2] = 255; // B
    imageData.data[i * 4 + 3] = raw.pixels[i]; // A (grayscale → alpha)
  }

  const maxDim = Math.max(raw.width, raw.height);
  let bitmap: ImageBitmap;
  if (maxDim > MAX_TIP_SIZE) {
    const scale = MAX_TIP_SIZE / maxDim;
    bitmap = await createImageBitmap(imageData, {
      resizeWidth: Math.round(raw.width * scale),
      resizeHeight: Math.round(raw.height * scale),
    });
  } else {
    bitmap = await createImageBitmap(imageData);
  }

  return { name: raw.name, bitmap, diameter: raw.diameter, spacing: raw.spacing > 0 ? raw.spacing : 0.25 };
}

export async function loadAbrFile(buffer: ArrayBuffer): Promise<{ tip: BrushTip; dynamics?: BrushDynamics; presetName?: string }[]> {
  const rawBrushes = parseAbr(buffer);
  const results = [];
  for (const raw of rawBrushes) {
    if (raw.width < 4 || raw.height < 4) continue;         // skip tiny separators
    if (/^separator$/i.test(raw.name)) continue;
    const tip = await rawBrushToTip(raw);
    results.push({ tip, dynamics: raw.dynamics, presetName: raw.name !== tip.name ? raw.name : undefined });
  }
  return results;
}
```

### BrushLibrary Component (`src/lib/components/BrushLibrary.svelte`) — current state

```svelte
<script lang="ts">
  import type { BrushPreset, BrushTip } from "../types";
  import { loadAbrFile } from "../abr-parser";
  import { defaultDynamics } from "../brush-engine";

  let {
    presets = $bindable([]),
    activePresetId = $bindable(""),
    onselect,
  }: {
    presets: BrushPreset[];
    activePresetId: string;
    onselect?: (preset: BrushPreset) => void;
  } = $props();

  let fileInput: HTMLInputElement;

  // Reusable canvas — single context to avoid exhausting WebKit's canvas pool
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 48;
  thumbCanvas.height = 48;
  const thumbCtx = thumbCanvas.getContext("2d")!;

  function tipToThumbnail(tip: BrushTip): string {
    const size = 48;
    thumbCtx.clearRect(0, 0, size, size);
    thumbCtx.fillStyle = "#2a2a2a";
    thumbCtx.fillRect(0, 0, size, size);
    const scale = (size - 4) / Math.max(tip.bitmap.width, tip.bitmap.height);
    const w = tip.bitmap.width * scale;
    const h = tip.bitmap.height * scale;
    thumbCtx.drawImage(tip.bitmap, (size - w) / 2, (size - h) / 2, w, h);
    return thumbCanvas.toDataURL("image/png");
  }

  // Cache thumbnails — plain reactive object
  let thumbnails: Record<string, string> = $state({});

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const results = await loadAbrFile(buffer);
      const baseName = file.name.replace(/\.abr$/i, "");
      const newPresets: BrushPreset[] = [];

      // Generate thumbnails EAGERLY during import, before setting presets
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const id = `abr-${baseName}-${i}-${Date.now()}`;
        const preset: BrushPreset = {
          id,
          name: r.presetName ?? (r.tip.name !== `Brush ${i + 1}` ? r.tip.name : `${baseName} ${i + 1}`),
          tip: r.tip,
          dynamics: r.dynamics ?? defaultDynamics(),
        };
        newPresets.push(preset);

        try {
          const thumb = tipToThumbnail(r.tip);
          thumbnails[id] = thumb;
        } catch (err) {
          console.error(`[ABR] Thumb FAILED ${i}:`, err);
        }
      }

      // Set presets AFTER thumbnails are ready
      presets = [...presets, ...newPresets];
    } catch (err) {
      console.error("Failed to load ABR file:", err);
    }

    input.value = "";
  }

  // Fallback: generate thumbnails for presets that don't have one (e.g. default preset)
  $effect(() => {
    for (const p of presets) {
      if (!thumbnails[p.id]) {
        try {
          thumbnails[p.id] = tipToThumbnail(p.tip);
        } catch {
          // Skip
        }
      }
    }
  });

  function selectPreset(preset: BrushPreset) {
    activePresetId = preset.id;
    onselect?.(preset);
  }
</script>

<div class="brush-library">
  <div class="panel-header">
    <span class="panel-title">Brushes</span>
    <button class="icon-btn" onclick={() => fileInput.click()} title="Import .abr brushes">+</button>
    <input bind:this={fileInput} type="file" accept=".abr" class="hidden-input" onchange={handleImport} />
  </div>

  <div class="brush-grid">
    {#each presets as preset (preset.id)}
      {@const isActive = preset.id === activePresetId}
      <button class="brush-thumb" class:active={isActive} onclick={() => selectPreset(preset)} title={preset.name}>
        {#if thumbnails[preset.id]}
          <img src={thumbnails[preset.id]} alt={preset.name} draggable="false" />
        {/if}
      </button>
    {/each}
  </div>
</div>
```

## What We've Tried (All Failed)

### Attempt 1: Original `$effect` + `$state(new Map())`
- Synchronous `$effect` that iterates all presets, generates thumbnails, and does `thumbnails = new Map(thumbnails)` per brush
- **Theory**: Svelte 5 `$effect` reads + writes `thumbnails` creating a dependency cycle
- **Result**: Same bug

### Attempt 2: `untrack` + async batching + `convertToBlob`
- Used `untrack()` from svelte to break dependency cycle
- Made `tipToThumbnail` async using `OffscreenCanvas.convertToBlob()` + `URL.createObjectURL()`
- Batched Map updates (flush every 10 thumbnails)
- **Theory**: Reactive dependency cycle was causing Svelte to abort the effect
- **Result**: Same bug

### Attempt 3: Eager generation in `handleImport` + plain `$state({})`
- Generate thumbnails synchronously inside `handleImport()` BEFORE setting presets
- Switched from `$state(new Map())` to `$state({})` (plain object)
- Renders via `thumbnails[preset.id]` instead of `thumbnails.get(preset.id)`
- **Theory**: Map proxy issues in Svelte 5, or timing between thumbnail generation and preset rendering
- **Result**: Same bug

### Attempt 4: Reusable canvas (single context)
- Changed from creating a new `document.createElement("canvas")` per thumbnail to reusing a single canvas + context
- **Theory**: WebKit exhausts its canvas context pool at ~64-128 contexts
- **Result**: Same bug

### Other things tried
- **Separator filter**: Skip brushes < 4px or named "Separator" — reduced count but didn't fix thumbnails
- **Bitmap size cap**: Downscale ImageBitmaps > 1024px during ABR parsing — didn't fix
- **Diagnostic logging**: Added per-brush console.log in thumbnail generation — the user couldn't confirm whether logs appeared for all 214 (the console output wasn't fully captured)

## Theories Still Untested

1. **Svelte 5 `$state({})` proxy with 200+ property assignments in a tight loop**: When we do `thumbnails[id] = thumb` 214 times synchronously inside `handleImport`, Svelte's proxy traps fire 214 times. Svelte might batch/debounce these or have internal limits. The final state might only contain the last few entries.

2. **`Date.now()` collision in IDs**: The ID is `abr-${baseName}-${i}-${Date.now()}`. In a tight synchronous loop, `Date.now()` returns the same millisecond value for ALL 214 iterations. So ALL preset IDs are identical except for the `${i}` part. BUT — this should still produce unique IDs since `i` differs. However, it's worth checking if something is doing an exact-match that breaks.

3. **Svelte 5 keyed `{#each}` reuse bug with many items**: The `{#each presets as preset (preset.id)}` uses `preset.id` as the key. When 214 items are added at once, Svelte's keyed-each diffing algorithm might have a bug or performance cliff.

4. **`thumbnails[id] = thumb` doesn't trigger Svelte reactivity inside the proxy**: When `thumbnails` is `$state({})`, direct property assignment should be tracked by the proxy. But assigning 214 new properties (not updating existing ones) in a loop might behave differently than expected.

5. **The `$effect` at lines 97-107 overwrites `handleImport`'s work**: The `$effect` runs when `presets` changes. It iterates all presets and sets `thumbnails[p.id]`. But if this `$effect` runs and reads `thumbnails[p.id]` before Svelte has flushed the proxy writes from `handleImport`, it might see stale state and overwrite with a bad value. Or the effect itself could be resetting the thumbnails object.

6. **The problem is not in thumbnail generation at all — it's in rendering**: Maybe all thumbnails ARE generated and stored correctly, but Svelte's template reactivity doesn't pick up the changes for items already rendered by `{#each}`. This could be tested by adding a "refresh" button that forces `thumbnails = { ...thumbnails }`.

## Suggested Debugging Approach

The most valuable diagnostic would be to add a visible counter in the UI:

```svelte
<span>{Object.keys(thumbnails).length} thumbs / {presets.length} presets</span>
```

This would immediately tell us:
- **If thumbs count = 214**: Thumbnails are generated but rendering fails → Svelte reactivity bug
- **If thumbs count = 3**: Only 3 thumbnails are actually stored → generation or storage issue
- **If thumbs count = 0**: Nothing is stored → the `$state({})` proxy isn't working as expected

Also check: after import, in the browser console, run `document.querySelectorAll('.brush-thumb img').length` to see how many `<img>` elements actually exist in the DOM.

## Repo

https://github.com/Zirnworks/Pictaflux

Key files:
- `src/lib/components/BrushLibrary.svelte` — thumbnail generation + grid rendering
- `src/lib/abr-parser.ts` — ABR binary parser, `loadAbrFile()`, `rawBrushToTip()`
- `src/lib/types.ts` — `BrushPreset`, `BrushTip` types
- `src/lib/brush-engine.ts` — `defaultDynamics()`, `BrushEngine` class
- `src/App.svelte` — parent component, manages `presets` array
