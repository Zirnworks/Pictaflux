<script lang="ts">
  import { onDestroy, untrack } from "svelte";
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
  let feedback = $state(0.1);
  let lerpSpeed = $state(0.05);
  let seed = $state(42);
  let model = $state("sdxs");
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
