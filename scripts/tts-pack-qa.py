#!/usr/bin/env python3
"""Score voice-pack WAVs and write approved.json (top clips for XTTS multi-ref)."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "workers" / "tts" / "voices" / "scripts"
PACK_DIR = ROOT / "workers" / "tts" / "voices" / "everton" / "pack"
MANIFEST = SCRIPTS_DIR / "manifest.json"
APPROVED = PACK_DIR / "approved.json"
MAX_USED = int(__import__("os").environ.get("TTS_PACK_MAX_REFS", "16"))
MIN_DURATION = 12.0
MAX_MEAN_DB = -45.0  # must be louder than this (greater than)


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
    """Fraction of distinctive script tokens found in whisper text."""
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
) -> float:
    if duration < MIN_DURATION or mean_db <= MAX_MEAN_DB:
        return -1.0
    # Prefer ~15–25s, decent level, high keyword coverage
    dur_score = 1.0 - min(abs(duration - 20.0) / 20.0, 1.0)
    level_score = min(max((mean_db + 45.0) / 25.0, 0.0), 1.0)
    return round(0.35 * dur_score + 0.25 * level_score + 0.40 * coverage, 4)


def main() -> int:
    if not MANIFEST.is_file():
        print(f"Missing {MANIFEST} — run yarn tts:scripts", file=sys.stderr)
        return 1
    PACK_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    whisper = None
    try:
        from faster_whisper import WhisperModel

        whisper = WhisperModel("base.en", device="cpu", compute_type="int8")
    except Exception as exc:  # noqa: BLE001
        print(f"Whisper unavailable ({exc}); scoring without transcripts")

    rows: list[dict] = []
    for entry in manifest["scripts"]:
        sid = entry["id"]
        wav = PACK_DIR / f"{sid}.wav"
        script_path = SCRIPTS_DIR / entry["file"]
        script = script_path.read_text(encoding="utf-8").strip() if script_path.is_file() else ""
        if not wav.is_file():
            rows.append(
                {
                    "id": sid,
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

        sc = score_row(duration, mean_db, coverage)
        approved = sc >= 0
        rows.append(
            {
                "id": sid,
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
            f"{sid}  {flag}  {duration:5.1f}s  {mean_db:6.1f}dB  "
            f"cov={coverage:.2f}  score={sc}"
        )

    approved_rows = sorted(
        [r for r in rows if r["approved"]],
        key=lambda r: r["score"],
        reverse=True,
    )
    used = approved_rows[:MAX_USED]
    payload = {
        "voice": "everton",
        "minDurationSec": MIN_DURATION,
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
        f"Approved {len(approved_rows)}/40 — using top {len(used)} "
        f"→ {APPROVED}"
    )
    if len(approved_rows) < 1:
        print("No approved clips yet. Record with: yarn tts:record-pack", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
