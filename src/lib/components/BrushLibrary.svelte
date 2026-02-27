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

  // Generate a 48x48 thumbnail data URL from a BrushTip
  function tipToThumbnail(tip: BrushTip): string {
    const size = 48;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d")!;

    // Dark background so white-alpha tip is visible
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, size, size);

    // Draw tip centered, scaled to fit
    const scale = (size - 4) / Math.max(tip.bitmap.width, tip.bitmap.height);
    const w = tip.bitmap.width * scale;
    const h = tip.bitmap.height * scale;
    ctx.drawImage(tip.bitmap, (size - w) / 2, (size - h) / 2, w, h);

    // OffscreenCanvas can't do toDataURL — draw to a regular canvas
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    const octx = out.getContext("2d")!;
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL("image/png");
  }

  // Cache thumbnails keyed by preset id
  let thumbnails: Map<string, string> = $state(new Map());

  $effect(() => {
    const currentPresets = presets;
    for (const p of currentPresets) {
      if (!thumbnails.has(p.id)) {
        try {
          const thumb = tipToThumbnail(p.tip);
          thumbnails.set(p.id, thumb);
          thumbnails = new Map(thumbnails);
        } catch (err) {
          console.error(`[ABR] Thumbnail failed for "${p.name}" (${p.tip.bitmap.width}x${p.tip.bitmap.height}):`, err);
        }
      }
    }
  });

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      console.log(`[ABR] Loading ${file.name} (${buffer.byteLength} bytes)`);
      const results = await loadAbrFile(buffer);
      console.log(`[ABR] Parsed ${results.length} brushes:`, results.map(r => ({
        name: r.tip.name,
        presetName: r.presetName,
        w: r.tip.bitmap.width,
        h: r.tip.bitmap.height,
        hasDynamics: !!r.dynamics,
      })));

      const baseName = file.name.replace(/\.abr$/i, "");
      const newPresets: BrushPreset[] = results.map((r, i) => ({
        id: `abr-${baseName}-${i}-${Date.now()}`,
        name: r.presetName ?? (r.tip.name !== `Brush ${i + 1}` ? r.tip.name : `${baseName} ${i + 1}`),
        tip: r.tip,
        dynamics: r.dynamics ?? defaultDynamics(),
      }));

      presets = [...presets, ...newPresets];
    } catch (err) {
      console.error("Failed to load ABR file:", err);
    }

    // Reset input so the same file can be re-imported
    input.value = "";
  }

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
        {#if thumbnails.get(preset.id)}
          <img src={thumbnails.get(preset.id)} alt={preset.name} draggable="false" />
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
