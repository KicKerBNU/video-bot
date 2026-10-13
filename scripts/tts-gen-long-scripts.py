#!/usr/bin/env python3
"""Generate 20 long-form news-host scripts for higher-quality XTTS refs."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "workers" / "tts" / "voices" / "scripts" / "long"

SCRIPTS: list[str] = [
    "Hello, this is the ZanshinAI daily briefing. Today we cover model releases, pricing moves, and security alerts that actually change how teams ship. OpenAI trimmed overnight batch prices by about forty percent, which helps summarization pipelines that run while you sleep. NVIDIA still owns the accelerator queue, and power bills are the real bottleneck, not transistor counts. Keep a steady news pace. That's all for today's news on ZanshinAI.",
    "Anthropic said Claude enterprise demand is still climbing, with seats growing faster than consumer chat. Security teams are rewriting tool permissions after Google disclosed a sandbox escape that reached real company systems. If your agents can click buttons or spend money, review the allow list this week. Numbers you will hear often: thirty billion, one hundred million, seventy five cents. Speak clearly through the names.",
    "DeepSeek priced Flash near fifteen cents per million input tokens and sixty cents per million output, undercutting GPT and Claude by a wide margin. Meta kept Llama open weight for builders who fine tune on private data. Microsoft pushed Copilot deeper into Office at roughly thirty dollars a month for business plans. Compare unit economics before you lock a vendor. End with the brand closer when you see it.",
    "On March twelfth, twenty twenty six, Gemini Flash listed about seventy five cents input and three dollars seventy five output per million tokens. Google's consumer app crossed one hundred million monthly users, and voice mode handles interruptions more cleanly. Apple is shipping more on device summaries so notifications never leave the phone. Privacy teams like that tradeoff even when cloud models still win on hard questions.",
    "A hospital pilot used large language models to draft patient notes, and doctors edited about thirty percent less text than last year. Call centers cut average handle time by roughly eighteen percent with AI assist beside humans. Schools paused chatbots after invented citations showed up in essays. Watermarking and teacher review are back on the checklist before tools return to classrooms.",
    "Chip makers booked around fifty billion dollars in AI accelerator orders for the next four quarters. Spot GPU prices spiked near twelve dollars an hour during a training rush, and capacity vanished across three regions. Data center builders say delivery slips and power interconnects matter more than model hype. If you schedule training jobs, pad the calendar and the budget.",
    "Hackers claimed they jailbroke a production agent and moved funds on a test exchange in about eleven minutes. Prompt injection is showing up inside PDF resumes and support tickets. Recruiting tools now strip hidden text before models read applications. Treat every untrusted document like hostile input, even when the interface looks friendly.",
    "StepFun released a six hundred billion parameter preview that early benches put near frontier chat quality at lower serving cost. Naive AI raised at about one point four two billion dollars after shipping an agent that books travel end to end. Venture desks counted roughly two hundred AI seed rounds this month totaling near four billion dollars. Size claims carefully when you narrate valuations.",
    "Amazon Bedrock traffic jumped after customers could swap Claude and Llama per request without rewriting apps. xAI expanded Grok inside social feeds with human review on ad replies. Perplexity style shopping answers with affiliate links are lifting merchant click rates versus classic ads. Distribution is becoming as important as raw model scores.",
    "Researchers say generative systems beat the average human on some creativity tests, while forums warn unsupervised agents bend rules. A university benchmark scored agents booking flights with a fifty dollar cap per task, and success landed around sixty two percent. Robotaxi firms logged about one million unsupervised miles with two serious incidents under review. Keep the tone factual, not dramatic.",
    "Regulators in Europe floated rules for agents that can spend money online, with about ninety days to file compliance plans. Draft guidance asks agencies to label synthetic media in official posts. Banks are asking voice callers for a one time code on a fresh channel after clone style scams spread. Say the numbers slowly so listeners catch the deadline.",
    "Open weights for a popular code model hit about one million downloads in forty eight hours, and maintainers warned about license confusion in forks. Hugging Face mirrored a large research dump during a takedown fight, and lawyers still argue whether weights count as speech. If you ship open checkpoints, state the license in the first sentence of your release note.",
    "Design teams report diffusion tools finally render hands and small text well enough to cut revision cycles by about half. Samsung and Google teased on phone editors that process video offline so files never leave the device during preview. Offline quality still trails the biggest cloud models, but the privacy story is getting easier to sell to customers.",
    "A biotech group used generative models to propose three drug candidates in six weeks; lab validation is the next gate, not the press release. Translation benches show models winning on speed while humans still lead on legal nuance. When you narrate science stories, separate demo claims from peer reviewed results in one clear line.",
    "Cloudflare scale outages and model API brownouts are teaching teams to keep a second provider warm. Rate limits, region failovers, and cached embeddings matter as much as the leaderboard screenshot. For today's briefing, mention redundancy before you mention another parameter count. Steady pace, no rush on the technical terms.",
    "Enterprise buyers are bundling eval harnesses next to chat seats. They want refusal rates, citation accuracy, and tool success measured weekly, not vibes from a demo day. If a vendor will not share eval numbers, say that out loud in the briefing. Clarity beats hype when finance is listening.",
    "Local models on laptops are good enough for drafting and redacting before cloud calls. Teams keep sensitive paragraphs offline, then send a scrubbed prompt upstream. That hybrid pattern cuts leak risk without giving up frontier reasoning. Pronounce product names cleanly: Claude, Gemini, Llama, DeepSeek, Copilot.",
    "Image stills for short form news work best when prompts name a concrete scene: trading floor terminals, server aisles, microphone desks, not abstract purple glow. The same rule applies to voice samples: concrete sentences beat slogan fragments. Record this entire paragraph without stopping, even if you stumble once and recover.",
    "Pricing tables change weekly. Fifteen cents, sixty cents, seventy five cents, three dollars seventy five, thirty dollars a month, five hundred billion, one point eight trillion. Practice those figures as spoken English, not digits. Listeners should understand the scale without seeing a chart.",
    "That wraps this long form sample set for ZanshinAI voice cloning. Speak as you would on the daily video: even pace, quiet room, same microphone distance, clear company names, and a confident closer. Do not whisper the ending. That's all for today's news on ZanshinAI.",
]


def word_count(text: str) -> int:
    return len([p for p in text.split() if p])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    for index, text in enumerate(SCRIPTS, start=1):
        num = f"L{index:02d}"
        path = OUT_DIR / f"{num}.txt"
        cleaned = " ".join(text.split())
        path.write_text(cleaned + "\n", encoding="utf-8")
        words = word_count(cleaned)
        # ~2.4 wps + buffer → target 28–45s windows
        seconds = max(28, min(45, int(words / 2.4) + 10))
        entries.append(
            {
                "id": num,
                "file": f"long/{num}.txt",
                "words": words,
                "recordSeconds": seconds,
                "minSeconds": 22,
                "hasCloser": "That's all for today's news on ZanshinAI" in cleaned,
                "mode": "long",
            }
        )
        print(f"{num}: {words} words, window {seconds}s, min 22s")

    manifest = {
        "voice": "everton",
        "mode": "long",
        "count": len(entries),
        "scripts": entries,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} long scripts → {OUT_DIR}")


if __name__ == "__main__":
    if len(SCRIPTS) != 20:
        raise SystemExit(f"Expected 20 scripts, got {len(SCRIPTS)}")
    main()
