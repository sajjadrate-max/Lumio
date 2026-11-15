// Lumio: face tracking and person cut-out in a background thread, so the camera screen never waits.
// Built (with MediaPipe Tasks Vision, Apache-2.0) into lib/face-worker.js:
//   npx esbuild src/face-worker.src.js --bundle --format=iife --minify --outfile=lib/face-worker.js
// A classic (non-module) worker, because MediaPipe loads its wasm loader with importScripts.
// Messages: { type:'init', kind:'face'|'seg', wasm, model } -> { type:'ready'|'error', kind }
//           { type:'frame', id, ts, bitmap, face, seg } -> { type:'lm', id, lm, mask, mw, mh }
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

let files = null, lm = null, seg = null;
async function make(Cls, model, extra) {
  let err = null;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const opts = Object.assign({ baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO' }, extra);
      if (delegate === 'GPU') opts.canvas = new OffscreenCanvas(1, 1);
      return await Cls.createFromOptions(files, opts);
    } catch (x) { err = x; }
  }
  throw err || new Error('vision');
}
self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      files = files || await FilesetResolver.forVisionTasks(m.wasm);
      if (m.kind === 'seg') seg = seg || await make(ImageSegmenter, m.model, { outputConfidenceMasks: true, outputCategoryMask: false });
      else lm = lm || await make(FaceLandmarker, m.model, { numFaces: 3 });
      self.postMessage({ type: 'ready', kind: m.kind });
    } catch (x) { self.postMessage({ type: 'error', kind: m.kind, msg: String(x && x.message || x) }); }
    return;
  }
  if (m.type === 'frame') {
    let out = null, mask = null, mw = 0, mh = 0;
    if (m.face && lm) {
      try {
        const r = lm.detectForVideo(m.bitmap, m.ts);
        // several faces: use the biggest one (closest to the camera)
        let l = null, best = 0;
        for (const f of (r && r.faceLandmarks) || []) { const w = Math.abs(f[454].x - f[234].x) + Math.abs(f[152].y - f[10].y); if (w > best) { best = w; l = f; } }
        if (l) { out = new Float32Array(l.length * 3); l.forEach((p, i) => { out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }); }
      } catch (x) { out = null; }
    }
    if (m.seg && seg) {
      try {
        const r = seg.segmentForVideo(m.bitmap, m.ts), cm = r.confidenceMasks, pm = cm[cm.length - 1];   // last mask = the person
        const f = pm.getAsFloat32Array(); mw = pm.width; mh = pm.height;
        mask = new Uint8ClampedArray(mw * mh * 4);
        for (let i = 0; i < f.length; i++) mask[i * 4 + 3] = f[i] * 255;
        r.close && r.close();
      } catch (x) { mask = null; }
    }
    m.bitmap.close();
    const tr = []; if (out) tr.push(out.buffer); if (mask) tr.push(mask.buffer);
    self.postMessage({ type: 'lm', id: m.id, lm: out, mask, mw, mh }, tr);
  }
};
