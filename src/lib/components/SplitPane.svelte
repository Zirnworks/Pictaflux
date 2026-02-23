<script lang="ts">
  import type { Snippet } from "svelte";

  let { left, right }: { left: Snippet; right: Snippet } = $props();

  let splitPercent = $state(55);
  let dragging = $state(false);
  let container: HTMLElement;

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || !container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;
    splitPercent = Math.max(20, Math.min(80, pct));
  }

  function onPointerUp() {
    dragging = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="split-pane"
  bind:this={container}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
>
  <div class="pane left-pane" style="width: {splitPercent}%">
    {@render left()}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="divider"
    class:active={dragging}
    onpointerdown={onPointerDown}
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
  ></div>
  <div class="pane right-pane" style="width: {100 - splitPercent}%">
    {@render right()}
  </div>
</div>

<style>
  .split-pane {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .pane {
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .divider {
    width: 6px;
    cursor: col-resize;
    background: var(--border);
    flex-shrink: 0;
    transition: background 0.15s;
    position: relative;
  }

  .divider:hover,
  .divider.active {
    background: var(--accent);
  }

  .divider::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 32px;
    background: var(--text-secondary);
    border-radius: 1px;
    opacity: 0.4;
  }

  .divider:hover::after,
  .divider.active::after {
    opacity: 0.8;
    background: var(--bg-primary);
  }
</style>
