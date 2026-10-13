#!/usr/bin/env python3
"""Score voice-pack WAVs (short + long) and write approved.json for XTTS multi-ref."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "workers" / "tts" / "voices" / "scripts"
PACK_DIR = ROOT / "workers" / "tts" / "voices" / "everton" / "pack"
SHORT_MANIFEST = SCRIPTS_DIR / "manifest.json"
LONG_MANIFEST = SCRIPTS_DIR / "long" / "manifest.json"
FOCUS_MANIFEST = SCRIPTS_DIR / "focus" / "manifest.json"
HERO_WAV = ROOT / "workers" / "tts" / "voices" / "everton.wav"
APPROVED = PACK_DIR / "approved.json"
# Fewer, stronger long refs → cleaner clone (too many refs muddies XTTS).
MAX_USED = int(__import__("os").environ.get("TTS_PACK_MAX_REFS", "10"))
MIN_DURATION_SHORT = 12.0
MIN_DURATION_LONG = 22.0
MAX_MEAN_DB = -45.0


def ffprobe_duration(path: Path) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                str(path),
            ],
            text=True,
        ).strip()
        return float(out or 0)
    except Exception:  # noqa: BLE001
        return 0.0


def mean_volume_db(path: Path) -> float:
    try:
        proc = subprocess.run(
            ["ffmpeg", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True,
            text=True,
            check=False,
        )
        for line in (proc.stderr or "").splitlines():
            if "mean_volume:" in line:
                raw = line.split("mean_volume:")[-1].strip().replace(" dB", "")
                return float(raw)
    except Exception:  # noqa: BLE001
        pass
    return -99.0


def keyword_hits(transcript: str, script: str) -> float:
    stop = {
        "the",
        "a",
        "an",
        "and",
        "or",
        "to",
        "of",
        "in",
        "on",
        "for",
        "is",
        "are",
        "that",
        "this",
        "with",
        "as",
        "by",
        "at",
        "from",
        "it",
        "be",
        "was",
        "were",
    }
    tokens = [
        t
        for t in re.findall(r"[a-z0-9']+", script.lower())
        if t not in stop and len(t) > 2
    ]
    if not tokens:
        return 0.0
    hay = transcript.lower()
    hits = sum(1 for t in tokens if t in hay)
    return hits / len(tokens)


def score_row(
    duration: float,
    mean_db: float,
    coverage: float,
    *,
    mode: str,
) -> float:
    prefer_long = mode in {"long", "focus"}
    min_dur = MIN_DURATION_LONG if prefer_long else MIN_DURATION_SHORT
    if duration < min_dur or mean_db <= MAX_MEAN_DB:
        return -1.0
    # Prefer ~28–36s for long/focus, ~16–24s for short
    target = 28.0 if mode == "focus" else 32.0 if prefer_long else 20.0
    span = 16.0 if mode == "focus" else 18.0 if prefer_long else 16.0
    dur_score = 1.0 - min(abs(duration - target) / span, 1.0)
    level_score = min(max((mean_db + 45.0) / 25.0, 0.0), 1.0)
    # Longer / focus drills beat short fillers
    mode_bonus = 0.14 if mode == "focus" else 0.12 if prefer_long else 0.0
    return round(
        0.40 * dur_score + 0.20 * level_score + 0.40 * coverage + mode_bonus,
        4,
    )


def load_entries() -> list[dict]:
    entries: list[dict] = []
    for path, default_mode in (
        (SHORT_MANIFEST, "short"),
        (LONG_MANIFEST, "long"),
        (FOCUS_MANIFEST, "focus"),
    ):
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for item in data.get("scripts") or []:
            entries.append(
                {
                    **item,
                    "mode": item.get("mode") or default_mode,
                }
            )
    return entries


def main() -> int:
    entries = load_entries()
    if not entries:
        print("No manifests found — run yarn tts:scripts && yarn tts:scripts:long", file=sys.stderr)
        return 1
    PACK_DIR.mkdir(parents=True, exist_ok=True)

    whisper = None
    try:
        from faster_whisper import WhisperModel

        whisper = WhisperModel("base.en", device="cpu", compute_type="int8")
    except Exception as exc:  # noqa: BLE001
        print(f"Whisper unavailable ({exc}); scoring without transcripts")

    rows: list[dict] = []
    for entry in entries:
        sid = entry["id"]
        mode = entry.get("mode") or "short"
        wav = PACK_DIR / f"{sid}.wav"
        script_path = SCRIPTS_DIR / entry["file"]
        script = (
            script_path.read_text(encoding="utf-8").strip()
            if script_path.is_file()
            else ""
        )
        if not wav.is_file():
            rows.append(
                {
                    "id": sid,
                    "mode": mode,
                    "path": str(wav.relative_to(ROOT)),
                    "exists": False,
                    "approved": False,
                    "durationSec": 0,
                    "meanVolumeDb": None,
                    "coverage": 0,
                    "score": -1,
                    "transcript": "",
                }
            )
            continue

        duration = ffprobe_duration(wav)
        mean_db = mean_volume_db(wav)
        transcript = ""
        coverage = 0.0
        if whisper is not None and duration >= 3:
            try:
                segments, _info = whisper.transcribe(str(wav), language="en")
                transcript = " ".join(s.text.strip() for s in segments).strip()
                coverage = keyword_hits(transcript, script)
            except Exception as exc:  # noqa: BLE001
                transcript = f"[whisper error: {exc}]"

        sc = score_row(duration, mean_db, coverage, mode=mode)
        approved = sc >= 0
        rows.append(
            {
                "id": sid,
                "mode": mode,
                "path": str(wav.relative_to(ROOT)),
                "exists": True,
                "approved": approved,
                "durationSec": round(duration, 2),
                "meanVolumeDb": round(mean_db, 2),
                "coverage": round(coverage, 3),
                "score": sc,
                "transcript": transcript[:240],
            }
        )
        flag = "OK" if approved else "BAD"
        print(
            f"{sid}  {flag}  {mode:5}  {duration:5.1f}s  {mean_db:6.1f}dB  "
            f"cov={coverage:.2f}  score={sc}"
        )

    # Optional hero sample (legacy single WAV) — only if long enough
    if HERO_WAV.is_file():
        duration = ffprobe_duration(HERO_WAV)
        mean_db = mean_volume_db(HERO_WAV)
        sc = score_row(duration, mean_db, 0.5, mode="long")
        if sc >= 0:
            rows.append(
                {
                    "id": "hero",
                    "mode": "long",
                    "path": str(HERO_WAV.relative_to(ROOT)),
                    "exists": True,
                    "approved": True,
                    "durationSec": round(duration, 2),
                    "meanVolumeDb": round(mean_db, 2),
                    "coverage": 0.5,
                    "score": round(sc + 0.05, 4),
                    "transcript": "[hero everton.wav]",
                }
            )
            print(
                f"hero OK   long   {duration:5.1f}s  {mean_db:6.1f}dB  score={sc + 0.05:.4f}"
            )

    approved_rows = sorted(
        [r for r in rows if r["approved"]],
        key=lambda r: (r["mode"] == "long", r["score"]),
        reverse=True,
    )
    # Prefer long clips first, then fill with best shorts up to MAX_USED
    longs = [r for r in approved_rows if r["mode"] == "long"]
    shorts = [r for r in approved_rows if r["mode"] != "long"]
    used: list[dict] = []
    for row in longs + shorts:
        if len(used) >= MAX_USED:
            break
        used.append(row)

    payload = {
        "voice": "everton",
        "minDurationShortSec": MIN_DURATION_SHORT,
        "minDurationLongSec": MIN_DURATION_LONG,
        "maxRefs": MAX_USED,
        "approvedCount": len(approved_rows),
        "usedCount": len(used),
        "usedIds": [r["id"] for r in used],
        "usedPaths": [r["path"] for r in used],
        "clips": rows,
    }
    APPROVED.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print()
    print(
        f"Approved {len(approved_rows)} — using top {len(used)} "
        f"({sum(1 for r in used if r['mode']=='long')} long) → {APPROVED}"
    )
    if len(approved_rows) < 1:
        print("No approved clips yet.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
