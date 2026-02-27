<script lang="ts">
  import { onMount } from "svelte";
  import type { BrushPreset, BrushDynamics, DynamicsController, DynamicsControl } from "../types";

  let {
    preset,
    onchange,
    onclose,
  }: {
    preset: BrushPreset;
    onchange?: (preset: BrushPreset) => void;
    onclose?: () => void;
  } = $props();

  let popoverEl: HTMLElement;

  // Track which sections are open
  let openSections: Record<string, boolean> = $state({
    tip: true,
    shape: true,
    scatter: false,
    transfer: true,
  });

  function toggle(section: string) {
    openSections[section] = !openSections[section];
  }

  const controlOptions: { value: DynamicsControl; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "pressure", label: "Pressure" },
    { value: "tilt", label: "Tilt" },
    { value: "direction", label: "Direction" },
    { value: "fade", label: "Fade" },
  ];

  // Helpers to update nested dynamics and notify parent
  function emit(updated: BrushPreset) {
    onchange?.(updated);
  }

  function setDynamics<K extends keyof BrushDynamics>(key: K, value: BrushDynamics[K]) {
    emit({
      ...preset,
      dynamics: { ...preset.dynamics, [key]: value },
    });
  }

  function setController(key: keyof BrushDynamics, field: keyof DynamicsController, value: number | string) {
    const ctrl = preset.dynamics[key] as DynamicsController;
    setDynamics(key as keyof BrushDynamics, { ...ctrl, [field]: value } as never);
  }

  function onClickOutside(e: MouseEvent) {
    if (popoverEl && !popoverEl.contains(e.target as Node)) {
      onclose?.();
    }
  }

  onMount(() => {
    // Open scatter section if scatter is enabled
    if (preset.dynamics.scatterEnabled) {
      openSections.scatter = true;
    }
    document.addEventListener("pointerdown", onClickOutside, true);
    return () => document.removeEventListener("pointerdown", onClickOutside, true);
  });
</script>

<div class="brush-settings" bind:this={popoverEl}>
  <div class="settings-header">
    <span class="settings-title">{preset.name}</span>
    <button class="close-btn" onclick={onclose}>&#x2715;</button>
  </div>

  <div class="settings-body">
    <!-- Brush Tip Shape -->
    <button class="section-toggle" onclick={() => toggle("tip")}>
      <span class="chevron" class:open={openSections.tip}>&#x25B6;</span>
      Brush Tip Shape
    </button>
    {#if openSections.tip}
      <div class="section-content">
        <label class="row">
          <span class="lbl">Spacing</span>
          <input type="range" min="0.01" max="3" step="0.01"
            value={preset.dynamics.spacing}
            oninput={(e) => setDynamics("spacing", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.spacing * 100)}%</span>
        </label>
        <label class="row">
          <span class="lbl">Angle</span>
          <input type="range" min="0" max="360" step="1"
            value={Math.round(preset.dynamics.tipAngle * 180 / Math.PI)}
            oninput={(e) => setDynamics("tipAngle", parseFloat(e.currentTarget.value) * Math.PI / 180)}
          />
          <span class="val">{Math.round(preset.dynamics.tipAngle * 180 / Math.PI)}&deg;</span>
        </label>
        <label class="row">
          <span class="lbl">Roundness</span>
          <input type="range" min="0.01" max="1" step="0.01"
            value={preset.dynamics.tipRoundness}
            oninput={(e) => setDynamics("tipRoundness", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.tipRoundness * 100)}%</span>
        </label>
        <label class="row">
          <span class="lbl">Hardness</span>
          <input type="range" min="0" max="1" step="0.01"
            value={preset.dynamics.hardness}
            oninput={(e) => setDynamics("hardness", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.hardness * 100)}%</span>
        </label>
        <div class="row checkboxes">
          <label class="check">
            <input type="checkbox"
              checked={preset.dynamics.flipX}
              onchange={(e) => setDynamics("flipX", e.currentTarget.checked)}
            /> Flip X
          </label>
          <label class="check">
            <input type="checkbox"
              checked={preset.dynamics.flipY}
              onchange={(e) => setDynamics("flipY", e.currentTarget.checked)}
            /> Flip Y
          </label>
        </div>
      </div>
    {/if}

    <!-- Shape Dynamics -->
    <button class="section-toggle" onclick={() => toggle("shape")}>
      <span class="chevron" class:open={openSections.shape}>&#x25B6;</span>
      Shape Dynamics
    </button>
    {#if openSections.shape}
      <div class="section-content">
        <label class="row">
          <span class="lbl">Size</span>
          <select
            value={preset.dynamics.size.control}
            onchange={(e) => setController("size", "control", e.currentTarget.value)}
          >
            {#each controlOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
        {#if preset.dynamics.size.control !== "off"}
          <label class="row sub">
            <span class="lbl">Min Size</span>
            <input type="range" min="0" max="1" step="0.01"
              value={preset.dynamics.size.minimum}
              oninput={(e) => setController("size", "minimum", parseFloat(e.currentTarget.value))}
            />
            <span class="val">{Math.round(preset.dynamics.size.minimum * 100)}%</span>
          </label>
        {/if}
        <label class="row sub">
          <span class="lbl">Size Jitter</span>
          <input type="range" min="0" max="1" step="0.01"
            value={preset.dynamics.size.jitter}
            oninput={(e) => setController("size", "jitter", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.size.jitter * 100)}%</span>
        </label>

        <label class="row">
          <span class="lbl">Angle</span>
          <select
            value={preset.dynamics.angle.control}
            onchange={(e) => setController("angle", "control", e.currentTarget.value)}
          >
            {#each controlOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <label class="row sub">
          <span class="lbl">Angle Jitter</span>
          <input type="range" min="0" max="1" step="0.01"
            value={preset.dynamics.angle.jitter}
            oninput={(e) => setController("angle", "jitter", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.angle.jitter * 100)}%</span>
        </label>

        <label class="row">
          <span class="lbl">Roundness</span>
          <select
            value={preset.dynamics.roundness.control}
            onchange={(e) => setController("roundness", "control", e.currentTarget.value)}
          >
            {#each controlOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <label class="row sub">
          <span class="lbl">Rnd Jitter</span>
          <input type="range" min="0" max="1" step="0.01"
            value={preset.dynamics.roundness.jitter}
            oninput={(e) => setController("roundness", "jitter", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.roundness.jitter * 100)}%</span>
        </label>
      </div>
    {/if}

    <!-- Scatter -->
    <button class="section-toggle" onclick={() => toggle("scatter")}>
      <span class="chevron" class:open={openSections.scatter}>&#x25B6;</span>
      Scatter
      <label class="section-check" onclick={(e) => e.stopPropagation()}>
        <input type="checkbox"
          checked={preset.dynamics.scatterEnabled}
          onchange={(e) => {
            setDynamics("scatterEnabled", e.currentTarget.checked);
            if (e.currentTarget.checked) openSections.scatter = true;
          }}
        />
      </label>
    </button>
    {#if openSections.scatter}
      <div class="section-content">
        <label class="row">
          <span class="lbl">Scatter</span>
          <input type="range" min="0" max="5" step="0.01"
            value={preset.dynamics.scatter.jitter}
            oninput={(e) => setController("scatter", "jitter", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.scatter.jitter * 100)}%</span>
        </label>
        <label class="row">
          <span class="lbl">Count</span>
          <input type="range" min="1" max="16" step="1"
            value={preset.dynamics.scatterCount}
            oninput={(e) => setDynamics("scatterCount", parseInt(e.currentTarget.value))}
          />
          <span class="val">{preset.dynamics.scatterCount}</span>
        </label>
        <div class="row checkboxes">
          <label class="check">
            <input type="checkbox"
              checked={preset.dynamics.scatterBothAxes}
              onchange={(e) => setDynamics("scatterBothAxes", e.currentTarget.checked)}
            /> Both Axes
          </label>
        </div>
      </div>
    {/if}

    <!-- Transfer -->
    <button class="section-toggle" onclick={() => toggle("transfer")}>
      <span class="chevron" class:open={openSections.transfer}>&#x25B6;</span>
      Transfer
    </button>
    {#if openSections.transfer}
      <div class="section-content">
        <label class="row">
          <span class="lbl">Opacity</span>
          <select
            value={preset.dynamics.opacity.control}
            onchange={(e) => setController("opacity", "control", e.currentTarget.value)}
          >
            {#each controlOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
        {#if preset.dynamics.opacity.control !== "off"}
          <label class="row sub">
            <span class="lbl">Min Opacity</span>
            <input type="range" min="0" max="1" step="0.01"
              value={preset.dynamics.opacity.minimum}
              oninput={(e) => setController("opacity", "minimum", parseFloat(e.currentTarget.value))}
            />
            <span class="val">{Math.round(preset.dynamics.opacity.minimum * 100)}%</span>
          </label>
        {/if}
        <label class="row sub">
          <span class="lbl">Op Jitter</span>
          <input type="range" min="0" max="1" step="0.01"
            value={preset.dynamics.opacity.jitter}
            oninput={(e) => setController("opacity", "jitter", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.opacity.jitter * 100)}%</span>
        </label>

        <label class="row">
          <span class="lbl">Flow</span>
          <select
            value={preset.dynamics.flow.control}
            onchange={(e) => setController("flow", "control", e.currentTarget.value)}
          >
            {#each controlOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <label class="row sub">
          <span class="lbl">Flow Jitter</span>
          <input type="range" min="0" max="1" step="0.01"
            value={preset.dynamics.flow.jitter}
            oninput={(e) => setController("flow", "jitter", parseFloat(e.currentTarget.value))}
          />
          <span class="val">{Math.round(preset.dynamics.flow.jitter * 100)}%</span>
        </label>
      </div>
    {/if}
  </div>
</div>

<style>
  .brush-settings {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 200;
    width: 280px;
    max-height: 480px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .settings-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close-btn {
    font-size: 11px;
    padding: 2px 5px;
    min-width: unset;
    line-height: 1;
    color: var(--text-secondary);
    background: none;
    border: none;
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-control);
    border: none;
  }

  .settings-body {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .section-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--accent);
    background: var(--bg-primary);
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    cursor: pointer;
    text-align: left;
  }

  .section-toggle:hover {
    background: var(--bg-control);
    border-color: var(--border);
  }

  .section-check {
    margin-left: auto;
    cursor: pointer;
  }

  .section-check input[type="checkbox"] {
    cursor: pointer;
  }

  .chevron {
    font-size: 8px;
    transition: transform 0.15s;
    color: var(--text-secondary);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .section-content {
    padding: 6px 10px 8px;
    border-bottom: 1px solid var(--border);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .row.sub {
    padding-left: 8px;
  }

  .row.checkboxes {
    gap: 12px;
    padding-top: 2px;
  }

  .lbl {
    font-size: 10px;
    color: var(--text-secondary);
    width: 56px;
    flex-shrink: 0;
  }

  .val {
    font-size: 10px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 32px;
    text-align: right;
    flex-shrink: 0;
  }

  .row input[type="range"] {
    flex: 1;
    min-width: 0;
    height: 3px;
    padding: 0;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border: none;
    border-radius: 2px;
  }

  .row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .row select {
    flex: 1;
    min-width: 0;
    font-size: 10px;
    padding: 2px 4px;
    background: var(--bg-control);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  .row select:focus {
    border-color: var(--accent);
    outline: none;
  }

  .check {
    font-size: 10px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }

  .check input[type="checkbox"] {
    cursor: pointer;
    accent-color: var(--accent);
  }
</style>
