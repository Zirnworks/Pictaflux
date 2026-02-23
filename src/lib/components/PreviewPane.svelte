<script lang="ts">
  let imageUrl: string | null = $state(null);
  let fps: number = $state(0);

  export function setImage(url: string) {
    imageUrl = url;
  }

  export function setFps(value: number) {
    fps = value;
  }

  export function clear() {
    imageUrl = null;
    fps = 0;
  }
</script>

<div class="preview-pane">
  {#if imageUrl}
    <img src={imageUrl} alt="Diffusion preview" class="preview-image" />
    {#if fps > 0}
      <div class="fps-overlay">{fps.toFixed(1)} FPS</div>
    {/if}
  {:else}
    <div class="placeholder">
      <div class="placeholder-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
      <span class="placeholder-text">Diffusion preview will appear here</span>
      <span class="placeholder-sub">Draw on the left pane to begin</span>
    </div>
  {/if}
</div>

<style>
  .preview-pane {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    overflow: hidden;
    position: relative;
  }

  .preview-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    image-rendering: auto;
  }

  .fps-overlay {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.6);
    color: #4ade80;
    font-size: 12px;
    font-family: monospace;
    font-variant-numeric: tabular-nums;
    padding: 2px 8px;
    border-radius: 4px;
    pointer-events: none;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--text-secondary);
    user-select: none;
  }

  .placeholder-icon {
    opacity: 0.3;
    color: var(--text-secondary);
  }

  .placeholder-text {
    font-size: 14px;
    font-weight: 500;
  }

  .placeholder-sub {
    font-size: 12px;
    opacity: 0.5;
  }
</style>
