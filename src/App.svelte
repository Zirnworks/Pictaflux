<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import SplitPane from "./lib/components/SplitPane.svelte";
  import DrawingCanvas from "./lib/components/DrawingCanvas.svelte";
  import LayerPanel from "./lib/components/LayerPanel.svelte";
  import BrushLibrary from "./lib/components/BrushLibrary.svelte";
  import BrushSettings from "./lib/components/BrushSettings.svelte";
  import PreviewPane from "./lib/components/PreviewPane.svelte";
  import { LayerManager } from "./lib/layers.svelte";
  import type { BrushPreset } from "./lib/types";
  import {
    BrushEngine,
    createDefaultRoundBrush,
    createDefaultPreset,
  } from "./lib/brush-engine";
  import { DiffusionBridge } from "./lib/diffusion";
  import { startSidecar, stopSidecar } from "./lib/tauri";
  import { buildPsd } from "./lib/psd-export";
  import { save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { Menu, Submenu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

  const layerManager = new LayerManager();

  // Brush engine (async init — needs createImageBitmap)
  let brushEngine: BrushEngine | null = $state(null);
  let brushPresets: BrushPreset[] = $state([]);
  let activePresetId = $state("");

  async function initBrushEngine() {
    const defaultTip = await createDefaultRoundBrush();
    const defaultPreset = createDefaultPreset(defaultTip);
    brushPresets = [defaultPreset];
    activePresetId = defaultPreset.id;
    brushEngine = new BrushEngine(defaultPreset);
  }
  initBrushEngine();

  function handleBrushSelect(preset: BrushPreset) {
    brushEngine?.setPreset(preset);
    showBrushSettings = false;
  }

  // Derive active brush name for toolbar
  let activeBrushName = $derived(
    brushPresets.find((p) => p.id === activePresetId)?.name ?? "Soft Round",
  );

  let showBrushSettings = $state(false);

  let brushSettingsClosedAt = 0;

  function handleToggleBrushSettings() {
    // Prevent re-opening if just closed by click-outside (within same event loop)
    if (!showBrushSettings && Date.now() - brushSettingsClosedAt < 100) return;
    showBrushSettings = !showBrushSettings;
  }

  function handleCloseBrushSettings() {
    showBrushSettings = false;
    brushSettingsClosedAt = Date.now();
  }

  // When brush settings modal mutates the preset, sync to engine + presets array
  function handlePresetChanged(updated: BrushPreset) {
    const idx = brushPresets.findIndex((p) => p.id === updated.id);
    if (idx >= 0) {
      brushPresets[idx] = updated;
      brushPresets = [...brushPresets];
    }
    brushEngine?.setPreset(updated);
  }

  let brushSize = $state(8);
  let brushColor = $state("#ffffff");
  let brushOpacity = $state(1.0);
  let prompt = $state("oil painting style, masterpiece, highly detailed");
  let strength = $state(0.5);
  let feedback = $state(0.1);
  let lerpSpeed = $state(0.05);
  let seed = $state(42);
  let model = $state("turbo");
  let renderSize = $state(512);
  let cfgScale = $state(1.0);
  let negativePrompt = $state("");
  let numSteps = $state(1);

  let drawingCanvas: DrawingCanvas;
  let previewPane: PreviewPane;

  type AppDiffusionState =
    | "disconnected"
    | "connecting"
    | "loading"
    | "connected"
    | "error";
  let diffusionState: AppDiffusionState = $state("disconnected");
  let bridge: DiffusionBridge | null = null;

  const SIDECAR_PORT = 9824;

  function handleClear() {
    drawingCanvas?.clear();
  }

  async function handleToggleDiffusion() {
    if (diffusionState === "connected") {
      bridge?.disconnect();
      bridge = null;
      try {
        await stopSidecar();
      } catch (e) {
        console.error("Stop error:", e);
      }
      diffusionState = "disconnected";
      previewPane?.clear();
    } else if (diffusionState === "disconnected" || diffusionState === "error") {
      diffusionState = "loading";
      try {
        // Best-effort stop: clears stale Rust state (e.g. after HMR reload)
        try { await stopSidecar(); } catch {}
        const result = await startSidecar(
          SIDECAR_PORT, prompt, feedback, strength, model, renderSize,
        );
        connectBridge(result.port);
      } catch (e) {
        console.error("Start error:", e);
        diffusionState = "error";
      }
    }
  }

  function connectBridge(port: number) {
    diffusionState = "connecting";
    bridge = new DiffusionBridge({
      port,
      onFrame: (url) => previewPane?.setImage(url),
      onStateChange: (state) => {
        if (state === "connected") {
          diffusionState = "connected";
          // Sync runtime params not passed via CLI
          bridge?.setLerpSpeed(lerpSpeed);
          bridge?.setSeed(seed);
          bridge?.setCfgScale(cfgScale);
          bridge?.setNegativePrompt(negativePrompt);
          bridge?.setNumSteps(numSteps);
        } else if (state === "disconnected" && diffusionState !== "loading")
          diffusionState = "disconnected";
        else if (state === "error") diffusionState = "error";
      },
      onFpsUpdate: (fps) => previewPane?.setFps(fps),
      onError: (err) => console.error("Bridge error:", err),
    });

    bridge.setCanvasGetter(
      () => drawingCanvas?.toBlob(0.80, 512) ?? Promise.resolve(null),
    );
    bridge.connect();
  }

  let _restarting = false;
  async function restartSidecar() {
    if (_restarting) return;
    _restarting = true;
    bridge?.disconnect();
    bridge = null;
    try {
      await stopSidecar();
    } catch (e) {
      console.error("Stop error:", e);
    }
    await new Promise((r) => setTimeout(r, 100));
    diffusionState = "loading";
    try {
      const result = await startSidecar(
        SIDECAR_PORT, prompt, feedback, strength, model, renderSize,
      );
      connectBridge(result.port);
    } catch (e) {
      console.error("Restart error:", e);
      diffusionState = "error";
    } finally {
      _restarting = false;
    }
  }

  // Debounced prompt sync to pipeline
  let promptTimeout: ReturnType<typeof setTimeout>;
  $effect(() => {
    const currentPrompt = prompt;
    clearTimeout(promptTimeout);
    promptTimeout = setTimeout(() => {
      bridge?.setPrompt(currentPrompt);
    }, 300);
  });

  // Immediate strength sync to pipeline
  // NOTE: read value before optional chain — if bridge is null on first run,
  // ?. short-circuits and Svelte 5 never registers the $state as a dependency.
  $effect(() => {
    const s = strength;
    bridge?.setStrength(s);
  });

  // Immediate feedback sync
  $effect(() => {
    const f = feedback;
    bridge?.setFeedback(f);
  });

  // Immediate lerp speed sync
  $effect(() => {
    const l = lerpSpeed;
    bridge?.setLerpSpeed(l);
  });

  // Immediate seed sync
  $effect(() => {
    const s = seed;
    bridge?.setSeed(s);
  });

  // Immediate CFG scale sync
  $effect(() => {
    const c = cfgScale;
    bridge?.setCfgScale(c);
  });

  // Debounced negative prompt sync
  let negPromptTimeout: ReturnType<typeof setTimeout>;
  $effect(() => {
    const currentNeg = negativePrompt;
    clearTimeout(negPromptTimeout);
    negPromptTimeout = setTimeout(() => {
      bridge?.setNegativePrompt(currentNeg);
    }, 300);
  });

  // Immediate num steps sync
  $effect(() => {
    const n = numSteps;
    bridge?.setNumSteps(n);
  });

  // Auto-restart sidecar when model or renderSize changes while running.
  // Uses untrack() for diffusionState so this effect only re-runs when
  // model or renderSize actually change — not when diffusionState cycles
  // through disconnected→loading→connecting→connected during a restart.
  let prevModel: string;
  let prevRenderSize: number;
  $effect(() => {
    const m = model;
    const rs = renderSize;
    if (prevModel !== undefined && prevRenderSize !== undefined) {
      if ((m !== prevModel || rs !== prevRenderSize) && untrack(() => diffusionState) === "connected") {
        restartSidecar();
      }
    }
    prevModel = m;
    prevRenderSize = rs;
  });

  // --- Save / Save As ---
  let currentSavePath: string | null = $state(null);

  async function handleSaveAs() {
    const path = await save({
      defaultPath: "untitled.psd",
      filters: [{ name: "Photoshop", extensions: ["psd"] }],
    });
    if (!path) return;
    currentSavePath = path;
    await writePsdToFile(path);
  }

  async function handleSave() {
    if (currentSavePath) {
      await writePsdToFile(currentSavePath);
    } else {
      await handleSaveAs();
    }
  }

  async function writePsdToFile(path: string) {
    try {
      const data = buildPsd(layerManager);
      await invoke("save_bytes_to_file", { path, data: Array.from(data) });
      console.log(`[Save] Written ${(data.byteLength / 1024).toFixed(0)} KB → ${path}`);
    } catch (e) {
      console.error("[Save] Failed:", e);
    }
  }

  // Bracket keys resize brush (Photoshop-style)
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "]") {
      brushSize = Math.min(500, brushSize + (brushSize < 10 ? 1 : brushSize < 50 ? 5 : 10));
    } else if (e.key === "[") {
      brushSize = Math.max(1, brushSize - (brushSize <= 10 ? 1 : brushSize <= 50 ? 5 : 10));
    } else if (e.key === "Backspace" && e.altKey) {
      e.preventDefault();
      drawingCanvas?.fill(brushColor);
    } else if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      drawingCanvas?.undo();
    } else if (
      ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") ||
      ((e.metaKey || e.ctrlKey) && e.key === "y")
    ) {
      e.preventDefault();
      drawingCanvas?.redo();
    }
  }

  // --- Native menu bar ---
  onMount(async () => {
    const appMenu = await Submenu.new({
      text: "Pictaflux",
      items: [
        await PredefinedMenuItem.new({ item: { About: { name: "Pictaflux" } } }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Services" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Hide" }),
        await PredefinedMenuItem.new({ item: "HideOthers" }),
        await PredefinedMenuItem.new({ item: "ShowAll" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Quit" }),
      ],
    });

    const fileMenu = await Submenu.new({
      text: "File",
      items: [
        await MenuItem.new({
          text: "Save",
          accelerator: "CmdOrCtrl+S",
          action: () => handleSave(),
        }),
        await MenuItem.new({
          text: "Save As...",
          accelerator: "CmdOrCtrl+Shift+S",
          action: () => handleSaveAs(),
        }),
      ],
    });

    const editMenu = await Submenu.new({
      text: "Edit",
      items: [
        await PredefinedMenuItem.new({ item: "Undo" }),
        await PredefinedMenuItem.new({ item: "Redo" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Cut" }),
        await PredefinedMenuItem.new({ item: "Copy" }),
        await PredefinedMenuItem.new({ item: "Paste" }),
        await PredefinedMenuItem.new({ item: "SelectAll" }),
      ],
    });

    const windowMenu = await Submenu.new({
      text: "Window",
      items: [
        await PredefinedMenuItem.new({ item: "Minimize" }),
        await PredefinedMenuItem.new({ item: "Maximize" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "CloseWindow" }),
      ],
    });

    const menu = await Menu.new({
      items: [appMenu, fileMenu, editMenu, windowMenu],
    });
    await menu.setAsAppMenu();
  });

  onDestroy(() => {
    bridge?.disconnect();
    layerManager.dispose();
  });
</script>

<svelte:window onkeydown={handleKeyDown} />
<div class="app-root">
  <Toolbar
    bind:brushSize
    bind:brushColor
    bind:brushOpacity
    bind:prompt
    bind:strength
    bind:feedback
    bind:lerpSpeed
    bind:seed
    bind:model
    bind:renderSize
    bind:cfgScale
    bind:negativePrompt
    bind:numSteps
    onclear={handleClear}
    {diffusionState}
    onToggleDiffusion={handleToggleDiffusion}
    {activeBrushName}
    onToggleBrushSettings={handleToggleBrushSettings}
  />
  {#if showBrushSettings}
    {@const activePreset = brushPresets.find((p) => p.id === activePresetId)}
    {#if activePreset}
      <div class="brush-settings-anchor">
        <BrushSettings
          preset={activePreset}
          onchange={handlePresetChanged}
          onclose={handleCloseBrushSettings}
        />
      </div>
    {/if}
  {/if}
  <div class="app-layout">
    <SplitPane>
      {#snippet left()}
        <div class="drawing-area">
          <div class="side-panel">
            <BrushLibrary
              bind:presets={brushPresets}
              bind:activePresetId
              onselect={handleBrushSelect}
            />
            <LayerPanel {layerManager} />
          </div>
          {#if brushEngine}
            <DrawingCanvas
              bind:this={drawingCanvas}
              {brushSize}
              bind:brushColor
              {brushOpacity}
              {brushEngine}
              {layerManager}
            />
          {/if}
        </div>
      {/snippet}
      {#snippet right()}
        <PreviewPane bind:this={previewPane} />
      {/snippet}
    </SplitPane>
  </div>
</div>

<style>
  .app-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    position: relative;
  }

  .app-layout {
    display: flex;
    width: 100%;
    flex: 1;
    min-height: 0;
  }

  .drawing-area {
    display: flex;
    width: 100%;
    height: 100%;
  }

  .brush-settings-anchor {
    position: absolute;
    top: 84px;
    left: 12px;
    z-index: 200;
  }

  .side-panel {
    display: flex;
    flex-direction: column;
    width: 140px;
    min-width: 140px;
    height: 100%;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    overflow: hidden;
  }
</style>
