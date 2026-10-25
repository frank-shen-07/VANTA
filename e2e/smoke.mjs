/**
 * VANTA end-to-end smoke test in real (headless) Google Chrome.
 *
 *   npm run build && npx next start -p 3000 &
 *   VANTA_URL=http://localhost:3000 node e2e/smoke.mjs
 *
 * Verifies the integrated pipelines against the live app: WebGL rendering,
 * MP3/WAV upload + playback, real audio analysis → modulation, layer edits
 * changing the rendered image, AI generation/refinement through the API,
 * presets, presentation mode without renderer/audio restarts, video export
 * (twice, with audio, animated frames), still export, autosave/reload.
 * Screenshots and recordings are written to e2e/output/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.VANTA_URL ?? "http://localhost:3000";
const OUT = new URL("./output/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** 16-bit mono WAV: 120 BPM kick (55 Hz), off-beat hats (noise), soft 440 Hz pad. */
function makeBeatWav(seconds = 10, sampleRate = 44100) {
  const n = seconds * sampleRate;
  const data = new Int16Array(n);
  const beat = 0.5;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const tb = t % beat;
    const kick = tb < 0.25 ? Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 9) : 0;
    const th = (t + beat / 2) % beat;
    const hat = th < 0.05 ? rand() * Math.exp(-th * 60) * 0.35 : 0;
    const pad = Math.sin(2 * Math.PI * 440 * t) * 0.06;
    data[i] = Math.max(-1, Math.min(1, kick * 0.9 + hat + pad)) * 32767;
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  Buffer.from(data.buffer).copy(buf, 44);
  return buf;
}

const wavPath = `${OUT}test-beat.wav`;
writeFileSync(wavPath, makeBeatWav());
const wavPath2 = `${OUT}test-beat-2.wav`;
writeFileSync(wavPath2, makeBeatWav(6));
const badPath = `${OUT}not-audio.txt`;
writeFileSync(badPath, "definitely not audio");

const browser = await chromium.launch({
  channel: "chrome",
  headless: process.env.HEADED ? false : true,
  args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", ...(process.env.CHROME_ARGS?.split(" ").filter(Boolean) ?? [])],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

/** Average brightness (0..255) + variance of a still captured from the renderer. */
const stillStats = () =>
  page.evaluate(async () => {
    const blob = await window.__VANTA__.getRenderer().captureStill();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(160, 100);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0, 160, 100);
    const px = g.getImageData(0, 0, 160, 100).data;
    let sum = 0, sum2 = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      sum += l;
      sum2 += l * l;
    }
    const n = px.length / 4;
    return { size: blob.size, type: blob.type, mean: sum / n, variance: sum2 / n - (sum / n) ** 2 };
  });

try {
  /* ---------------- boot ---------------- */
  await page.goto(`${BASE}/?debug=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__VANTA__ && document.querySelector("canvas"), null, { timeout: 30000 });
  await page.waitForFunction(() => window.__VANTA__.getRenderer() && window.__VANTA__.getAudioController(), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const boot = await page.evaluate(() => ({
    status: window.__VANTA__.editor.getState().rendererStatus,
    layers: window.__VANTA__.scene.getState().scene.layers.length,
    canvases: document.querySelectorAll("canvas").length,
    webgl: !!window.__VANTA__.getRenderer().getCanvas().getContext("webgl2"),
    exporter: !!window.__VANTA__.getExportController(),
  }));
  check("renderer boots (status ready, WebGL canvas registered)", boot.status === "ready", JSON.stringify(boot));
  check("export controller registered", boot.exporter);
  await page.screenshot({ path: `${OUT}01-boot.png` });
  await page.evaluate(() => (window.__canvas0 = window.__VANTA__.getRenderer().getCanvas()));

  const still0 = await stillStats();
  check("still capture returns a non-blank PNG", still0.size > 1000 && still0.variance > 1, JSON.stringify(still0));

  /* ---------------- audio upload + analysis ---------------- */
  const fileInput = page.locator('input[type="file"][accept*="mp3"], input[type="file"][accept*="audio"]').first();
  await fileInput.setInputFiles(badPath);
  await page.waitForTimeout(500);
  const badState = await page.evaluate(() => window.__VANTA__.getAudioController().getState());
  check("non-audio upload is rejected with an error", badState.error || badState.status === "error" || badState.status === "empty", JSON.stringify({ status: badState.status, error: badState.error }));

  await fileInput.setInputFiles(wavPath);
  await page.waitForFunction(() => ["ready", "paused", "playing"].includes(window.__VANTA__.getAudioController().getState().status), null, { timeout: 15000 });
  await page.evaluate(() => window.__VANTA__.getAudioController().play());
  await page.waitForTimeout(1200);
  const samples = await page.evaluate(async () => {
    const out = { bass: 0, mids: 0, highs: 0, energy: 0, onset: 0, mod: 0, active: false, frames: 0 };
    for (let i = 0; i < 60; i++) {
      const f = window.__VANTA__.audioBus.features;
      for (const k of ["bass", "mids", "highs", "energy", "onset"]) out[k] = Math.max(out[k], f[k]);
      out.active ||= window.__VANTA__.audioBus.analysisActive;
      for (const m of window.__VANTA__.liveModulation.layers.values()) for (const v of Object.values(m)) out.mod = Math.max(out.mod, Math.abs(v));
      await new Promise((r) => setTimeout(r, 50));
    }
    const s = window.__VANTA__.getAudioController().getState();
    out.status = s.status;
    out.time = s.currentTime;
    out.duration = s.duration;
    out.source = s.source;
    return out;
  });
  check("WAV plays (status playing, time advancing)", samples.status === "playing" && samples.time > 0.5, `status=${samples.status} t=${samples.time?.toFixed(2)} dur=${samples.duration}`);
  check("metadata: duration ≈ 10 s, analysis available", Math.abs(samples.duration - 10) < 0.5 && samples.source?.analysis === "available", JSON.stringify(samples.source));
  check("real analysis: bass responds to kick", samples.bass > 0.3, `max bass=${samples.bass.toFixed(3)}`);
  check("real analysis: highs respond to hats", samples.highs > 0.05, `max highs=${samples.highs.toFixed(3)}`);
  check("real analysis: onsets detected", samples.onset > 0.3, `max onset=${samples.onset.toFixed(3)}`);
  check("audio features reach the visual mapping engine", samples.mod > 0.05 && samples.active, `max |modulation|=${samples.mod.toFixed(3)}`);
  await page.screenshot({ path: `${OUT}02-playing.png` });

  /* ---------------- transport ---------------- */
  const transport = await page.evaluate(async () => {
    const a = window.__VANTA__.getAudioController();
    a.pause();
    await new Promise((r) => setTimeout(r, 300));
    const paused = a.getState().status;
    a.seek(5);
    await new Promise((r) => setTimeout(r, 300));
    const seeked = a.getState().currentTime;
    a.setVolume(0.3);
    a.setMuted(true);
    await new Promise((r) => setTimeout(r, 150));
    const vol = a.getState();
    a.setMuted(false);
    a.setVolume(0.8);
    await a.play();
    await new Promise((r) => setTimeout(r, 300));
    return { paused, seeked, volume: vol.volume, muted: vol.muted, resumed: a.getState().status };
  });
  check("pause / seek / volume / mute / resume", transport.paused === "paused" && Math.abs(transport.seeked - 5) < 0.6 && transport.muted && Math.abs(transport.volume - 0.3) < 0.01 && transport.resumed === "playing", JSON.stringify(transport));

  /* ---------------- layer editing changes the render ---------------- */
  const editStats = await page.evaluate(async () => {
    const s = window.__VANTA__.scene;
    const ids = s.getState().scene.layers.map((l) => l.id);
    for (const id of ids) s.getState().toggleLayerVisibility(id);
    await new Promise((r) => setTimeout(r, 400));
    return ids.length;
  });
  const hidden = await stillStats();
  await page.evaluate(async () => {
    const s = window.__VANTA__.scene;
    for (const l of s.getState().scene.layers) s.getState().toggleLayerVisibility(l.id);
    await new Promise((r) => setTimeout(r, 400));
  });
  const shown = await stillStats();
  check("toggling layer visibility changes the rendered frame", Math.abs(shown.mean - hidden.mean) > 1 || Math.abs(shown.variance - hidden.variance) > 20, `layers=${editStats} hidden mean=${hidden.mean.toFixed(1)} shown mean=${shown.mean.toFixed(1)}`);

  const colourEdit = await page.evaluate(async () => {
    const s = window.__VANTA__.scene;
    const layer = s.getState().scene.layers[0];
    const before = s.getState().past.length;
    s.getState().setLayerField(layer.id, "transform.scale", 2.5);
    s.getState().setLayerField(layer.id, "opacity", 0.6);
    await new Promise((r) => setTimeout(r, 300));
    const after = s.getState().scene.layers[0];
    return { scale: after.transform.scale, opacity: after.opacity, history: s.getState().past.length - before };
  });
  check("inspector-style edits update the shared scene (with undo history)", colourEdit.scale === 2.5 && colourEdit.opacity === 0.6 && colourEdit.history >= 1, JSON.stringify(colourEdit));

  /* ---------------- AI generation + refinement through the real API ---------------- */
  const ai = await page.evaluate(async () => {
    const s = window.__VANTA__.scene;
    const status = await (await fetch("/api/scene")).json();
    const prompt = "Create a futuristic red cyberpunk tunnel with pulsing neon rings and glowing particles that react strongly to bass.";
    const gen = await fetch("/api/scene", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "generate", prompt }) });
    const genJson = await gen.json();
    const res = s.getState().setScene(genJson.scene, { source: "ai" });
    const types = s.getState().scene.layers.map((l) => l.type);
    // manual edit, then a targeted refinement
    const keep = s.getState().scene.layers.find((l) => l.type === "particles") ?? s.getState().scene.layers[0];
    s.getState().setLayerField(keep.id, "opacity", 0.37);
    const ref = await fetch("/api/scene", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "refine", prompt: "make the tunnel faster and more blue", scene: s.getState().scene }),
    });
    const refJson = await ref.json();
    const applied = refJson.patch ? s.getState().applyPatch(refJson.patch, "ai") : { applied: 0 };
    const kept = s.getState().scene.layers.find((l) => l.id === keep.id)?.opacity;
    const bad = await fetch("/api/scene", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    return { status, genStatus: gen.status, source: genJson.source, ok: res.ok, types, refStatus: ref.status, applied: applied.applied, kept, badStatus: bad.status, summary: genJson.summary };
  });
  check("AI generate returns a valid scene (cyberpunk prompt)", ai.genStatus === 200 && ai.ok && ["tunnel", "rings", "particles"].every((t) => ai.types.includes(t)), `source=${ai.source} types=${ai.types.join(",")} llm=${ai.status.llmConfigured}`);
  check("AI refine applies a targeted patch and preserves manual edits", ai.refStatus === 200 && ai.applied > 0 && ai.kept === 0.37, `applied=${ai.applied} keptOpacity=${ai.kept}`);
  check("API rejects malformed requests", ai.badStatus === 400, `status=${ai.badStatus}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}03-ai-scene.png` });

  /* ---------------- presets ---------------- */
  const presets = await page.evaluate(() => window.__VANTA__.presets);
  for (const id of presets) {
    await page.evaluate((pid) => window.__VANTA__.scene.getState().loadPreset(pid), id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}04-preset-${id}.png` });
  }
  const presetCheck = await page.evaluate(() => ({ same: window.__canvas0 === window.__VANTA__.getRenderer().getCanvas(), status: window.__VANTA__.getAudioController().getState().status }));
  check(`all ${presets.length} presets load without recreating the renderer or stopping audio`, presetCheck.same && presetCheck.status === "playing", JSON.stringify(presetCheck));

  /* ---------------- presentation mode ---------------- */
  await page.evaluate(() => window.__VANTA__.editor.getState().setPresenting(true));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}05-presentation.png` });
  const pres = await page.evaluate(() => {
    const c = window.__VANTA__.getRenderer().getCanvas();
    const r = c.getBoundingClientRect();
    return { same: c === window.__canvas0, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, audio: window.__VANTA__.getAudioController().getState().status };
  });
  await page.evaluate(() => window.__VANTA__.editor.getState().setPresenting(false));
  check("presentation mode keeps the same canvas, fills the viewport, audio keeps playing", pres.same && pres.w >= pres.vw * 0.95 && pres.h >= pres.vh * 0.9 && pres.audio === "playing", JSON.stringify(pres));

  /* ---------------- video export ---------------- */
  for (const run of [1, 2]) {
    const rec = await page.evaluate(async () => {
      const ex = window.__VANTA__.getExportController();
      await ex.start({ fps: 30, videoBitsPerSecond: 6_000_000, includeAudio: true, maxDurationSec: 20 });
      await new Promise((r) => setTimeout(r, 3200));
      const result = await ex.stop();
      // verify the video contains changing frames
      const v = document.createElement("video");
      v.muted = true;
      v.src = result.url;
      await v.play();
      const c = new OffscreenCanvas(96, 60);
      const g = c.getContext("2d");
      const grab = () => {
        g.drawImage(v, 0, 0, 96, 60);
        return g.getImageData(0, 0, 96, 60).data;
      };
      await new Promise((r) => setTimeout(r, 400));
      const a = grab();
      await new Promise((r) => setTimeout(r, 1500));
      const b = grab();
      v.pause();
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      const buf = new Uint8Array(await result.blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { size: result.sizeBytes, mime: result.mimeType, hasAudio: result.hasAudio, durationMs: result.durationMs, name: result.fileName, frameDiff: diff / (a.length / 4), b64: btoa(bin) };
    });
    writeFileSync(`${OUT}recording-${run}.${rec.mime.includes("mp4") ? "mp4" : "webm"}`, Buffer.from(rec.b64, "base64"));
    check(`video export #${run}: non-empty ${rec.mime}, ~3 s, audio track`, rec.size > 20000 && rec.durationMs > 2500 && rec.hasAudio, `size=${rec.size} dur=${rec.durationMs}ms audio=${rec.hasAudio} file=${rec.name}`);
    check(`video export #${run}: frames are animated`, rec.frameDiff > 0.5, `mean frame diff=${rec.frameDiff.toFixed(2)}`);
  }

  /* ---------------- audio change does not recreate the renderer ---------------- */
  await fileInput.setInputFiles(wavPath2);
  await page.waitForTimeout(1500);
  const swap = await page.evaluate(() => ({ same: window.__canvas0 === window.__VANTA__.getRenderer().getCanvas(), label: window.__VANTA__.getAudioController().getState().source?.label, dur: window.__VANTA__.getAudioController().getState().duration }));
  check("replacing the track keeps the renderer and loads the new file", swap.same && Math.abs(swap.dur - 6) < 0.5, JSON.stringify(swap));

  /* ---------------- persistence ---------------- */
  await page.evaluate(() => window.__VANTA__.scene.getState().renameScene("E2E Persisted Scene"));
  await page.waitForTimeout(1600);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__VANTA__ && window.__VANTA__.getRenderer(), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => window.__VANTA__.scene.getState().scene.name);
  check("autosave restores the scene after reload", restored === "E2E Persisted Scene", `name=${restored}`);
  await page.screenshot({ path: `${OUT}06-after-reload.png` });
} catch (err) {
  check("smoke test ran to completion", false, err?.stack ?? String(err));
} finally {
  const relevant = consoleErrors.filter((e) => !/favicon|DevTools|Download the React DevTools/i.test(e));
  check("no console/page errors", relevant.length === 0, relevant.slice(0, 8).join(" | "));
  writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
