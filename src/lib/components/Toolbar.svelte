<script lang="ts">
  let {
    brushSize = $bindable(8),
    brushColor = $bindable("#ffffff"),
    brushOpacity = $bindable(1.0),
    prompt = $bindable(""),
    strength = $bindable(0.5),
    onclear,
    diffusionState = "disconnected",
    onToggleDiffusion,
  }: {
    brushSize: number;
    brushColor: string;
    brushOpacity: number;
    prompt: string;
    strength: number;
    onclear?: () => void;
    diffusionState: string;
    onToggleDiffusion?: () => void;
  } = $props();
</script>

<div class="toolbar">
  <div class="tool-group">
    <span class="tool-label">Brush</span>
    <div class="tool-control">
      <label title="Brush diameter in pixels">Size
        <input type="range" min="1" max="64" step="1" bind:value={brushSize} />
      </label>
      <span class="value">{brushSize}px</span>
    </div>
    <div class="tool-control">
      <label title="Brush opacity (pressure scales this)">Opacity
        <input type="range" min="0.05" max="1.0" step="0.05" bind:value={brushOpacity} />
      </label>
      <span class="value">{(brushOpacity * 100).toFixed(0)}%</span>
    </div>
    <div class="color-control">
      <input type="color" bind:value={brushColor} title="Brush color" />
      <span class="color-hex">{brushColor}</span>
    </div>
  </div>

  <div class="separator"></div>

  <div class="tool-group prompt-group">
    <label class="tool-label">Prompt
      <input
        type="text"
        class="prompt-input"
        placeholder="Describe the style..."
        bind:value={prompt}
      />
    </label>
  </div>

  <div class="separator"></div>

  <div class="tool-group">
    <div class="tool-control">
      <label title="img2img strength: low = faithful to drawing, high = more creative">Strength
        <input type="range" min="0" max="1.0" step="0.05" bind:value={strength} />
      </label>
      <span class="value">{(strength * 100).toFixed(0)}%</span>
    </div>
  </div>

  <div class="separator"></div>

  <div class="tool-group">
    <button
      class="diffusion-btn"
      class:active={diffusionState === "connected"}
      class:loading={diffusionState === "loading" || diffusionState === "connecting"}
      class:error={diffusionState === "error"}
      onclick={onToggleDiffusion}
      disabled={diffusionState === "loading" || diffusionState === "connecting"}
    >
      {#if diffusionState === "loading" || diffusionState === "connecting"}
        Loading...
      {:else if diffusionState === "connected"}
        Stop
      {:else if diffusionState === "error"}
        Retry
      {:else}
        Diffuse
      {/if}
    </button>
  </div>

  <div class="spacer"></div>

  <div class="tool-group">
    <button class="clear-btn" onclick={onclear}>Clear</button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    height: var(--toolbar-height);
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .tool-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tool-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent);
    font-weight: 600;
  }

  .tool-control {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tool-control label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .tool-control input[type="range"] {
    width: 80px;
    padding: 0;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border: none;
    border-radius: 2px;
    outline: none;
  }

  .tool-control input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .value {
    font-size: 11px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  }

  .color-control {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .color-control input[type="color"] {
    width: 28px;
    height: 28px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-control);
    cursor: pointer;
  }

  .color-hex {
    font-size: 11px;
    color: var(--text-secondary);
    font-family: monospace;
  }

  .separator {
    width: 1px;
    height: 24px;
    background: var(--border);
    flex-shrink: 0;
  }

  .prompt-group {
    flex: 1;
    min-width: 0;
  }

  .prompt-input {
    flex: 1;
    min-width: 0;
    background: var(--bg-control);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
    outline: none;
  }

  .prompt-input:focus {
    border-color: var(--accent);
  }

  .prompt-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.5;
  }

  .spacer {
    flex: 1;
  }

  .clear-btn {
    font-size: 12px;
    padding: 5px 12px;
    background: var(--bg-control);
    color: var(--text-secondary);
  }

  .clear-btn:hover {
    background: var(--accent-dark);
    color: var(--text-primary);
    border-color: var(--accent-dark);
  }

  .diffusion-btn {
    font-size: 12px;
    padding: 5px 14px;
    font-weight: 600;
    transition: all 0.15s;
  }

  .diffusion-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .diffusion-btn.loading {
    background: var(--bg-control);
    border-color: var(--accent-dark);
    color: var(--accent);
    cursor: wait;
  }

  .diffusion-btn.error {
    background: var(--bg-control);
    border-color: #e53e3e;
    color: #e53e3e;
  }
</style>
