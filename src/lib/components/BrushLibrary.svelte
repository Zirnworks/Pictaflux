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

  // Reusable canvas for thumbnail generation — WebKit limits active canvas contexts
  // to ~64-128, so creating one per brush exhausts the pool permanently
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 48;
  thumbCanvas.height = 48;
  const thumbCtx = thumbCanvas.getContext("2d")!;

  // Generate a 48x48 thumbnail data URL from a BrushTip
  function tipToThumbnail(tip: BrushTip): string {
    const size = 48;

    // Clear and draw dark background
    thumbCtx.clearRect(0, 0, size, size);
    thumbCtx.fillStyle = "#2a2a2a";
    thumbCtx.fillRect(0, 0, size, size);

    // Draw tip centered, scaled to fit
    const scale = (size - 4) / Math.max(tip.bitmap.width, tip.bitmap.height);
    const w = tip.bitmap.width * scale;
    const h = tip.bitmap.height * scale;
    thumbCtx.drawImage(tip.bitmap, (size - w) / 2, (size - h) / 2, w, h);

    return thumbCanvas.toDataURL("image/png");
  }

  // Cache thumbnails — plain object, not Map (Svelte 5 proxies objects reliably)
  let thumbnails: Record<string, string> = $state({});

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      console.log(`[ABR] Loading ${file.name} (${buffer.byteLength} bytes)`);
      const results = await loadAbrFile(buffer);
      console.log(`[ABR] Parsed ${results.length} brushes`);

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

        // Generate thumbnail right now while bitmap is guaranteed alive
        try {
          const thumb = tipToThumbnail(r.tip);
          thumbnails[id] = thumb;
          console.log(`[ABR] Thumb ${i + 1}/${results.length}: ${preset.name} → ${thumb.length} chars`);
        } catch (err) {
          console.error(`[ABR] Thumb FAILED ${i + 1}/${results.length}: ${preset.name}`, err);
        }
      }

      console.log(`[ABR] Thumbnails generated: ${Object.keys(thumbnails).length} total in cache`);

      // Set presets AFTER thumbnails are ready
      presets = [...presets, ...newPresets];

      console.log(`[ABR] Presets set: ${presets.length} total`);
    } catch (err) {
      console.error("Failed to load ABR file:", err);
    }

    // Reset input so the same file can be re-imported
    input.value = "";
  }

  // Also generate thumbnails for any presets that don't have one (e.g. default preset)
  $effect(() => {
    for (const p of presets) {
      if (!thumbnails[p.id]) {
        try {
          thumbnails[p.id] = tipToThumbnail(p.tip);
        } catch {
          // Skip — will retry on next effect run
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
    <button
      class="icon-btn"
      onclick={() => fileInput.click()}
      title="Import .abr brushes"
    >+</button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".abr"
      class="hidden-input"
      onchange={handleImport}
    />
  </div>

  <div class="brush-grid">
    {#each presets as preset (preset.id)}
      {@const isActive = preset.id === activePresetId}
      <button
        class="brush-thumb"
        class:active={isActive}
        onclick={() => selectPreset(preset)}
        title={preset.name}
      >
        {#if thumbnails[preset.id]}
          <img src={thumbnails[preset.id]} alt={preset.name} draggable="false" />
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .brush-library {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--border);
    max-height: 200px;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent);
    font-weight: 600;
  }

  .icon-btn {
    font-size: 11px;
    padding: 2px 6px;
    min-width: unset;
    line-height: 1.2;
  }

  .hidden-input {
    display: none;
  }

  .brush-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    padding: 4px;
    overflow-y: auto;
  }

  .brush-thumb {
    aspect-ratio: 1;
    padding: 0;
    min-width: unset;
    border: 2px solid transparent;
    border-radius: 4px;
    background: var(--bg-control);
    cursor: pointer;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .brush-thumb:hover {
    border-color: var(--text-secondary);
  }

  .brush-thumb.active {
    border-color: var(--accent);
  }

  .brush-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
</style>
