#!/usr/bin/env python3
"""
Pictaflux Diffusion Sidecar — WebSocket server wrapping
streamdiffusion-mac's Pipeline for real-time img2img.

Protocol:
  - Binary messages: JPEG image data (client -> server -> client)
  - Text messages: JSON commands
    - {"type": "set_prompt", "prompt": "..."}
    - {"type": "set_feedback", "value": 0.3}
    - {"type": "set_strength", "value": 0.5}
    - {"type": "set_lerp_speed", "value": 0.05}
    - {"type": "set_seed", "value": 42}
    - {"type": "ping"} -> {"type": "pong"}

Lifecycle:
  - Prints "LOADING" to stdout when starting model load
  - Prints "READY:<port>" to stdout when WebSocket server is listening
  - After READY, stdout is redirected to stderr (Rust closes the pipe)
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

# Noise schedule for SDEdit-style img2img strength control.
# Computed once after pipeline init; used by set_strength().
_alphas_cumprod = None
_max_timestep = 0


def _compute_alphas_cumprod():
    """Compute the standard stable diffusion noise schedule.

    This is the same as diffusers' default: scaled_linear beta schedule
    with beta_start=0.00085, beta_end=0.012, 1000 timesteps.
    """
    betas = np.linspace(0.00085 ** 0.5, 0.012 ** 0.5, 1000) ** 2
    alphas = 1.0 - betas
    return np.cumprod(alphas)


def set_strength(strength):
    """Set img2img strength (0 = faithful to input, 1 = max creativity).

    SDEdit approach: adjusts both the noise level and the UNet timestep
    together so the model receives consistent inputs. Higher strength
    means more noise and a higher timestep — more creative, less faithful.
    """
    if pipeline is None or _alphas_cumprod is None:
        return
    strength = max(0.0, min(1.0, float(strength)))
    t = int(strength * _max_timestep)
    t = max(0, min(t, len(_alphas_cumprod) - 1))
    ap = float(_alphas_cumprod[t])
    pipeline._sqrt_a = np.float16(np.sqrt(ap))
    pipeline._sqrt_1ma = np.float16(np.sqrt(1.0 - ap))
    pipeline._t_buf[0] = np.float16(t)


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
    elif t == "set_strength":
        set_strength(float(cmd.get("value", 0.5)))
    elif t == "set_lerp_speed":
        if pipeline is not None:
            pipeline._prompt_lerp_speed = float(cmd.get("value", 0.05))
    elif t == "set_seed":
        if pipeline is not None:
            seed = int(cmd.get("value", 42))
            pipeline._fixed_noise = np.random.RandomState(seed).randn(
                *pipeline._fixed_noise.shape
            ).astype(pipeline._fixed_noise.dtype)
    elif t == "ping":
        await ws.send(json.dumps({"type": "pong"}))


async def main_async(args):
    global pipeline, _alphas_cumprod, _max_timestep

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

    # Compute noise schedule and store the pipeline's original timestep
    _alphas_cumprod = _compute_alphas_cumprod()
    _max_timestep = int(pipeline._t_buf[0])

    # Apply initial strength (SDEdit: adjusts noise level + timestep)
    set_strength(args.strength)

    # Start WebSocket server
    stop = asyncio.Event()

    def signal_handler():
        stop.set()

    loop.add_signal_handler(signal.SIGTERM, signal_handler)
    loop.add_signal_handler(signal.SIGINT, signal_handler)

    async with websockets.serve(handle_client, "127.0.0.1", args.port):
        print(f"READY:{args.port}", flush=True)

        # Redirect stdout to stderr — Rust closes the stdout pipe after
        # reading READY, so any future print() to stdout would crash with
        # BrokenPipeError. Redirect so Pipeline internals are safe.
        sys.stdout = sys.stderr

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
    parser.add_argument("--strength", type=float, default=0.5)
    parser.add_argument("--coreml-dir", type=str, default=None)
    args = parser.parse_args()

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
