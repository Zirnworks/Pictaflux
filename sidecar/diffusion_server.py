#!/usr/bin/env python3
"""
Pictaflux Diffusion Sidecar — WebSocket server wrapping
streamdiffusion-mac's Pipeline for real-time img2img.

Protocol:
  - Binary messages: JPEG image data (client -> server -> client)
  - Text messages: JSON commands
    - {"type": "set_prompt", "prompt": "..."}
    - {"type": "set_feedback", "value": 0.3}
    - {"type": "ping"} -> {"type": "pong"}

Lifecycle:
  - Prints "LOADING" to stdout when starting model load
  - Prints "READY:<port>" to stdout when WebSocket server is listening
  - Shuts down on SIGTERM, SIGINT, or all clients disconnect
"""
import asyncio
import signal
import sys
import os
import json
import argparse
import numpy as np
import cv2

# Add streamdiffusion-mac to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "streamdiffusion-mac"))
from camera import Pipeline, COREML_DIR

import websockets


pipeline = None


async def handle_client(websocket):
    """Handle a single WebSocket client connection."""
    global pipeline
    if pipeline is None:
        await websocket.close(1011, "Pipeline not initialized")
        return

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                # Binary: JPEG image data
                arr = np.frombuffer(message, dtype=np.uint8)
                frame_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if frame_bgr is None:
                    continue
                result_bgr = pipeline.process_frame(frame_bgr)
                _, jpeg = cv2.imencode(
                    ".jpg", result_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90]
                )
                await websocket.send(jpeg.tobytes())
            elif isinstance(message, str):
                # Text: JSON command
                try:
                    cmd = json.loads(message)
                    await handle_command(websocket, cmd)
                except json.JSONDecodeError:
                    pass
    except websockets.exceptions.ConnectionClosed:
        pass


async def handle_command(ws, cmd):
    """Handle a JSON command from the client."""
    global pipeline
    t = cmd.get("type")
    if t == "set_prompt":
        prompt = cmd.get("prompt", "")
        if prompt and pipeline is not None:
            new_embed = pipeline._encode_single(prompt)
            pipeline._target_embeds = new_embed
            pipeline._current_prompt = prompt
            await ws.send(json.dumps({"type": "prompt_set", "prompt": prompt}))
    elif t == "set_feedback":
        if pipeline is not None:
            pipeline.latent_feedback = float(cmd.get("value", 0.1))
    elif t == "ping":
        await ws.send(json.dumps({"type": "pong"}))


async def main_async(args):
    global pipeline

    print("LOADING", flush=True)

    # Load pipeline (blocking — runs in executor to not block the event loop)
    loop = asyncio.get_event_loop()
    coreml_dir = args.coreml_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "streamdiffusion-mac",
        "coreml_models",
    )
    pipeline = await loop.run_in_executor(
        None,
        lambda: Pipeline(
            model_name=args.model,
            render_size=args.render_size,
            output_size=args.render_size,
            prompt=args.prompt,
            latent_feedback=args.feedback,
            coreml_dir=coreml_dir,
        ),
    )

    # Start WebSocket server
    stop = asyncio.Event()

    def signal_handler():
        stop.set()

    loop.add_signal_handler(signal.SIGTERM, signal_handler)
    loop.add_signal_handler(signal.SIGINT, signal_handler)

    async with websockets.serve(handle_client, "127.0.0.1", args.port):
        print(f"READY:{args.port}", flush=True)
        await stop.wait()


def main():
    parser = argparse.ArgumentParser(description="Pictaflux Diffusion Sidecar")
    parser.add_argument("--port", type=int, default=9824)
    parser.add_argument(
        "--prompt",
        type=str,
        default="oil painting style, masterpiece, highly detailed",
    )
    parser.add_argument("--model", type=str, default="sdxs")
    parser.add_argument("--render-size", type=int, default=512)
    parser.add_argument("--feedback", type=float, default=0.1)
    parser.add_argument("--coreml-dir", type=str, default=None)
    args = parser.parse_args()

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
