// Lumio colour engine: WebGL "looks" for the live camera, photos and filter buttons.
// One fragment shader does everything per pixel on the GPU: exposure, white balance,
// S-curve contrast, vibrance/saturation, split toning (colour in shadows and highlights),
// faded blacks, black & white, skin smoothing that keeps edges, glow, sharpening,
// vignette and film grain. Falls back to the old canvas filters when WebGL is missing.
'use strict';
(function () {
  const VS = `attribute vec2 p; varying vec2 uv; uniform vec4 crop; uniform float mirror;
    void main(){ vec2 t = p * .5 + .5; t.y = 1. - t.y; if (mirror > .5) t.x = 1. - t.x;
      uv = crop.xy + t * crop.zw; gl_Position = vec4(p, 0., 1.); }`;
  const FS = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform vec2 px; uniform vec2 outSize;
    uniform float exposure, contrast, sat, vib, temp, tint, fade, bw, smooth_, glow, sharp, vig, grain, seed;
    uniform vec3 shadowT, highT;
    float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tex, uv).rgb;
      // skin smoothing: average similar neighbours, only on skin tones, edges kept
      if (smooth_ > 0.) {
        float skin = smoothstep(.02, .12, c.r - c.b) * smoothstep(.0, .08, c.r - c.g) * step(.15, c.r);
        if (skin > 0.) {
          vec3 acc = c; float w = 1.;
          for (int i = 0; i < 12; i++) {
            float a = float(i) * .5236; vec2 o = vec2(cos(a), sin(a)) * px * (3. + mod(float(i), 2.) * 3.);
            vec3 s = texture2D(tex, uv + o).rgb; float k = 1. - smoothstep(.04, .14, length(s - c));
            acc += s * k; w += k;
          }
          c = mix(c, acc / w, smooth_ * skin);
        }
      }
      // sharpening (unsharp mask with 4 neighbours)
      if (sharp > 0.) {
        vec3 b = (texture2D(tex, uv + vec2(px.x, 0.)).rgb + texture2D(tex, uv - vec2(px.x, 0.)).rgb +
                  texture2D(tex, uv + vec2(0., px.y)).rgb + texture2D(tex, uv - vec2(0., px.y)).rgb) * .25;
        c += (c - b) * sharp * 1.6;
      }
      // glow: soft bright halo
      if (glow > 0.) {
        vec3 g = vec3(0.);
        for (int i = 0; i < 8; i++) { float a = float(i) * .785; g += max(texture2D(tex, uv + vec2(cos(a), sin(a)) * px * 14.).rgb - .55, 0.); }
        c += g / 8. * glow * 2.2;
      }
      c *= exp2(exposure);
      c.r += temp * .08; c.b -= temp * .08; c.g += tint * .06; c.rb -= tint * .03;
      c = clamp(c, 0., 1.);
      vec3 sc = c * c * (3. - 2. * c);                      // S-curve
      c = contrast >= 0. ? mix(c, sc, contrast) : mix(c, vec3(.5), -contrast * .5);
      float l = luma(c);
      float m = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      c = mix(vec3(l), c, 1. + vib * (1. - m));              // vibrance: boosts dull colours most
      c = mix(vec3(luma(c)), c, 1. + sat);
      if (bw > 0.) c = mix(c, vec3(luma(c)), bw);            // black & white first, so sepia toning shows
      l = luma(c);
      c += shadowT * (1. - smoothstep(0., .55, l)) * .35 + highT * smoothstep(.45, 1., l) * .35;   // split toning
      c = c * (1. - fade) + fade * .22;                      // faded / matte blacks
      vec2 q = gl_FragCoord.xy / outSize - .5;
      c *= 1. - vig * smoothstep(.25, .85, length(q * vec2(1., outSize.y / outSize.x) * 1.15));
      if (grain > 0.) c += (hash(gl_FragCoord.xy) - .5) * grain * .25;
      gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
    }`;
  const ZERO = { exposure: 0, contrast: 0, sat: 0, vib: 0, temp: 0, tint: 0, fade: 0, bw: 0, smooth_: 0, glow: 0, sharp: 0, vig: 0, grain: 0, shadowT: [0, 0, 0], highT: [0, 0, 0] };

  function make(canvas) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return null;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const U = {}; const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(pr, i); U[u.name] = gl.getUniformLocation(pr, u.name); }
    const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    return {
      gl, canvas, max,
      // draw `src` (video, image, canvas) through `look` into this canvas at w x h
      draw(src, look, w, h, o = {}) {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
        const sw = src.videoWidth || src.naturalWidth || src.width, shh = src.videoHeight || src.naturalHeight || src.height;
        const cr = o.crop || { x: 0, y: 0, w: sw, h: shh };
        gl.uniform4f(U.crop, cr.x / sw, cr.y / shh, cr.w / sw, cr.h / shh);
        gl.uniform1f(U.mirror, o.mirror ? 1 : 0);
        // neighbour distance: about one output pixel, measured in the source image
        gl.uniform2f(U.px, Math.max(1, cr.w / w) / sw, Math.max(1, cr.h / h) / shh);
        gl.uniform2f(U.outSize, w, h);
        const L = Object.assign({}, ZERO, look || {});
        for (const k of ['exposure', 'contrast', 'sat', 'vib', 'temp', 'tint', 'fade', 'bw', 'smooth_', 'glow', 'sharp', 'vig', 'grain']) gl.uniform1f(U[k], L[k]);
        gl.uniform3fv(U.shadowT, L.shadowT); gl.uniform3fv(U.highT, L.highT);
        gl.uniform1f(U.seed, o.still ? 1.7 : (performance.now() % 1000) / 100);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return canvas;
      }
    };
  }

  let live = null, still = null, small = null;
  const ok = (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })();
  window.Grade = {
    ok,
    // live camera: the given (on-screen) canvas
    live(canvas) { if (!ok) return null; if (!live || live.canvas !== canvas) live = make(canvas); return live; },
    // photos: returns a 2D canvas (so the rest of the pipeline can draw on it)
    still(src, look, w, h, o = {}) {
      still = still || make(document.createElement('canvas'));
      const k = Math.min(1, still.max / Math.max(w, h));      // stay within the GPU's limit
      still.draw(src, look, Math.round(w * k), Math.round(h * k), Object.assign({ still: true }, o));
      const out = document.createElement('canvas'); out.width = Math.round(w); out.height = Math.round(h);
      const x = out.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(still.canvas, 0, 0, out.width, out.height);
      return out;
    },
    // small previews for the filter buttons (draws into `target`)
    chip(src, look, target, o = {}) {
      small = small || make(document.createElement('canvas'));
      small.draw(src, look, target.width, target.height, Object.assign({ still: true }, o));
      target.getContext('2d').drawImage(small.canvas, 0, 0);
    }
  };
})();
