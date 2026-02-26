<script lang="ts">
  import { onMount } from "svelte";

  let {
    color = $bindable("#1e1e1e"),
    onclose,
  }: {
    color: string;
    onclose?: () => void;
  } = $props();

  const SIZE = 200;
  const RING_OUTER = SIZE / 2;
  const RING_WIDTH = 20;
  const RING_INNER = RING_OUTER - RING_WIDTH;
  const SQ_MARGIN = 8;
  const SQ_HALF = Math.floor((RING_INNER - SQ_MARGIN) / Math.SQRT2);
  const SQ_SIZE = SQ_HALF * 2;
  const SQ_X = (SIZE - SQ_SIZE) / 2;
  const SQ_Y = (SIZE - SQ_SIZE) / 2;

  let wheelCanvas: HTMLCanvasElement;
  let svCanvas: HTMLCanvasElement;
  let popoverEl: HTMLElement;

  let hue = $state(0);
  let sat = $state(0);
  let val = $state(0.12);
  let hexInput = $state("#1e1e1e");
  let dragging: "ring" | "square" | null = $state(null);

  // ── HSV ↔ RGB ↔ Hex ──

  function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    return [h, s, max];
  }

  function hexToRgb(hex: string): [number, number, number] | null {
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r: number, g: number, b: number): string {
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  function updateFromHsv() {
    const [r, g, b] = hsvToRgb(hue, sat, val);
    const hex = rgbToHex(r, g, b);
    hexInput = hex;
    color = hex;
  }

  function setFromHex(hex: string) {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const [h, s, v] = rgbToHsv(...rgb);
    hue = h;
    sat = s;
    val = v;
    hexInput = hex.startsWith("#") ? hex.toLowerCase() : `#${hex.toLowerCase()}`;
    color = hexInput;
    drawSvSquare();
  }

  // ── Canvas Drawing ──

  function drawHueRing() {
    const ctx = wheelCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    for (let deg = 0; deg < 360; deg++) {
      const startAngle = ((deg - 1) * Math.PI) / 180;
      const endAngle = ((deg + 1) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(cx, cy, RING_OUTER - 1, startAngle, endAngle);
      ctx.arc(cx, cy, RING_INNER, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${deg}, 100%, 50%)`;
      ctx.fill();
    }

    // Draw hue indicator
    const angle = (hue * Math.PI) / 180;
    const indicatorR = RING_INNER + RING_WIDTH / 2;
    const ix = cx + Math.cos(angle) * indicatorR;
    const iy = cy + Math.sin(angle) * indicatorR;
    ctx.beginPath();
    ctx.arc(ix, iy, RING_WIDTH / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawSvSquare() {
    const ctx = svCanvas.getContext("2d")!;
    const imgData = ctx.createImageData(SQ_SIZE, SQ_SIZE);
    const data = imgData.data;

    for (let y = 0; y < SQ_SIZE; y++) {
      for (let x = 0; x < SQ_SIZE; x++) {
        const s = x / (SQ_SIZE - 1);
        const v = 1 - y / (SQ_SIZE - 1);
        const [r, g, b] = hsvToRgb(hue, s, v);
        const i = (y * SQ_SIZE + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw SV indicator
    const sx = sat * (SQ_SIZE - 1);
    const sy = (1 - val) * (SQ_SIZE - 1);
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = val > 0.5 ? "#000" : "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function redraw() {
    drawHueRing();
    drawSvSquare();
  }

  // ── Interaction ──

  function getWheelPos(e: PointerEvent): { x: number; y: number } {
    const rect = wheelCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function isInRing(x: number, y: number): boolean {
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    return dist >= RING_INNER && dist <= RING_OUTER;
  }

  function isInSquare(x: number, y: number): boolean {
    return x >= SQ_X && x <= SQ_X + SQ_SIZE && y >= SQ_Y && y <= SQ_Y + SQ_SIZE;
  }

  function handleRing(x: number, y: number) {
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    let angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    hue = angle;
    updateFromHsv();
    redraw();
  }

  function handleSquare(x: number, y: number) {
    const sx = Math.max(0, Math.min(SQ_SIZE - 1, x - SQ_X));
    const sy = Math.max(0, Math.min(SQ_SIZE - 1, y - SQ_Y));
    sat = sx / (SQ_SIZE - 1);
    val = 1 - sy / (SQ_SIZE - 1);
    updateFromHsv();
    redraw();
  }

  function onWheelPointerDown(e: PointerEvent) {
    const pos = getWheelPos(e);
    if (isInRing(pos.x, pos.y)) {
      dragging = "ring";
      wheelCanvas.setPointerCapture(e.pointerId);
      handleRing(pos.x, pos.y);
    } else if (isInSquare(pos.x, pos.y)) {
      dragging = "square";
      wheelCanvas.setPointerCapture(e.pointerId);
      handleSquare(pos.x, pos.y);
    }
  }

  function onWheelPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const pos = getWheelPos(e);
    if (dragging === "ring") handleRing(pos.x, pos.y);
    else handleSquare(pos.x, pos.y);
  }

  function onWheelPointerUp() {
    dragging = null;
  }

  function onHexInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    hexInput = value;
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      setFromHex(value);
    }
  }

  function onHexKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      if (/^#[0-9a-f]{6}$/i.test(hexInput)) {
        setFromHex(hexInput);
      }
    }
  }

  function onClickOutside(e: MouseEvent) {
    if (popoverEl && !popoverEl.contains(e.target as Node)) {
      onclose?.();
    }
  }

  onMount(() => {
    setFromHex(color);
    redraw();
    document.addEventListener("pointerdown", onClickOutside, true);
    return () => document.removeEventListener("pointerdown", onClickOutside, true);
  });
</script>

<div class="color-wheel-popover" bind:this={popoverEl}>
  <div class="wheel-container">
    <canvas
      bind:this={wheelCanvas}
      width={SIZE}
      height={SIZE}
      onpointerdown={onWheelPointerDown}
      onpointermove={onWheelPointerMove}
      onpointerup={onWheelPointerUp}
    ></canvas>
    <canvas
      bind:this={svCanvas}
      class="sv-canvas"
      width={SQ_SIZE}
      height={SQ_SIZE}
      style="left: {SQ_X}px; top: {SQ_Y}px"
    ></canvas>
  </div>
  <div class="color-info">
    <div class="preview" style="background: {color}"></div>
    <input
      class="hex-input"
      type="text"
      value={hexInput}
      oninput={onHexInput}
      onkeydown={onHexKeydown}
      maxlength="7"
      spellcheck="false"
    />
  </div>
</div>

<style>
  .color-wheel-popover {
    position: absolute;
    left: 144px;
    bottom: 4px;
    z-index: 100;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .wheel-container {
    position: relative;
    width: 200px;
    height: 200px;
  }

  .wheel-container canvas {
    position: absolute;
    top: 0;
    left: 0;
    cursor: crosshair;
  }

  .sv-canvas {
    pointer-events: none;
  }

  .color-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  .preview {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    border: 1px solid var(--border);
    flex-shrink: 0;
  }

  .hex-input {
    flex: 1;
    background: var(--bg-control);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: monospace;
    outline: none;
  }

  .hex-input:focus {
    border-color: var(--accent);
  }
</style>
