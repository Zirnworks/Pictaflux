<script lang="ts">
  import { onDestroy } from "svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import SplitPane from "./lib/components/SplitPane.svelte";
  import DrawingCanvas from "./lib/components/DrawingCanvas.svelte";
  import PreviewPane from "./lib/components/PreviewPane.svelte";
  import { DiffusionBridge } from "./lib/diffusion";
  import { startSidecar, stopSidecar } from "./lib/tauri";

  let brushSize = $state(8);
  let brushColor = $state("#ffffff");
  let brushOpacity = $state(1.0);
  let prompt = $state("oil painting style, masterpiece, highly detailed");
  let strength = $state(0.5);

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
        const result = await startSidecar(SIDECAR_PORT, prompt, 0.1, strength);
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
        if (state === "connected") diffusionState = "connected";
        else if (state === "disconnected" && diffusionState !== "loading")
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
  $effect(() => {
    bridge?.setStrength(strength);
  });

  onDestroy(() => {
    bridge?.disconnect();
  });
</script>

<div class="app-root">
  <Toolbar
    bind:brushSize
    bind:brushColor
    bind:brushOpacity
    bind:prompt
    bind:strength
    onclear={handleClear}
    {diffusionState}
    onToggleDiffusion={handleToggleDiffusion}
  />
  <div class="app-layout">
    <SplitPane>
      {#snippet left()}
        <DrawingCanvas
          bind:this={drawingCanvas}
          {brushSize}
          bind:brushColor
          {brushOpacity}
        />
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
  }

  .app-layout {
    display: flex;
    width: 100%;
    flex: 1;
    min-height: 0;
  }
</style>
