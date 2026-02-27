<script lang="ts">
  let {
    brushSize = $bindable(8),
    brushColor = $bindable("#ffffff"),
    brushOpacity = $bindable(1.0),
    prompt = $bindable(""),
    strength = $bindable(0.5),
    feedback = $bindable(0.1),
    lerpSpeed = $bindable(0.05),
    seed = $bindable(42),
    model = $bindable("sdxs"),
    renderSize = $bindable(512),
    cfgScale = $bindable(1.0),
    negativePrompt = $bindable(""),
    numSteps = $bindable(1),
    onclear,
    diffusionState = "disconnected",
    onToggleDiffusion,
    activeBrushName = "Soft Round",
    onToggleBrushSettings,
  }: {
    brushSize: number;
    brushColor: string;
    brushOpacity: number;
    prompt: string;
    strength: number;
    feedback: number;
    lerpSpeed: number;
    seed: number;
    model: string;
    renderSize: number;
    cfgScale: number;
    negativePrompt: string;
    numSteps: number;
    onclear?: () => void;
    diffusionState: string;
    onToggleDiffusion?: () => void;
    activeBrushName: string;
    onToggleBrushSettings?: () => void;
  } = $props();

  function randomizeSeed() {
    seed = Math.floor(Math.random() * 2147483647);
  }
</script>

<div class="toolbar-container">
  <div class="toolbar">
    <div class="tool-group">
      <span class="tool-label">Brush</span>
      <button class="brush-name-btn" onclick={onToggleBrushSettings} title="Brush settings">
        {activeBrushName}
      </button>
      <div class="tool-control">
        <label title="Brush diameter in pixels">Size
          <input type="range" min="1" max="256" step="1" bind:value={brushSize} />
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

  <div class="toolbar toolbar-advanced">
    {#if model === "sd-turbo"}
      <div class="tool-group">
        <span class="tool-label">CFG</span>
        <div class="tool-control">
          <label title="Classifier-free guidance scale (1 = off, higher = stronger prompt adherence, halves FPS)">Scale
            <input type="range" min="1" max="20" step="0.5" bind:value={cfgScale} />
          </label>
          <span class="value">{cfgScale.toFixed(1)}</span>
        </div>
        <div class="tool-control">
          <label title="Number of denoising steps (more = better quality, proportionally slower)">Steps
            <input type="range" min="1" max="8" step="1" bind:value={numSteps} />
          </label>
          <span class="value">{numSteps}</span>
        </div>
      </div>

      <div class="separator"></div>

      <div class="tool-group neg-prompt-group">
        <label class="tool-label">Negative
          <input
            type="text"
            class="neg-prompt-input"
            placeholder="What to avoid..."
            bind:value={negativePrompt}
          />
        </label>
      </div>

      <div class="separator"></div>
    {/if}

    <div class="tool-group">
      <span class="tool-label">Pipeline</span>
      <div class="tool-control">
        <label title="Latent feedback: blends previous frame latent into current (temporal stability)">Feedback
          <input type="range" min="0" max="1" step="0.01" bind:value={feedback} />
        </label>
        <span class="value">{(feedback * 100).toFixed(0)}%</span>
      </div>
      <div class="tool-control">
        <label title="How fast prompt embedding transitions to new prompt">Lerp
          <input type="range" min="0.01" max="0.5" step="0.01" bind:value={lerpSpeed} />
        </label>
        <span class="value">{lerpSpeed.toFixed(2)}</span>
      </div>
      <div class="tool-control seed-control">
        <label title="Fixed noise seed (deterministic output pattern)">Seed
          <input type="number" class="seed-input" min="0" max="2147483647" bind:value={seed} />
        </label>
        <button class="seed-randomize" onclick={randomizeSeed} title="Randomize seed">&#x2684;</button>
      </div>
    </div>

    <div class="separator"></div>

    <div class="tool-group restart-group">
      <span class="restart-indicator" title="Changes require sidecar restart">&#x21bb;</span>
      <div class="tool-control">
        <label title="Diffusion model (restart required)">Model
          <select bind:value={model}>
            <option value="sdxs">SDXS</option>
            <option value="sd-turbo">SD Turbo</option>
          </select>
        </label>
      </div>
      <div class="tool-control">
        <label title="Render resolution in pixels (restart required)">Size
          <select bind:value={renderSize}>
            <option value={512}>512px</option>
            <option value={384}>384px</option>
            <option value={320}>320px</option>
          </select>
        </label>
      </div>
    </div>
  </div>
</div>

<style>
  .toolbar-container {
    flex-shrink: 0;
  }

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

  .toolbar-advanced {
    height: 36px;
    padding: 4px 12px;
    gap: 10px;
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

  .brush-name-btn {
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 6px;
    min-width: unset;
    cursor: pointer;
  }

  .brush-name-btn:hover {
    color: var(--text-primary);
    border-color: var(--border);
    background: var(--bg-control);
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

  /* Advanced toolbar row */
  .seed-control {
    gap: 4px;
  }

  .seed-input {
    width: 80px;
    background: var(--bg-control);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .seed-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .seed-randomize {
    font-size: 14px;
    padding: 2px 6px;
    min-width: unset;
    line-height: 1;
  }

  .neg-prompt-group {
    flex: 1;
    min-width: 0;
  }

  .neg-prompt-input {
    flex: 1;
    min-width: 0;
    background: var(--bg-control);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    outline: none;
  }

  .neg-prompt-input:focus {
    border-color: var(--accent);
  }

  .neg-prompt-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.5;
  }

  .restart-group {
    border-left: 2px solid var(--accent-dark);
    padding-left: 12px;
  }

  .restart-indicator {
    font-size: 13px;
    color: var(--accent-dark);
  }

  select {
    background: var(--bg-control);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
  }

  select:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
