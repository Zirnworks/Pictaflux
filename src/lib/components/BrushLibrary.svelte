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

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const results = await loadAbrFile(buffer);

      const baseName = file.name.replace(/\.abr$/i, "");
      const importStamp = Date.now();
      const newPresets: BrushPreset[] = [];

      // Generate thumbnails EAGERLY during import, before setting presets
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const id = `abr-${baseName}-${i}-${importStamp}`;
        const preset: BrushPreset = {
          id,
          name: r.presetName ?? (r.tip.name !== `Brush ${i + 1}` ? r.tip.name : `${baseName} ${i + 1}`),
          tip: r.tip,
          dynamics: r.dynamics ?? defaultDynamics(),
        };

        // Generate thumbnail right now while bitmap is guaranteed alive
        try {
          preset.thumbnail = tipToThumbnail(r.tip);
        } catch {
          // Thumbnail generation failed — cell will be blank
        }

        newPresets.push(preset);
      }

      presets = newPresets;
    } catch (err) {
      console.error("Failed to load ABR file:", err);
    }

    // Reset input so the same file can be re-imported
    input.value = "";
  }

  // Also generate thumbnails for any presets that don't have one (e.g. default preset)
  $effect(() => {
    let changed = false;
    const updatedPresets = presets.map((p) => {
      if (p.thumbnail) return p;

      try {
        changed = true;
        return { ...p, thumbnail: tipToThumbnail(p.tip) };
      } catch {
        // Skip — will retry on next effect run
        return p;
      }
    });

    if (changed) {
      presets = updatedPresets;
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
        {#if preset.thumbnail}
          <img src={preset.thumbnail} alt={preset.name} draggable="false" />
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: 40px;
    gap: 2px;
    padding: 4px;
    overflow-y: auto;
    align-content: start;
  }

  .brush-thumb {
    width: 100%;
    height: 100%;
    padding: 0;
    min-width: unset;
    min-height: 0;
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
