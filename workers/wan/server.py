#!/usr/bin/env python3
"""Local Wan2.1 text-to-image HTTP worker (no cloud credits)."""

from __future__ import annotations

import argparse
import base64
import io
import logging
import os
from functools import lru_cache
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [wan] %(message)s",
)
logger = logging.getLogger("wan")

DEFAULT_MODEL = os.environ.get(
    "WAN_MODEL_ID",
    "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
)
DEFAULT_WIDTH = int(os.environ.get("WAN_WIDTH", "480"))
DEFAULT_HEIGHT = int(os.environ.get("WAN_HEIGHT", "832"))
DEFAULT_STEPS = int(os.environ.get("WAN_STEPS", "30"))
DEFAULT_GUIDANCE = float(os.environ.get("WAN_GUIDANCE_SCALE", "5.0"))


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    width: int | None = None
    height: int | None = None
    steps: int | None = None
    guidance_scale: float | None = None
    seed: int | None = None
    negative_prompt: str | None = None


class GenerateResponse(BaseModel):
    ok: bool = True
    width: int
    height: int
    model: str
    device: str
    image_base64: str
    mime_type: str = "image/png"


app = FastAPI(title="Wan local image worker", version="0.1.0")


def pick_device() -> str:
    forced = os.environ.get("WAN_DEVICE", "").strip().lower()
    if forced in {"mps", "cpu", "cuda"}:
        return forced
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def pick_dtype(device: str) -> torch.dtype:
    if device == "cpu":
        return torch.float32
    # MPS is more reliable with float16 than bfloat16 for many Diffusers pipelines.
    return torch.float16


@lru_cache(maxsize=1)
def load_pipeline() -> tuple[Any, str, str]:
    from diffusers import AutoencoderKLWan, WanPipeline

    device = pick_device()
    dtype = pick_dtype(device)
    model_id = DEFAULT_MODEL

    logger.info("Loading Wan model %s on %s (%s)", model_id, device, dtype)
    vae = AutoencoderKLWan.from_pretrained(
        model_id,
        subfolder="vae",
        torch_dtype=torch.float32,
    )
    pipe = WanPipeline.from_pretrained(
        model_id,
        vae=vae,
        torch_dtype=dtype,
    )

    # Keep VRAM/unified-memory pressure down on consumer machines.
    try:
        pipe.enable_model_cpu_offload()
        logger.info("Enabled model CPU offload")
    except Exception as exc:  # noqa: BLE001
        logger.warning("CPU offload unavailable (%s); moving whole pipeline", exc)
        pipe.to(device)

    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()

    logger.info("Wan pipeline ready")
    return pipe, device, model_id


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": DEFAULT_MODEL,
        "device": pick_device(),
        "loaded": load_pipeline.cache_info().hits
        + load_pipeline.cache_info().misses
        > 0,
    }


@app.post("/generate", response_model=GenerateResponse)
def generate(body: GenerateRequest) -> GenerateResponse:
    pipe, device, model_id = load_pipeline()

    width = body.width or DEFAULT_WIDTH
    height = body.height or DEFAULT_HEIGHT
    steps = body.steps or DEFAULT_STEPS
    guidance = (
        body.guidance_scale
        if body.guidance_scale is not None
        else DEFAULT_GUIDANCE
    )
    negative = body.negative_prompt or (
        "text, letters, words, numbers, alphabet, writing, caption, subtitle, "
        "title, typography, watermark, logo, brand name, signage, poster, "
        "billboard, label, sticker, UI, HUD, interface, menu, dashboard, "
        "computer screen, monitor display, phone screen, browser, website, "
        "banner, green bar, color bar, lower third, overlay, "
        "blurry, low quality, deformed, cartoon, anime"
    )

    # Wan expects dimensions divisible by 16.
    width = max(16, (width // 16) * 16)
    height = max(16, (height // 16) * 16)

    generator = None
    if body.seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(body.seed)

    logger.info(
        "Generating %sx%s steps=%s guidance=%s prompt=%r",
        width,
        height,
        steps,
        guidance,
        body.prompt[:120],
    )

    try:
        result = pipe(
            prompt=body.prompt,
            negative_prompt=negative,
            height=height,
            width=width,
            num_frames=1,
            num_inference_steps=steps,
            guidance_scale=guidance,
            generator=generator,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Wan generation failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    frames = getattr(result, "frames", None)
    if frames is None:
        raise HTTPException(status_code=500, detail="Wan returned no frames")

    # Diffusers returns [batch][frame] as PIL or np arrays depending on version.
    first = frames[0]
    frame = first[0] if isinstance(first, (list, tuple)) else first

    # Some versions nest another list/array for temporal frames.
    if isinstance(frame, (list, tuple)):
        frame = frame[0]
    elif hasattr(frame, "ndim") and getattr(frame, "ndim", 0) == 4:
        frame = frame[0]

    from PIL import Image
    import numpy as np

    if isinstance(frame, Image.Image):
        image = frame.convert("RGB")
    else:
        array = np.asarray(frame)
        if array.ndim == 4:
            array = array[0]
        if array.dtype != np.uint8:
            max_val = float(np.max(array)) if array.size else 1.0
            if max_val <= 1.0:
                array = (array.clip(0, 1) * 255).astype("uint8")
            else:
                array = array.clip(0, 255).astype("uint8")
        image = Image.fromarray(array).convert("RGB")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")

    return GenerateResponse(
        width=image.width,
        height=image.height,
        model=model_id,
        device=device,
        image_base64=encoded,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Wan image worker")
    parser.add_argument("--host", default=os.environ.get("WAN_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("WAN_PORT", "7860")),
    )
    parser.add_argument(
        "--preload",
        action="store_true",
        help="Load the model at startup instead of on first request",
    )
    args = parser.parse_args()

    if args.preload:
        load_pipeline()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
