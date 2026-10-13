#!/usr/bin/env python3
"""Local XTTS v2 voice-clone HTTP worker + Whisper word alignment."""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import re
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [tts] %(message)s",
)
logger = logging.getLogger("tts")

# Required to load XTTS v2 weights without an interactive CPML prompt.
os.environ.setdefault("COQUI_TOS_AGREED", "1")

WORKER_DIR = Path(__file__).resolve().parent
VOICES_DIR = WORKER_DIR / "voices"
KOKORO_DIR = WORKER_DIR / "models" / "kokoro"
KOKORO_ONNX = KOKORO_DIR / "kokoro-v1.0.onnx"
KOKORO_VOICES = KOKORO_DIR / "voices-v1.0.bin"
XTTS_MODEL = os.environ.get(
    "TTS_MODEL_ID",
    "tts_models/multilingual/multi-dataset/xtts_v2",
)
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
DEFAULT_VOICE = os.environ.get("TTS_VOICE", "everton")
DEFAULT_LANGUAGE = os.environ.get("TTS_LANGUAGE", "en")
DEFAULT_SPEED = float(os.environ.get("TTS_SPEED", "1.0"))
MAX_PACK_REFS = int(os.environ.get("TTS_PACK_MAX_REFS", "10"))
# Lower temperature → fewer invented / swapped words.
XTTS_TEMPERATURE = float(os.environ.get("XTTS_TEMPERATURE", "0.55"))
XTTS_TOP_P = float(os.environ.get("XTTS_TOP_P", "0.85"))
XTTS_REPETITION_PENALTY = float(os.environ.get("XTTS_REPETITION_PENALTY", "5.0"))
# Male US Kokoro voice — closest free local stand-in for Edge GuyNeural.
KOKORO_VOICE = os.environ.get("KOKORO_VOICE", "am_michael")
KOKORO_SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))
KOKORO_LANG = os.environ.get("KOKORO_LANG", "en-us")

WORD_RE = re.compile(r"[a-z0-9']+")


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    language: str | None = None
    speaker_wav: str | None = None
    speed: float | None = None


class KokoroSynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str | None = None
    speed: float | None = None
    language: str | None = None


class WordTimestamp(BaseModel):
    word: str
    startMs: int
    endMs: int


class SynthesizeResponse(BaseModel):
    ok: bool = True
    model: str
    device: str
    voice: str
    pack_used: int = 1
    durationMs: int
    words: list[WordTimestamp]
    audio_base64: str
    mime_type: str = "audio/mpeg"
    engine: str = "xtts"


app = FastAPI(title="Local XTTS voice-clone worker", version="0.1.0")


def pick_device() -> str:
    forced = os.environ.get("TTS_DEVICE", "").strip().lower()
    if forced in {"cpu", "cuda", "mps"}:
        return forced
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:  # noqa: BLE001
        pass
    # XTTS on Apple MPS is unreliable; CPU coexists with the Wan MPS worker.
    return "cpu"


def tokenize_script(text: str) -> list[str]:
    return [part for part in re.sub(r"\s+", " ", text).strip().split(" ") if part]


def normalize_word(word: str) -> str:
    return "".join(WORD_RE.findall(word.lower()))


def voice_pack_dir(stem: str) -> Path:
    return VOICES_DIR / stem / "pack"


def load_approved_paths(stem: str) -> list[Path]:
    """Prefer approved.json usedPaths; else all numbered pack WAVs."""
    pack = voice_pack_dir(stem)
    approved_file = pack / "approved.json"
    repo_root = WORKER_DIR.parent.parent

    if approved_file.is_file():
        try:
            data = json.loads(approved_file.read_text(encoding="utf-8"))
            paths: list[Path] = []
            for rel in data.get("usedPaths") or []:
                path = Path(rel)
                if not path.is_absolute():
                    path = repo_root / rel
                if path.is_file() and path.suffix.lower() == ".wav":
                    paths.append(path)
            if paths:
                return paths[:MAX_PACK_REFS]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not read approved.json (%s)", exc)

    if pack.is_dir():
        numbered = sorted(pack.glob("[0-9][0-9].wav")) + sorted(
            pack.glob("L[0-9][0-9].wav")
        )
        paths = [p for p in numbered if p.is_file() and p.stat().st_size > 1000]
        if paths:
            return paths[:MAX_PACK_REFS]
    return []


def resolve_speaker(name: str) -> tuple[str, list[Path]]:
    raw = (name or DEFAULT_VOICE).strip()
    if not raw or "/" in raw or "\\" in raw or raw in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid speaker_wav name")

    stem = Path(raw).stem
    pack_paths = load_approved_paths(stem)
    if pack_paths:
        return stem, pack_paths

    legacy = VOICES_DIR / f"{stem}.wav"
    if legacy.is_file():
        return stem, [legacy]

    raise HTTPException(
        status_code=400,
        detail=(
            f"Missing voice pack or sample for '{stem}'. "
            "Record with: yarn tts:record-pack && yarn tts:pack-qa"
        ),
    )

@lru_cache(maxsize=1)
def load_tts() -> tuple[Any, str]:
    from TTS.api import TTS

    device = pick_device()
    logger.info("Loading XTTS model %s on %s", XTTS_MODEL, device)
    tts = TTS(XTTS_MODEL, progress_bar=False)
    try:
        tts = tts.to(device)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not move XTTS to %s (%s); using default device", device, exc)
        device = "cpu"
    logger.info("XTTS ready")
    return tts, device


@lru_cache(maxsize=1)
def load_whisper() -> Any:
    from faster_whisper import WhisperModel

    logger.info("Loading faster-whisper %s on cpu", WHISPER_MODEL)
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    logger.info("Whisper ready")
    return model


def kokoro_ready() -> bool:
    return KOKORO_ONNX.is_file() and KOKORO_VOICES.is_file()


@lru_cache(maxsize=1)
def load_kokoro() -> Any:
    if not kokoro_ready():
        raise FileNotFoundError(
            f"Kokoro models missing under {KOKORO_DIR} "
            "(need kokoro-v1.0.onnx + voices-v1.0.bin). Run yarn tts:kokoro:setup"
        )
    from kokoro_onnx import Kokoro

    logger.info("Loading Kokoro ONNX from %s", KOKORO_DIR)
    model = Kokoro(str(KOKORO_ONNX), str(KOKORO_VOICES))
    logger.info("Kokoro ready (%s voices)", len(model.voices))
    return model


def wav_duration_ms(path: Path) -> int:
    import wave

    with wave.open(str(path), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
    if rate <= 0:
        return 1000
    return max(1000, int(frames / rate * 1000))


def wav_to_mp3(wav_path: Path, mp3_path: Path, *, loudnorm: bool = False) -> None:
    """Encode mp3; optional broadcast loudness so clone isn't buried in the mix."""
    args = ["ffmpeg", "-y", "-i", str(wav_path)]
    if loudnorm:
        # Two-pass-ish single filter: target ~-14 LUFS, leave headroom.
        args += [
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=11:linear=true",
        ]
    args += [
        "-codec:a",
        "libmp3lame",
        "-qscale:a",
        "2",
        str(mp3_path),
    ]
    result = subprocess.run(args, capture_output=True, check=False)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[-400:]
        raise HTTPException(status_code=500, detail=f"ffmpeg mp3 failed: {stderr}")


def whisper_words(wav_path: Path, script: str) -> list[dict[str, Any]]:
    model = load_whisper()
    prompt = re.sub(r"\s+", " ", script).strip()[:224]
    segments, _info = model.transcribe(
        str(wav_path),
        language="en",
        word_timestamps=True,
        initial_prompt=prompt,
        condition_on_previous_text=False,
        vad_filter=True,
    )
    words: list[dict[str, Any]] = []
    for segment in segments:
        for item in getattr(segment, "words", None) or []:
            token = (item.word or "").strip()
            if not token:
                continue
            start_ms = max(0, int(float(item.start) * 1000))
            end_ms = max(start_ms + 40, int(float(item.end) * 1000))
            words.append({"word": token, "startMs": start_ms, "endMs": end_ms})
    return words


def even_slices(tokens: list[str], duration_ms: int) -> list[WordTimestamp]:
    if not tokens:
        return []
    slice_ms = max(40, duration_ms / len(tokens))
    result: list[WordTimestamp] = []
    for index, token in enumerate(tokens):
        start = int(index * slice_ms)
        end = int((index + 1) * slice_ms)
        result.append(WordTimestamp(word=token, startMs=start, endMs=max(start + 40, end)))
    result[-1].endMs = max(result[-1].endMs, duration_ms)
    return result


def align_script(
    tokens: list[str],
    whispered: list[dict[str, Any]],
    duration_ms: int,
) -> list[WordTimestamp]:
    if not tokens:
        return []
    if not whispered:
        return even_slices(tokens, duration_ms)

    starts: list[int | None] = []
    ends: list[int | None] = []
    cursor = 0
    for token in tokens:
        needle = normalize_word(token)
        matched: dict[str, Any] | None = None
        if needle:
            window_end = min(len(whispered), cursor + 6)
            for index in range(cursor, window_end):
                hay = normalize_word(str(whispered[index]["word"]))
                if not hay:
                    continue
                if hay == needle or hay.startswith(needle[:4]) or needle.startswith(hay[:4]):
                    matched = whispered[index]
                    cursor = index + 1
                    break
        if matched is None:
            starts.append(None)
            ends.append(None)
        else:
            starts.append(int(matched["startMs"]))
            ends.append(int(matched["endMs"]))

    misses = sum(1 for value in starts if value is None)
    if misses > max(1, len(tokens) // 2):
        t0 = int(whispered[0]["startMs"])
        t1 = max(int(whispered[-1]["endMs"]), t0 + len(tokens) * 40)
        return even_slices_range(tokens, t0, t1, duration_ms)

    for index, start in enumerate(starts):
        if start is not None:
            continue
        prev = next((value for value in reversed(starts[:index]) if value is not None), None)
        nxt = next((value for value in starts[index + 1 :] if value is not None), None)
        if prev is not None and nxt is not None:
            starts[index] = (prev + nxt) // 2
        elif prev is not None:
            starts[index] = prev + 80
        elif nxt is not None:
            starts[index] = max(0, nxt - 80)
        else:
            starts[index] = int(index / len(tokens) * duration_ms)

    filled_starts = [int(value or 0) for value in starts]
    for index in range(1, len(filled_starts)):
        if filled_starts[index] <= filled_starts[index - 1]:
            filled_starts[index] = filled_starts[index - 1] + 40

    result: list[WordTimestamp] = []
    for index, token in enumerate(tokens):
        start = filled_starts[index]
        if index + 1 < len(filled_starts):
            end = max(start + 40, filled_starts[index + 1])
        else:
            end = max(start + 40, duration_ms)
            if ends[index] is not None:
                end = max(end, int(ends[index]))
        result.append(WordTimestamp(word=token, startMs=start, endMs=end))
    return result


def even_slices_range(
    tokens: list[str],
    start_ms: int,
    end_ms: int,
    duration_ms: int,
) -> list[WordTimestamp]:
    if not tokens:
        return []
    span = max(end_ms - start_ms, len(tokens) * 40)
    slice_ms = span / len(tokens)
    result: list[WordTimestamp] = []
    for index, token in enumerate(tokens):
        start = int(start_ms + index * slice_ms)
        end = int(start_ms + (index + 1) * slice_ms)
        result.append(WordTimestamp(word=token, startMs=start, endMs=max(start + 40, end)))
    result[-1].endMs = max(result[-1].endMs, duration_ms)
    return result


@app.get("/health")
def health() -> dict[str, Any]:
    voice = DEFAULT_VOICE
    stem = Path(voice).stem
    pack_paths = load_approved_paths(stem)
    legacy = VOICES_DIR / f"{stem}.wav"
    voice_ready = bool(pack_paths) or legacy.is_file()
    tts_cache = load_tts.cache_info()
    whisper_cache = load_whisper.cache_info()
    kokoro_cache = load_kokoro.cache_info()
    return {
        "ok": True,
        "model": XTTS_MODEL,
        "device": pick_device(),
        "loaded": tts_cache.hits + tts_cache.misses > 0,
        "whisper_loaded": whisper_cache.hits + whisper_cache.misses > 0,
        "voice": stem,
        "voice_ready": voice_ready,
        "pack_count": len(pack_paths),
        "pack_used": min(len(pack_paths), MAX_PACK_REFS) if pack_paths else (1 if legacy.is_file() else 0),
        "legacy_wav": legacy.is_file(),
        "kokoro_ready": kokoro_ready(),
        "kokoro_loaded": kokoro_cache.hits + kokoro_cache.misses > 0,
        "kokoro_voice": KOKORO_VOICE,
    }


@app.post("/synthesize", response_model=SynthesizeResponse)
def synthesize(body: SynthesizeRequest) -> SynthesizeResponse:
    voice_name, speaker_paths = resolve_speaker(body.speaker_wav or DEFAULT_VOICE)
    tts, device = load_tts()
    language = (body.language or DEFAULT_LANGUAGE).strip() or "en"
    speed = body.speed if body.speed is not None else DEFAULT_SPEED
    text = re.sub(r"\s+", " ", body.text).strip()
    tokens = tokenize_script(text)
    speaker_wav: str | list[str]
    if len(speaker_paths) == 1:
        speaker_wav = str(speaker_paths[0])
    else:
        speaker_wav = [str(path) for path in speaker_paths]

    logger.info(
        "Synthesizing voice=%s refs=%s device=%s chars=%s speed=%s temp=%s",
        voice_name,
        len(speaker_paths),
        device,
        len(text),
        speed,
        XTTS_TEMPERATURE,
    )

    with tempfile.TemporaryDirectory(prefix="video-gen-tts-") as tmp:
        wav_path = Path(tmp) / "narration.wav"
        mp3_path = Path(tmp) / "narration.mp3"
        try:
            tts.tts_to_file(
                text=text,
                speaker_wav=speaker_wav,
                language=language,
                file_path=str(wav_path),
                split_sentences=True,
                speed=speed,
                temperature=XTTS_TEMPERATURE,
                top_p=XTTS_TOP_P,
                repetition_penalty=XTTS_REPETITION_PENALTY,
            )
        except TypeError:
            # Older coqui builds may not accept inference kwargs on tts_to_file.
            try:
                tts.tts_to_file(
                    text=text,
                    speaker_wav=speaker_wav,
                    language=language,
                    file_path=str(wav_path),
                    split_sentences=True,
                    speed=speed,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("XTTS synthesis failed")
                raise HTTPException(status_code=500, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            logger.exception("XTTS synthesis failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        if not wav_path.is_file() or wav_path.stat().st_size < 1000:
            raise HTTPException(status_code=500, detail="XTTS returned empty audio")

        duration_ms = wav_duration_ms(wav_path)
        try:
            whispered = whisper_words(wav_path, text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Whisper alignment failed (%s); using even slices", exc)
            whispered = []

        words = align_script(tokens, whispered, duration_ms)
        duration_ms = max(
            duration_ms,
            words[-1].endMs if words else 1000,
        )
        wav_to_mp3(wav_path, mp3_path, loudnorm=True)
        audio = mp3_path.read_bytes()

    logger.info(
        "TTS ready: %s words, ~%ss, pack_used=%s",
        len(words),
        round(duration_ms / 1000),
        len(speaker_paths),
    )
    return SynthesizeResponse(
        model=XTTS_MODEL,
        device=device,
        voice=voice_name,
        pack_used=len(speaker_paths),
        durationMs=duration_ms,
        words=words,
        audio_base64=base64.b64encode(audio).decode("ascii"),
        engine="xtts",
    )


@app.post("/synthesize-kokoro", response_model=SynthesizeResponse)
def synthesize_kokoro(body: KokoroSynthesizeRequest) -> SynthesizeResponse:
    """Local Kokoro-82M — Edge TTS fallback when Microsoft blocks free Edge."""
    if not kokoro_ready():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Kokoro models not installed under {KOKORO_DIR}. "
                "Run: yarn tts:kokoro:setup"
            ),
        )

    voice = (body.voice or KOKORO_VOICE).strip() or KOKORO_VOICE
    speed = body.speed if body.speed is not None else KOKORO_SPEED
    speed = max(0.5, min(2.0, float(speed)))
    lang = (body.language or KOKORO_LANG).strip() or KOKORO_LANG
    text = re.sub(r"\s+", " ", body.text).strip()
    tokens = tokenize_script(text)

    try:
        kokoro = load_kokoro()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Kokoro load failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if voice not in kokoro.voices:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown Kokoro voice '{voice}'. Try am_michael / am_adam / am_fenrir.",
        )

    logger.info(
        "Synthesizing Kokoro voice=%s chars=%s speed=%s lang=%s",
        voice,
        len(text),
        speed,
        lang,
    )

    with tempfile.TemporaryDirectory(prefix="video-gen-kokoro-") as tmp:
        wav_path = Path(tmp) / "narration.wav"
        mp3_path = Path(tmp) / "narration.mp3"
        try:
            import soundfile as sf

            audio_np, sample_rate = kokoro.create(
                text,
                voice=voice,
                speed=speed,
                lang=lang,
            )
            sf.write(str(wav_path), audio_np, sample_rate, subtype="PCM_16")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Kokoro synthesis failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        if not wav_path.is_file() or wav_path.stat().st_size < 1000:
            raise HTTPException(status_code=500, detail="Kokoro returned empty audio")

        duration_ms = wav_duration_ms(wav_path)
        try:
            whispered = whisper_words(wav_path, text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Whisper alignment failed (%s); using even slices", exc)
            whispered = []

        words = align_script(tokens, whispered, duration_ms)
        duration_ms = max(duration_ms, words[-1].endMs if words else 1000)
        wav_to_mp3(wav_path, mp3_path, loudnorm=True)
        audio = mp3_path.read_bytes()

    logger.info(
        "Kokoro ready: %s words, ~%ss",
        len(words),
        round(duration_ms / 1000),
    )
    return SynthesizeResponse(
        model="kokoro-82m",
        device="cpu",
        voice=voice,
        pack_used=1,
        durationMs=duration_ms,
        words=words,
        audio_base64=base64.b64encode(audio).decode("ascii"),
        engine="kokoro",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Local XTTS voice-clone worker")
    parser.add_argument("--host", default=os.environ.get("TTS_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("TTS_PORT", "7861")),
    )
    parser.add_argument(
        "--preload",
        action="store_true",
        help="Load XTTS + Whisper at startup (avoid on machines that also run Wan)",
    )
    args = parser.parse_args()

    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    if args.preload:
        load_tts()
        load_whisper()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
