<script lang="ts">
  import type { LayerManager } from "../layers.svelte";
  import type { BlendMode } from "../types";
  import ColorWheel from "./ColorWheel.svelte";

  let { layerManager }: { layerManager: LayerManager } = $props();

  let showColorWheel = $state(false);

  let dragFromDisplay: number | null = $state(null);
  let dragOverDisplay: number | null = $state(null);
  let renamingId: number | null = $state(null);
  let renameValue = $state("");

  const blendOptions: { value: BlendMode; label: string }[] = [
    { value: "source-over", label: "Normal" },
    { value: "multiply", label: "Multiply" },
    { value: "screen", label: "Screen" },
    { value: "overlay", label: "Overlay" },
  ];

  function displayToArray(displayIdx: number): number {
    return layerManager.layers.length - 1 - displayIdx;
  }

  function onDragStart(e: DragEvent, displayIdx: number) {
    dragFromDisplay = displayIdx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(displayIdx));
    }
  }

  function onDragOver(e: DragEvent, displayIdx: number) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverDisplay = displayIdx;
  }

  function onDrop(e: DragEvent, toDisplay: number) {
    e.preventDefault();
    if (dragFromDisplay !== null && dragFromDisplay !== toDisplay) {
      const fromArr = displayToArray(dragFromDisplay);
      const toArr = displayToArray(toDisplay);
      layerManager.reorderLayer(fromArr, toArr);
    }
    dragFromDisplay = null;
    dragOverDisplay = null;
  }

  function onDragEnd() {
    dragFromDisplay = null;
    dragOverDisplay = null;
  }

  function startRename(id: number, currentName: string) {
    renamingId = id;
    renameValue = currentName;
  }

  function commitRename() {
    if (renamingId !== null && renameValue.trim()) {
      layerManager.renameLayer(renamingId, renameValue.trim());
    }
    renamingId = null;
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") renamingId = null;
  }
</script>

<div class="layer-panel">
  <div class="panel-header">
    <span class="panel-title">Layers</span>
    <div class="panel-actions">
      <button
        class="icon-btn"
        onclick={() => layerManager.addLayer()}
        title="Add layer"
      >+</button>
      <button
        class="icon-btn"
        onclick={() => layerManager.flatten()}
        title="Flatten all layers"
      >F</button>
    </div>
  </div>

  <div class="layer-list">
    {#each [...layerManager.layers].reverse() as layer, displayIdx (layer.id)}
      {@const isActive = layer.id === layerManager.activeLayerId}
      <div
        class="layer-item"
        class:active={isActive}
        class:drag-over={dragOverDisplay === displayIdx && dragFromDisplay !== displayIdx}
        draggable="true"
        role="button"
        tabindex="0"
        ondragstart={(e) => onDragStart(e, displayIdx)}
        ondragover={(e) => onDragOver(e, displayIdx)}
        ondrop={(e) => onDrop(e, displayIdx)}
        ondragend={onDragEnd}
        onclick={() => (layerManager.activeLayerId = layer.id)}
        onkeydown={(e) => { if (e.key === "Enter") layerManager.activeLayerId = layer.id; }}
      >
        <button
          class="vis-toggle"
          class:hidden={!layer.visible}
          onclick={(e) => {
            e.stopPropagation();
            layerManager.setLayerVisibility(layer.id, !layer.visible);
          }}
          title={layer.visible ? "Hide layer" : "Show layer"}
        >{layer.visible ? "\u{1F441}" : "\u2014"}</button>

        <div class="thumbnail">
          {#if layer.thumbnailUrl}
            <img src={layer.thumbnailUrl} alt="" draggable="false" />
          {/if}
        </div>

        {#if renamingId === layer.id}
          <input
            class="rename-input"
            type="text"
            bind:value={renameValue}
            onblur={commitRename}
            onkeydown={onRenameKeydown}
            onclick={(e) => e.stopPropagation()}
          />
        {:else}
          <span
            class="layer-name"
            role="textbox"
            tabindex="0"
            ondblclick={(e) => {
              e.stopPropagation();
              startRename(layer.id, layer.name);
            }}
          >{layer.name}</span>
        {/if}
      </div>

      {#if isActive}
        <div class="active-controls">
          <label class="control-row">
            <span class="ctrl-label">Opacity</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={layer.opacity}
              oninput={(e) =>
                layerManager.setLayerOpacity(
                  layer.id,
                  parseFloat(e.currentTarget.value),
                )}
            />
            <span class="ctrl-value">{Math.round(layer.opacity * 100)}%</span>
          </label>
          <label class="control-row">
            <span class="ctrl-label">Blend</span>
            <select
              value={layer.blendMode}
              onchange={(e) =>
                layerManager.setLayerBlendMode(
                  layer.id,
                  e.currentTarget.value as BlendMode,
                )}
            >
              {#each blendOptions as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </label>
        </div>
      {/if}
    {/each}
  </div>

  <div class="bg-section">
    <button
      class="vis-toggle bg-vis"
      class:hidden={!layerManager.bgVisible}
      onclick={() => (layerManager.bgVisible = !layerManager.bgVisible)}
      title={layerManager.bgVisible ? "Hide background" : "Show background"}
    >{layerManager.bgVisible ? "\u{1F441}" : "\u2014"}</button>
    <span class="bg-label">BG</span>
    <button
      class="bg-swatch"
      style="background: {layerManager.bgColor}"
      onclick={() => (showColorWheel = !showColorWheel)}
      title="Change background color"
    ></button>
    {#if showColorWheel}
      <ColorWheel
        bind:color={layerManager.bgColor}
        onclose={() => (showColorWheel = false)}
      />
    {/if}
  </div>

  <div class="panel-footer">
    <button
      class="icon-btn"
      onclick={() => layerManager.duplicateLayer(layerManager.activeLayerId)}
      title="Duplicate layer"
    >Dup</button>
    <button
      class="icon-btn"
      onclick={() => layerManager.mergeDown(layerManager.activeLayerId)}
      title="Merge down"
      disabled={layerManager.layers.findIndex(
        (l) => l.id === layerManager.activeLayerId,
      ) === 0}
    >Mrg</button>
    <button
      class="icon-btn danger"
      onclick={() => layerManager.deleteLayer(layerManager.activeLayerId)}
      title="Delete layer"
      disabled={layerManager.layers.length <= 1}
    >Del</button>
  </div>
</div>

<style>
  .layer-panel {
    width: 140px;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    user-select: none;
    overflow: hidden;
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

  .panel-actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    font-size: 11px;
    padding: 2px 6px;
    min-width: unset;
    line-height: 1.2;
  }

  .icon-btn.danger:not(:disabled):hover {
    background: #e53e3e;
    border-color: #e53e3e;
  }

  .layer-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .layer-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
  }

  .layer-item:hover {
    background: var(--bg-control);
  }

  .layer-item.active {
    background: var(--bg-control);
    border-left: 2px solid var(--accent);
    padding-left: 4px;
  }

  .layer-item.drag-over {
    border-top: 2px solid var(--accent);
  }

  .vis-toggle {
    font-size: 12px;
    padding: 0;
    min-width: 20px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .vis-toggle:hover {
    color: var(--text-primary);
    background: none;
    border: none;
  }

  .vis-toggle.hidden {
    opacity: 0.4;
  }

  .thumbnail {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 2px;
    background:
      repeating-conic-gradient(#333 0% 25%, #444 0% 50%) 50% / 8px 8px;
    overflow: hidden;
  }

  .thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .layer-name {
    font-size: 11px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .rename-input {
    font-size: 11px;
    background: var(--bg-control);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 2px;
    padding: 1px 4px;
    width: 100%;
    flex: 1;
    min-width: 0;
    outline: none;
  }

  .active-controls {
    padding: 4px 8px 6px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }

  .ctrl-label {
    font-size: 10px;
    color: var(--text-secondary);
    width: 38px;
    flex-shrink: 0;
  }

  .control-row input[type="range"] {
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

  .control-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .ctrl-value {
    font-size: 10px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 28px;
    text-align: right;
  }

  .control-row select {
    flex: 1;
    min-width: 0;
    font-size: 10px;
    padding: 1px 4px;
  }

  .bg-section {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    position: relative;
  }

  .bg-label {
    font-size: 10px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex: 1;
  }

  .bg-vis {
    flex-shrink: 0;
  }

  .bg-swatch {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
    padding: 0;
    min-width: unset;
    flex-shrink: 0;
  }

  .bg-swatch:hover {
    border-color: var(--accent);
  }

  .panel-footer {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    justify-content: center;
  }

  .panel-footer .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .panel-footer .icon-btn:disabled:hover {
    background: var(--bg-control);
    border-color: var(--border);
  }
</style>
