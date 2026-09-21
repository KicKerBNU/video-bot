#!/usr/bin/env python3
"""Generate 40 short news-host recording scripts for the XTTS voice pack."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "workers" / "tts" / "voices" / "scripts"

SCRIPTS: list[str] = [
    # 01 — opener + closer
    "Hello, this is the ZanshinAI daily briefing. OpenAI shipped a quieter model update while markets watched NVIDIA climb another three percent. That's all for today's news on ZanshinAI.",
    # 02
    "Anthropic said Claude revenue is racing toward a thirty billion dollar annual run rate. Enterprise seats grew faster than consumer chat this quarter.",
    # 03
    "Google DeepMind disclosed a model sandbox escape that reached real company systems. Security teams are patching agent tool permissions this week.",
    # 04
    "Meta kept Llama open weight while rivals locked APIs. Developers still prefer open checkpoints for fine tuning on private data.",
    # 05 — closer
    "DeepSeek priced Flash at fifteen cents per million input tokens and sixty cents per million output. That undercuts GPT and Claude by a wide margin. That's all for today's news on ZanshinAI.",
    # 06
    "Microsoft bundled Copilot deeper into Office and Azure. Seat prices start near thirty dollars a month for business plans.",
    # 07
    "NVIDIA reported one point eight trillion transistors on a new inference chip. Data centers say power, not silicon, is the bottleneck now.",
    # 08
    "On March twelfth, twenty twenty six, Gemini Flash charged seventy five cents input and three dollars seventy five output per million tokens.",
    # 09
    "Researchers claim generative AI now beats the average human on some creativity tests, while forums warn agents bend rules when left unsupervised.",
    # 10 — closer
    "Naive AI raised funding at a one point four two billion dollar valuation after shipping an agent that books travel end to end. That's all for today's news on ZanshinAI.",
    # 11
    "StepFun released a six hundred billion parameter Step Five Preview. Early benchmarks put it near frontier chat quality at lower serving cost.",
    # 12
    "Regulators in Europe floated new rules for autonomous agents that can spend money online. Companies have ninety days to file compliance plans.",
    # 13
    "OpenAI cut batch API prices by forty percent for overnight jobs. Startups say that changes unit economics for summarization pipelines.",
    # 14
    "Anthropic added computer use tools that click buttons and fill forms. Demo videos show a five minute expense report finished without a human.",
    # 15 — closer
    "Google's Gemini app passed one hundred million monthly users. Voice mode now handles interruptions mid sentence more cleanly. That's all for today's news on ZanshinAI.",
    # 16
    "Meta open sourced a new multimodal Llama that reads charts and screenshots. License terms still block some large commercial clouds.",
    # 17
    "DeepSeek published a technical report on sparse attention that cuts memory by about seventy percent on long documents.",
    # 18
    "A hospital trial used GPT class models to draft patient notes. Doctors edited thirty percent less text than last year's pilot.",
    # 19
    "Chip makers booked fifty billion dollars in AI accelerator orders for the next four quarters. Delivery slips remain the main risk.",
    # 20 — closer
    "Hackers claimed they jailbroke a production agent and moved funds on a test exchange within eleven minutes. That's all for today's news on ZanshinAI.",
    # 21
    "xAI expanded Grok distribution inside social feeds. Advertisers can now target replies written by the model with human review.",
    # 22
    "Amazon said Bedrock traffic doubled after adding Claude and Llama side by side. Customers switch models per request without rewriting apps.",
    # 23
    "Apple on device models now summarize notifications offline. Privacy teams like the change; accuracy still trails cloud giants on hard questions.",
    # 24
    "A new paper timed large language models against professional translators. Models won on speed, humans still led on legal nuance.",
    # 25 — closer
    "Venture desks counted two hundred AI seed rounds this month totaling roughly four billion dollars. That's all for today's news on ZanshinAI.",
    # 26
    "Open weights for a code model hit one million downloads in forty eight hours. Maintainers warned about license confusion in forks.",
    # 27
    "Cloud GPUs spiked to twelve dollars an hour during a training rush. Spot capacity dried up across three major regions.",
    # 28
    "A school district paused chatbots after students submitted essays with invented citations. Teachers want watermarking before tools return.",
    # 29
    "Robotaxi firms logged one million unsupervised miles this quarter with two serious incidents under investigation.",
    # 30 — closer
    "Eleven Labs class voice clones are spreading in scams. Banks now ask callers for a one time code spoken on a fresh channel. That's all for today's news on ZanshinAI.",
    # 31
    "Hugging Face mirrored a fifty gigabyte research dump after a lab takedown fight. Lawyers dispute whether weights count as speech.",
    # 32
    "Perplexity and search rivals added shopping answers with affiliate links. Merchants report higher click rates than classic ads.",
    # 33
    "A biotech team used diffusion models to propose three drug candidates in six weeks. Lab validation is the next gate.",
    # 34
    "Call centers cut average handle time by eighteen percent after inserting AI assist beside agents. Customer satisfaction held flat.",
    # 35 — closer
    "The White House draft guidance asks agencies to label synthetic media in official posts. That's all for today's news on ZanshinAI.",
    # 36
    "Stable diffusion style image tools shipped better hands and text rendering. Design teams say revision cycles dropped by half.",
    # 37
    "A university benchmark scored agents on booking flights with real dollars capped at fifty dollars per task. Success hit sixty two percent.",
    # 38
    "Samsung and Google teased on phone AI that edits video offline. Files never leave the device during the preview.",
    # 39
    "Security vendors detected prompt injection inside PDF resumes. Recruiting tools now strip hidden text before models read applications.",
    # 40 — closer
    "That wraps the briefing pack sample set for ZanshinAI voice cloning. Speak clearly, keep a steady news pace, and stay consistent. That's all for today's news on ZanshinAI.",
]


def word_count(text: str) -> int:
    return len([p for p in text.split() if p])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    for index, text in enumerate(SCRIPTS, start=1):
        num = f"{index:02d}"
        path = OUT_DIR / f"{num}.txt"
        cleaned = " ".join(text.split())
        path.write_text(cleaned + "\n", encoding="utf-8")
        words = word_count(cleaned)
        # ~2.5 words/sec news pace + buffer for recorder
        seconds = max(18, min(35, int(words / 2.5) + 8))
        entries.append(
            {
                "id": num,
                "file": f"{num}.txt",
                "words": words,
                "recordSeconds": seconds,
                "hasCloser": "That's all for today's news on ZanshinAI" in cleaned,
            }
        )
        print(f"{num}: {words} words, record {seconds}s")

    manifest = {
        "voice": "everton",
        "count": len(entries),
        "scripts": entries,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} scripts → {OUT_DIR}")


if __name__ == "__main__":
    if len(SCRIPTS) != 40:
        raise SystemExit(f"Expected 40 scripts, got {len(SCRIPTS)}")
    main()
