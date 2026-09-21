<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

interface ScriptItem {
  id: string;
  text: string;
  words: number;
  recordSeconds: number;
  hasCloser: boolean;
  completed: boolean;
  durationSec: number | null;
  recordedAt: string | null;
  audioUrl: string | null;
}

interface ScriptsResponse {
  voice: string;
  total: number;
  completedCount: number;
  nextId: string | null;
  scripts: ScriptItem[];
}

const apiBase = '';

const loading = ref(true);
const error = ref('');
const statusMsg = ref('');
const statusOk = ref(false);
const data = ref<ScriptsResponse | null>(null);
const selectedId = ref<string | null>(null);

const recording = ref(false);
const saving = ref(false);
const elapsedMs = ref(0);
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let chunks: BlobPart[] = [];
let timer: number | null = null;
let startedAt = 0;

const selected = computed(
  () => data.value?.scripts.find((s) => s.id === selectedId.value) ?? null,
);

const progressPct = computed(() => {
  if (!data.value?.total) return 0;
  return Math.round((data.value.completedCount / data.value.total) * 100);
});

const timerLabel = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
});

async function load(preferId?: string | null) {
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch(`${apiBase}/voice-pack/scripts`);
    if (!res.ok) throw new Error(`Failed to load scripts (${res.status})`);
    const json = (await res.json()) as ScriptsResponse;
    data.value = json;
    const pick =
      preferId && json.scripts.some((s) => s.id === preferId)
        ? preferId
        : json.nextId ?? json.scripts[0]?.id ?? null;
    selectedId.value = pick;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function select(id: string) {
  if (recording.value) return;
  selectedId.value = id;
  statusMsg.value = '';
}

async function startRecording() {
  if (!selected.value || recording.value) return;
  error.value = '';
  statusMsg.value = '';
  statusOk.value = false;
  chunks = [];
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
  } catch (err) {
    error.value =
      'Microphone permission denied. Allow mic access for this site, then try again.';
    return;
  }

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';

  mediaRecorder = mime
    ? new MediaRecorder(mediaStream, { mimeType: mime })
    : new MediaRecorder(mediaStream);

  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  mediaRecorder.start(250);
  recording.value = true;
  startedAt = Date.now();
  elapsedMs.value = 0;
  timer = window.setInterval(() => {
    elapsedMs.value = Date.now() - startedAt;
  }, 200);
}

async function finishRecording() {
  if (!mediaRecorder || !selected.value || !recording.value) return;
  saving.value = true;
  statusMsg.value = 'Saving…';
  statusOk.value = false;

  const blob: Blob = await new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error('No recorder'));
      return;
    }
    mediaRecorder.onstop = () => {
      resolve(new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' }));
    };
    mediaRecorder.onerror = () => reject(new Error('Recorder error'));
    mediaRecorder.stop();
  });

  stopTracks();
  recording.value = false;
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }

  if (blob.size < 1000) {
    saving.value = false;
    error.value = 'Recording was empty. Try again.';
    return;
  }

  const id = selected.value.id;
  const form = new FormData();
  form.append('audio', blob, `${id}.webm`);

  try {
    const res = await fetch(`${apiBase}/voice-pack/${id}/audio`, {
      method: 'POST',
      body: form,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.message || json.error || `Upload failed (${res.status})`);
    }
    statusMsg.value = `Saved script ${id}. ${json.completedCount}/${json.total} done.`;
    statusOk.value = true;
    await load(json.nextId ?? id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    statusMsg.value = '';
  } finally {
    saving.value = false;
  }
}

function stopTracks() {
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;
  mediaRecorder = null;
}

async function reRecord() {
  if (!selected.value?.completed || recording.value) return;
  if (!confirm(`Delete recording for ${selected.value.id} and re-record?`)) {
    return;
  }
  const id = selected.value.id;
  const res = await fetch(`${apiBase}/voice-pack/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    error.value = 'Could not delete recording';
    return;
  }
  await load(id);
  statusMsg.value = `Cleared ${id}. Ready to record again.`;
  statusOk.value = true;
}

watch(selectedId, () => {
  if (!recording.value) {
    elapsedMs.value = 0;
  }
});

onMounted(() => {
  void load();
});

onUnmounted(() => {
  stopTracks();
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <h1 class="brand">ZanshinAI</h1>
      <p class="sub">Voice pack recorder · resume anytime</p>

      <div class="progress" aria-hidden="true">
        <span :style="{ width: `${progressPct}%` }" />
      </div>
      <p class="sub" v-if="data">
        {{ data.completedCount }} / {{ data.total }} complete
        <span v-if="data.nextId"> · next {{ data.nextId }}</span>
      </p>

      <ul class="script-list" v-if="data">
        <li v-for="s in data.scripts" :key="s.id">
          <button
            type="button"
            :class="{ active: s.id === selectedId }"
            @click="select(s.id)"
          >
            <span>Script {{ s.id }}</span>
            <span class="done" v-if="s.completed">done</span>
            <span v-else style="color: var(--muted); font-size: 0.8rem">—</span>
          </button>
        </li>
      </ul>
    </aside>

    <main class="main">
      <p class="kicker">Read aloud · news-host pace</p>

      <div v-if="loading">Loading scripts…</div>
      <div v-else-if="error && !selected" class="status error">{{ error }}</div>

      <div class="script-card" v-else-if="selected">
        <p class="kicker">Script {{ selected.id }}</p>
        <p class="script-text">{{ selected.text }}</p>

        <div class="meta">
          <span>~{{ selected.words }} words</span>
          <span>target ~{{ selected.recordSeconds }}s</span>
          <span v-if="selected.completed">
            saved {{ selected.durationSec?.toFixed?.(1) ?? selected.durationSec }}s
          </span>
        </div>

        <div class="controls">
          <button
            class="btn btn-start"
            type="button"
            :disabled="recording || saving"
            @click="startRecording"
          >
            Start
          </button>
          <button
            class="btn btn-finish"
            type="button"
            :disabled="!recording || saving"
            @click="finishRecording"
          >
            Finish
          </button>
          <span class="timer">
            <span v-if="recording" class="rec-dot" />
            {{ timerLabel }}
          </span>
          <button
            class="btn btn-ghost"
            type="button"
            :disabled="!selected.completed || recording || saving"
            @click="reRecord"
          >
            Re-record
          </button>
        </div>

        <audio
          v-if="selected.audioUrl"
          class="player"
          controls
          :src="`${selected.audioUrl}?t=${selected.recordedAt || ''}`"
        />

        <p v-if="statusMsg" class="status" :class="{ ok: statusOk }">
          {{ statusMsg }}
        </p>
        <p v-if="error" class="status error">{{ error }}</p>
        <p class="status">
          Progress is saved on the server after each Finish. Come back tomorrow —
          completed scripts stay marked done.
        </p>
      </div>
    </main>
  </div>
</template>
