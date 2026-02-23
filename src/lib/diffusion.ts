export type DiffusionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface DiffusionBridgeOptions {
  port: number;
  onFrame: (imageUrl: string) => void;
  onStateChange: (state: DiffusionState) => void;
  onFpsUpdate: (fps: number) => void;
  onError: (error: string) => void;
}

export class DiffusionBridge {
  private ws: WebSocket | null = null;
  private options: DiffusionBridgeOptions;
  private running = false;
  private canvasGetter: (() => Promise<Blob | null>) | null = null;
  private lastObjectUrl: string | null = null;
  private frameCount = 0;
  private fpsStartTime = 0;
  private pendingFrame = false;

  constructor(options: DiffusionBridgeOptions) {
    this.options = options;
  }

  connect(): void {
    this.options.onStateChange("connecting");
    const url = `ws://127.0.0.1:${this.options.port}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.options.onStateChange("connected");
      this.running = true;
      this.frameCount = 0;
      this.fpsStartTime = performance.now();
      this.pendingFrame = false;
      this.sendNextFrame();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleResultFrame(event.data);
      }
    };

    this.ws.onclose = () => {
      this.running = false;
      this.options.onStateChange("disconnected");
    };

    this.ws.onerror = () => {
      this.running = false;
      this.options.onStateChange("error");
      this.options.onError("WebSocket connection failed");
    };
  }

  disconnect(): void {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.lastObjectUrl) {
      URL.revokeObjectURL(this.lastObjectUrl);
      this.lastObjectUrl = null;
    }
  }

  setCanvasGetter(getter: () => Promise<Blob | null>): void {
    this.canvasGetter = getter;
  }

  setPrompt(prompt: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "set_prompt", prompt }));
    }
  }

  setFeedback(value: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "set_feedback", value }));
    }
  }

  private async sendNextFrame(): Promise<void> {
    if (!this.running || !this.canvasGetter || this.pendingFrame) return;

    const blob = await this.canvasGetter();
    if (!blob || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const buffer = await blob.arrayBuffer();
    this.pendingFrame = true;
    this.ws.send(buffer);
  }

  private handleResultFrame(data: ArrayBuffer): void {
    this.pendingFrame = false;

    if (this.lastObjectUrl) {
      URL.revokeObjectURL(this.lastObjectUrl);
    }

    const blob = new Blob([data], { type: "image/jpeg" });
    this.lastObjectUrl = URL.createObjectURL(blob);
    this.options.onFrame(this.lastObjectUrl);

    this.frameCount++;
    const elapsed = (performance.now() - this.fpsStartTime) / 1000;
    if (elapsed >= 1.0) {
      this.options.onFpsUpdate(this.frameCount / elapsed);
      this.frameCount = 0;
      this.fpsStartTime = performance.now();
    }

    requestAnimationFrame(() => this.sendNextFrame());
  }
}
