#!/usr/bin/env python3
"""Generate focus scripts that drill hard pronunciations for XTTS clone quality."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "workers" / "tts" / "voices" / "scripts" / "focus"

CLOSER = "That's all for today's news on Zanshin A I."

SCRIPTS: list[str] = [
    f"Hello, this is the Zanshin A I daily briefing. Today the United States and Nvidia share the lead story. Speak United States clearly, never as us. Nvidia ships more G P Us into United States data centers this quarter. {CLOSER}",
    f"Nvidia committed one billion dollars to advance United States science over five years. Say Nvidia with a clear V sound, not N video. United States labs will share the compute grants. {CLOSER}",
    f"Open A I and Anthropic both pitched enterprise seats in the United States this week. Open A I is said letter by letter. Anthropic stays Anthropic. Keep a steady news pace. {CLOSER}",
    f"Claude Haiku five point five is Anthropic's small model for high volume United States workloads. Nvidia accelerators still set the queue time. Prices move weekly. {CLOSER}",
    f"Deep Seek undercut Open A I on unit cost while Nvidia stock reacted in United States markets. Deep Seek is two words. Do not rush the company names. {CLOSER}",
    f"Chat G P T and Copilot are fighting for Office seats across the United States. G P T four still means G P T four when you say it. End clean and confident. {CLOSER}",
    f"A P I rate limits hit United States startups harder than model quality this month. Teams keep a second A P I warm when Nvidia cloud regions brown out. {CLOSER}",
    f"G P U spot prices in the United States spiked near twelve dollars an hour. Nvidia supply, not marketing slides, decided who trained on time. Say the money amounts slowly. {CLOSER}",
    f"Regulators in the United States asked agencies to label A I media in official posts. Banks fear voice clones after Nvidia powered demos went public. Stay factual. {CLOSER}",
    f"Meta kept Llama open weight for builders in the United States who fine tune on private data. Llama rhymes with drama. Nvidia still sells the racks underneath. {CLOSER}",
    f"Google Gemini and Microsoft Copilot both claim United States enterprise wins. Gemini is soft G. Nvidia remains the pickaxe vendor. Compare seats, not slogans. {CLOSER}",
    f"Practice the closer twice in this take. First mid script: {CLOSER} Then finish the news beat about Nvidia and United States funding, and close again. {CLOSER}",
    f"One hundred million dollars, one billion dollars, forty percent, ten thousand engineers. United States buyers care about those figures. Nvidia care about wattage. {CLOSER}",
    f"Zanshin A I covers A I news for builders in the United States. Say Zanshin A I as Zanshin, then A, then I. Never smash it into one slurred word. {CLOSER}",
    f"Final focus drill: Nvidia, United States, Open A I, Anthropic, Deep Seek, Chat G P T, G P U, A P I, Zanshin A I. Clear consonants, even pace, quiet room. {CLOSER}",
]


def word_count(text: str) -> int:
    return len([p for p in text.split() if p])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    for index, text in enumerate(SCRIPTS, start=1):
        num = f"F{index:02d}"
        path = OUT_DIR / f"{num}.txt"
        cleaned = " ".join(text.split())
        path.write_text(cleaned + "\n", encoding="utf-8")
        words = word_count(cleaned)
        seconds = max(24, min(40, int(words / 2.4) + 8))
        entries.append(
            {
                "id": num,
                "file": f"focus/{num}.txt",
                "words": words,
                "recordSeconds": seconds,
                "minSeconds": 20,
                "hasCloser": CLOSER in cleaned,
                "mode": "focus",
            }
        )
        print(f"{num}: {words} words, window {seconds}s, min 20s")

    manifest = {
        "voice": "everton",
        "mode": "focus",
        "count": len(entries),
        "scripts": entries,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} focus scripts → {OUT_DIR}")


if __name__ == "__main__":
    if len(SCRIPTS) != 15:
        raise SystemExit(f"Expected 15 scripts, got {len(SCRIPTS)}")
    main()
