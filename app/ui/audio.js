// Neuralbase audio player: Web Audio API. Preload once at idle, then play decoded
// buffers with AudioBufferSourceNode.start() for low-latency, overlapping clips.
// Degrades silently to no-ops when AudioContext is unavailable. No Web Speech API.

const noop = {
  load: () => Promise.resolve(false),
  playVoice: () => false,
  playSfx: () => false,
  setVolume: () => {},
  setMuted: () => {},
  setSfx: () => {},
  setVoice: () => {},
  getVolume: () => 0,
  isMuted: () => true,
  resume: () => {},
  isReady: () => false,
  ctx: null,
  master: null,
};

export const audio = (() => {
  const AC =
    typeof window !== "undefined" &&
    (window.AudioContext || window.webkitAudioContext);
  if (!AC) return noop;

  let ctx;
  try {
    ctx = new AC();
  } catch (e) {
    return noop;
  }

  const buffers = new Map();
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  let volume = 1;
  let muted = false;
  let sfxOn = true;
  let voiceOn = true;
  let ready = false;
  let loadPromise = null;

  const idle = (cb) =>
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(cb)
      : setTimeout(cb, 200);

  // Safari historically used callbacks; modern browsers return a promise.
  function decode(bytes) {
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });
  }

  async function fetchManifest(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("audio manifest " + res.status);
    return res.json();
  }

  async function decodeAll(manifest, base) {
    const entries = [
      ...Object.entries(manifest.voice || {}).map(([k, u]) => ["voice." + k, u]),
      ...Object.entries(manifest.sfx || {}).map(([k, u]) => ["sfx." + k, u]),
    ];
    await Promise.all(
      entries.map(async ([key, url]) => {
        const res = await fetch(base + url);
        if (!res.ok) throw new Error(key + " " + res.status);
        buffers.set(key, await decode(await res.arrayBuffer()));
      })
    );
    ready = true;
  }

  // Fetch + decode everything once, scheduled at idle. Safe to call repeatedly.
  // Pass a manifest object, or a manifest URL, or nothing (defaults to the
  // bundled audio/manifest.json next to the app).
  function load(manifest, base = "") {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve) => {
      idle(() => {
        Promise.resolve()
          .then(() =>
            manifest && typeof manifest === "object"
              ? manifest
              : fetchManifest(manifest || "audio/manifest.json")
          )
          .then((m) => decodeAll(m, base))
          .then(() => resolve(true))
          .catch(() => resolve(false)); // silent: audio is optional
      });
    });
    return loadPromise;
  }

  function play(key, gain) {
    const buf = buffers.get(key);
    if (!buf) return false;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain == null ? 1 : gain;
    src.connect(g);
    g.connect(master);
    src.start();
    return true;
  }

  function applyGain() {
    master.gain.value = muted ? 0 : volume;
  }

  return {
    load,
    playVoice: (key, gain) => (voiceOn ? play("voice." + key, gain) : false),
    playSfx: (key, gain) => (sfxOn ? play("sfx." + key, gain) : false),
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      applyGain();
    },
    setMuted(b) {
      muted = !!b;
      applyGain();
    },
    setSfx(b) { sfxOn = !!b; },
    setVoice(b) { voiceOn = !!b; },
    isSfx: () => sfxOn,
    isVoice: () => voiceOn,
    getVolume: () => volume,
    isMuted: () => muted,
    // Call from the first user gesture to satisfy autoplay policy.
    resume() {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    isReady: () => ready,
    ctx,
    master,
  };
})();

export default audio;
