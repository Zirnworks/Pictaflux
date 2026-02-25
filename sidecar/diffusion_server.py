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
    - {"type": "set_cfg_scale", "value": 7.5}
    - {"type": "set_negative_prompt", "prompt": "..."}
    - {"type": "set_num_steps", "value": 4}
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

# Force HuggingFace to use local cache only — models are pre-downloaded
# via convert_models.py. Without this, from_pretrained() stalls trying to
# validate against the hub on unauthenticated connections.
os.environ["HF_HUB_OFFLINE"] = "1"

# Add streamdiffusion-mac to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "streamdiffusion-mac"))
from camera import Pipeline, COREML_DIR

import websockets


pipeline = None

# Noise schedule for SDEdit-style img2img strength control.
# Computed once after pipeline init; used by set_strength().
_alphas_cumprod = None
_max_timestep = 0
_current_strength = 0.5

# CFG and multi-step parameters (runtime, no restart needed).
_cfg_scale = 1.0
_num_steps = 1
_negative_embeds = None  # Encoded from "" at startup; updated via set_negative_prompt


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
    global _current_strength
    if pipeline is None or _alphas_cumprod is None:
        return
    strength = max(0.0, min(1.0, float(strength)))
    _current_strength = strength
    t = int(strength * _max_timestep)
    t = max(0, min(t, len(_alphas_cumprod) - 1))
    ap = float(_alphas_cumprod[t])
    pipeline._sqrt_a = np.float16(np.sqrt(ap))
    pipeline._sqrt_1ma = np.float16(np.sqrt(1.0 - ap))
    pipeline._t_buf[0] = np.float16(t)


def process_frame_advanced(frame_bgr):
    """Process a frame with optional CFG and multi-step denoising.

    Fast path: when CFG <= 1 and steps == 1, delegates to pipeline.process_frame().
    Advanced path: reimplements the processing loop with CFG double-pass and
    DDIM multi-step denoising using the pipeline's CoreML models directly.
    """
    if _cfg_scale <= 1.0 and _num_steps <= 1:
        return pipeline.process_frame(frame_bgr)

    # --- Advanced path ---

    # 1. Preprocess: crop to square + resize + normalize
    h, w = frame_bgr.shape[:2]
    if w > h:
        off = (w - h) // 2
        frame_bgr = frame_bgr[:, off:off + h]
    elif h > w:
        off = (h - w) // 2
        frame_bgr = frame_bgr[off:off + w, :]

    resized = cv2.resize(frame_bgr, (pipeline.render_size, pipeline.render_size))
    rgb = resized[:, :, ::-1]  # BGR to RGB
    img_buf = pipeline._norm_lut[rgb].transpose(2, 0, 1)[np.newaxis].astype(np.float16)

    # 2. Smooth prompt transition (same as pipeline.process_frame)
    diff = pipeline._target_embeds - pipeline._prompt_embeds
    if np.abs(diff).max() > 1e-4:
        pipeline._prompt_embeds = (
            pipeline._prompt_embeds + pipeline._prompt_lerp_speed * diff
        )

    # 3. VAE Encode
    enc = pipeline.vae_encoder.predict({"image": img_buf})
    clean = np.array(enc["latent"]).astype(np.float16)

    # 4. Latent feedback from previous frame
    if pipeline._prev_denoised is not None and pipeline.latent_feedback > 0:
        fb = np.float16(pipeline.latent_feedback)
        clean = (1.0 - fb) * clean + fb * pipeline._prev_denoised

    # 5. Add noise at start timestep
    t_start = int(_current_strength * _max_timestep)
    t_start = max(0, min(t_start, len(_alphas_cumprod) - 1))
    ap_start = float(_alphas_cumprod[t_start])
    sqrt_a_start = np.float16(np.sqrt(ap_start))
    sqrt_1ma_start = np.float16(np.sqrt(1.0 - ap_start))
    x = sqrt_a_start * clean + sqrt_1ma_start * pipeline._fixed_noise

    # 6. Build DDIM timestep schedule: [t_start, ..., 0]
    if _num_steps <= 1:
        timesteps = [t_start]
        next_ts = [0]
    else:
        schedule = np.linspace(t_start, 0, _num_steps + 1).astype(int)
        timesteps = schedule[:-1].tolist()
        next_ts = schedule[1:].tolist()

    # 7. DDIM denoising loop with optional CFG
    t_buf = np.empty((1,), dtype=np.float16)
    neg_embeds = _negative_embeds
    pos_embeds = pipeline._prompt_embeds

    for t, t_next in zip(timesteps, next_ts):
        t_buf[0] = np.float16(t)

        # UNet forward pass (conditional)
        u_cond = pipeline.unet.predict({
            "sample": x, "timestep": t_buf,
            "encoder_hidden_states": pos_embeds,
        })
        npred = np.array(u_cond["noise_pred"]).astype(np.float16)

        # CFG: second UNet pass with negative/unconditional embeddings
        if _cfg_scale > 1.0 and neg_embeds is not None:
            u_uncond = pipeline.unet.predict({
                "sample": x, "timestep": t_buf,
                "encoder_hidden_states": neg_embeds,
            })
            npred_uncond = np.array(u_uncond["noise_pred"]).astype(np.float16)
            npred = npred_uncond + np.float16(_cfg_scale) * (npred - npred_uncond)

        # DDIM step
        alpha_t = float(_alphas_cumprod[max(t, 0)])
        alpha_next = float(_alphas_cumprod[t_next]) if t_next > 0 else 1.0
        sqrt_at = np.float16(np.sqrt(alpha_t))
        sqrt_1mat = np.float16(np.sqrt(1.0 - alpha_t))
        sqrt_an = np.float16(np.sqrt(alpha_next))
        sqrt_1man = np.float16(np.sqrt(1.0 - alpha_next))

        pred_x0 = (x - sqrt_1mat * npred) / sqrt_at
        x = sqrt_an * pred_x0 + sqrt_1man * npred

    # 8. Store for latent feedback
    pipeline._prev_denoised = x.copy()

    # 9. VAE Decode
    dec = pipeline.vae_decoder.predict({"latent": x})
    r = np.array(dec["image"]).astype(np.float32).squeeze(0).transpose(1, 2, 0)
    r = ((r + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
    if r.shape[0] != pipeline.output_size:
        r = cv2.resize(r, (pipeline.output_size, pipeline.output_size))
    return cv2.cvtColor(r, cv2.COLOR_RGB2BGR)


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
                result_bgr = process_frame_advanced(frame_bgr)
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
    global pipeline, _cfg_scale, _num_steps, _negative_embeds
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
    elif t == "set_cfg_scale":
        _cfg_scale = max(1.0, float(cmd.get("value", 1.0)))
    elif t == "set_negative_prompt":
        if pipeline is not None:
            prompt = cmd.get("prompt", "")
            _negative_embeds = pipeline._encode_single(prompt)
    elif t == "set_num_steps":
        _num_steps = max(1, min(8, int(cmd.get("value", 1))))
    elif t == "ping":
        await ws.send(json.dumps({"type": "pong"}))


async def main_async(args):
    global pipeline, _alphas_cumprod, _max_timestep, _negative_embeds

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

    # Compute noise schedule. Use the full 1000-step range (0–999) regardless
    # of what the pipeline's scheduler was initialized with. SDXS uses Euler
    # with t≈999; SD Turbo uses DDPM with t≈499. Both CoreML UNets were traced
    # at timestep 999 and handle any value in the range.
    _alphas_cumprod = _compute_alphas_cumprod()
    _max_timestep = len(_alphas_cumprod) - 1

    # Apply initial strength (SDEdit: adjusts noise level + timestep)
    set_strength(args.strength)

    # Encode empty string as default unconditional embedding for CFG
    _negative_embeds = pipeline._encode_single("")
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
