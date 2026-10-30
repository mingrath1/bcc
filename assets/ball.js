// A WebGL ball that rolls along the gap between masthead and article, leaving paint on the page's floor.
//
// Coordinates: x runs right, y runs down the page, z points from the ball into the floor. Trail points are in "floor"
// coordinates: the page's y, plus how far the reader has rolled on past the end of the page.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const orb = document.createElement("canvas");
  const floor = document.createElement("canvas");
  const orbGl = orb.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
  const floorGl = floor.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
  const tail = document.querySelector(".tailspace");
  if (!orbGl || !floorGl || !tail) return;

  const root = document.documentElement;
  const narrow = matchMedia("(max-width: 780px)");
  const mouseUser = matchMedia("(hover: hover) and (pointer: fine)");
  const shade = document.createElement("div");
  const grip = document.createElement("button");
  const home = document.createElement("div");
  orb.className = "orb";
  floor.className = "floor";
  shade.className = "orb-shadow";
  grip.className = "orb-grip";
  home.className = "orb-home";
  grip.type = "button";
  grip.setAttribute("aria-label", "Play with the ball. Press Escape to send it back.");
  for (const part of [orb, floor, shade, home]) part.setAttribute("aria-hidden", "true");

  // --- Tuning ---
  const PULL = 64, DRAG = 10.5, FALL = 2500, HOP = 740, REBOUND = 0.42, MAX_SPEED = 2600;
  const TILT_PULL = 2300, TILT_DRAG = 0.85;
  const INK_LIFE = 8000, DAB_LIMIT = 200000;
  const MAX_GROW = 3, STAMP_HOLD = 0.4, KEPT_SCREENS = 18;
  const LAMP_REST = unit3([-0.46, -0.56, -0.69]), LAMP_REACH = 260;
  const FILM_PAINT = [[0.31, 0.84, 0.89], [0.96, 0.7, 0.3]];

  // --- Small maths ---
  function unit3([x, y, z]) {
    const size = Math.hypot(x, y, z) || 1;
    return [x / size, y / size, z / size];
  }
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const qTurn = ([x, y, z, w], [a, b, c]) => {
    const u = [y * c - z * b, z * a - x * c, x * b - y * a];
    const v = [y * u[2] - z * u[1], z * u[0] - x * u[2], x * u[1] - y * u[0]];
    return [a + 2 * (w * u[0] + v[0]), b + 2 * (w * u[1] + v[1]), c + 2 * (w * u[2] + v[2])];
  };
  const qBack = ([x, y, z, w]) => [-x, -y, -z, w];
  const qSpin = (q, spin, dt) => {
    const speed = Math.hypot(...spin);
    if (speed * dt < 1e-6) return q;
    const half = (speed * dt) / 2;
    const s = Math.sin(half) / speed;
    const [a, b, c, d] = [spin[0] * s, spin[1] * s, spin[2] * s, Math.cos(half)];
    const [x, y, z, w] = q;
    const next = [
      d * x + a * w + b * z - c * y,
      d * y - a * z + b * w + c * x,
      d * z + a * y - b * x + c * w,
      d * w - a * x - b * y - c * z,
    ];
    const size = Math.hypot(...next);
    return next.map((v) => v / size);
  };
  // Columns of the matrix that takes a world direction into the ball's own frame.
  const worldToBall = (q) => {
    const back = qBack(q);
    return [...qTurn(back, [1, 0, 0]), ...qTurn(back, [0, 1, 0]), ...qTurn(back, [0, 0, 1])];
  };

  const fromHsl = (h, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  };
  const fromCss = (value) => {
    const probe = document.createElement("canvas").getContext("2d");
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    return [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v / 255);
  };
  const toCss = (rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")})`;

  // --- Shaders ---
  const prelude = "#version 300 es\nprecision highp float;\n";
  const toFloor = `
    uniform vec2 sheet;
    uniform float origin;
    vec4 sheetPosition(vec2 point) {
      return vec4(point.x / sheet.x * 2.0 - 1.0, 1.0 - (point.y - origin) / sheet.y * 2.0, 0.0, 1.0);
    }`;
  const markings = `
    uniform sampler2D stampArt;
    uniform sampler2D initialsArt;
    uniform float capSine;
    uniform float initialsReach;
    uniform bool hasStamp;
    uniform bool hasInitials;
    float stampAt(vec3 body) {
      if (!hasStamp || capSine <= 0.0 || body.z <= sqrt(1.0 - capSine * capSine)) return 0.0;
      vec2 uv = vec2(body.x, -body.y) / capSine;
      return (abs(uv.x) >= 1.0 || abs(uv.y) >= 1.0) ? 0.0 : texture(stampArt, uv * 0.5 + 0.5).a;
    }
    float initialsAt(vec3 body) {
      if (!hasInitials || body.z >= 0.0) return 0.0;
      vec2 uv = body.xy / initialsReach;
      return (abs(uv.x) >= 1.0 || abs(uv.y) >= 1.0) ? 0.0 : texture(initialsArt, uv * 0.5 + 0.5).a;
    }`;

  const ORB_VERTEX = `${prelude}
    in vec2 corner;
    out vec2 spot;
    void main() {
      spot = vec2(corner.x, -corner.y);
      gl_Position = vec4(corner, 0.0, 1.0);
    }`;
  const ORB_FRAGMENT = `${prelude}
    in vec2 spot;
    out vec4 result;
    uniform mat3 toBall;
    uniform vec3 paint;
    uniform vec3 paper;
    uniform vec3 stampInk;
    uniform vec3 bands[8];
    uniform int bandCount;
    uniform bool blendBands;
    uniform vec3 lamp;
    uniform float shading;
    uniform float spotlight;
    ${markings}
    void main() {
      float radial = length(spot);
      if (radial >= 1.0) discard;
      vec3 facing = vec3(spot, -sqrt(1.0 - radial * radial));
      vec3 body = toBall * facing;
      vec3 tint = paint;
      float capEdge = capSine > 0.0 ? sqrt(1.0 - capSine * capSine) : 2.0;
      if (bandCount > 0) {
        float along = clamp(acos(clamp(-body.z, -1.0, 1.0)) / acos(clamp(-capEdge, -1.0, 1.0)), 0.0, 1.0);
        if (blendBands) {
          float at = along * float(bandCount - 1);
          int low = min(int(at), bandCount - 2);
          tint = mix(bands[low], bands[low + 1], at - float(low));
        } else {
          tint = bands[min(int(along * float(bandCount)), bandCount - 1)];
        }
      }
      float capWidth = max(fwidth(body.z), 0.001);
      tint = mix(tint, paper, smoothstep(capEdge - capWidth, capEdge + capWidth, body.z));
      tint = mix(tint, stampInk, stampAt(body));
      tint = mix(tint, vec3(1.0), initialsAt(body));
      float light = mix(1.0, 0.45 + 0.72 * max(dot(facing, lamp), 0.0), shading);
      vec3 halfway = normalize(lamp + vec3(0.0, 0.0, -1.0));
      float shine = pow(max(dot(facing, halfway), 0.0), 18.0) * 0.32 * spotlight;
      float edge = 1.0 - smoothstep(1.0 - 2.0 * fwidth(radial), 1.0, radial);
      result = vec4(min(tint * light + shine, 1.0) * edge, edge);
    }`;
  const DAB_VERTEX = `${prelude}
    in vec2 corner;
    in vec2 center;
    in float size;
    in vec4 pole;
    in float ballSize;
    in vec3 tint;
    uniform float crisp;
    out vec2 offset;
    flat out float vSize;
    flat out vec4 vPole;
    flat out float vBall;
    flat out vec3 vTint;
    ${toFloor}
    void main() {
      offset = corner * (size + 1.0 / crisp);
      vSize = size;
      vPole = pole;
      vBall = ballSize;
      vTint = tint;
      gl_Position = sheetPosition(center + offset);
    }`;
  const DAB_FRAGMENT = `${prelude}
    in vec2 offset;
    flat in float vSize;
    flat in vec4 vPole;
    flat in float vBall;
    flat in vec3 vTint;
    uniform float crisp;
    out vec4 result;
    void main() {
      float cover = clamp((vSize - length(offset)) * crisp + 0.5, 0.0, 1.0);
      vec3 toward = normalize(vec3(offset / vBall, 1.0));
      cover *= clamp((vPole.w - dot(toward, vPole.xyz)) * vBall * crisp + 0.5, 0.0, 1.0);
      if (cover <= 0.0) discard;
      result = vec4(vTint * cover, cover);
    }`;
  const DROP_VERTEX = `${prelude}
    in vec2 corner;
    in vec2 center;
    in vec2 radii;
    in float angle;
    in float alpha;
    in vec3 tint;
    out vec2 inside;
    flat out float vAlpha;
    flat out vec3 vTint;
    ${toFloor}
    void main() {
      inside = corner;
      vAlpha = alpha;
      vTint = tint;
      vec2 stretched = corner * radii;
      float c = cos(angle), s = sin(angle);
      gl_Position = sheetPosition(center + vec2(c * stretched.x - s * stretched.y, s * stretched.x + c * stretched.y));
    }`;
  const DROP_FRAGMENT = `${prelude}
    in vec2 inside;
    flat in float vAlpha;
    flat in vec3 vTint;
    out vec4 result;
    void main() {
      float radial = length(inside);
      float cover = (1.0 - smoothstep(1.0 - 2.0 * fwidth(radial), 1.0, radial)) * vAlpha;
      if (cover <= 0.0) discard;
      result = vec4(vTint * cover, cover);
    }`;
  const PRINT_VERTEX = `${prelude}
    in vec2 corner;
    in vec2 center;
    in vec3 reach;
    in float alpha;
    in vec3 columnX;
    in vec3 columnY;
    in vec3 columnZ;
    in vec3 tint;
    uniform float ballSize;
    out vec2 ground;
    flat out mat3 vBall;
    flat out float vAlpha;
    flat out vec3 vTint;
    ${toFloor}
    void main() {
      vec2 along = reach.xy * reach.z;
      vec2 across = vec2(-reach.y, reach.x) * ballSize * 0.92;
      ground = along * corner.x + across * corner.y;
      vBall = mat3(columnX, columnY, columnZ);
      vAlpha = alpha;
      vTint = tint;
      gl_Position = sheetPosition(center + ground);
    }`;
  const PRINT_FRAGMENT = `${prelude}
    in vec2 ground;
    flat in mat3 vBall;
    flat in float vAlpha;
    flat in vec3 vTint;
    uniform float ballSize;
    uniform bool erasing;
    out vec4 result;
    ${markings}
    void main() {
      vec3 body = normalize(vBall * vec3(ground / ballSize, 1.0));
      float cover = (erasing ? initialsAt(body) : stampAt(body)) * vAlpha;
      if (cover <= 0.0) discard;
      result = vec4(vTint * cover, cover);
    }`;

  const program = (gl, vertex, fragment) => {
    const made = gl.createProgram();
    for (const [kind, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(made, shader);
    }
    gl.linkProgram(made);
    if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(made));
    const uniforms = new Proxy({}, { get: (cache, name) => (cache[name] ??= gl.getUniformLocation(made, name)) });
    return { made, uniforms };
  };
  const mesh = (gl, { made, uniforms }, fields = []) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const cornerSlot = gl.getAttribLocation(made, "corner");
    gl.enableVertexAttribArray(cornerSlot);
    gl.vertexAttribPointer(cornerSlot, 2, gl.FLOAT, false, 0, 0);
    let instances = null;
    const floats = fields.reduce((sum, [, count]) => sum + count, 0);
    if (fields.length) {
      instances = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      let start = 0;
      for (const [name, count] of fields) {
        const slot = gl.getAttribLocation(made, name);
        if (slot >= 0) {
          gl.enableVertexAttribArray(slot);
          gl.vertexAttribPointer(slot, count, gl.FLOAT, false, floats * 4, start);
          gl.vertexAttribDivisor(slot, 1);
        }
        start += count * 4;
      }
    }
    gl.bindVertexArray(null);
    return { made, uniforms, vao, instances, floats };
  };
  const picture = (gl, source, old) => {
    if (old) gl.deleteTexture(old);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_2D, key, value);
    }
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return texture;
  };

  // --- GPU state, rebuilt if a context is lost ---
  let orbGpu = null;
  let floorGpu = null;
  const art = { stamps: {}, initials: null };

  const uploadArt = () => {
    if (orbGpu) {
      for (const [name, canvas] of Object.entries(art.stamps)) orbGpu.stamps[name] = picture(orbGl, canvas, orbGpu.stamps[name]);
      orbGpu.initials = picture(orbGl, art.initials, orbGpu.initials);
    }
    if (floorGpu) {
      for (const [name, canvas] of Object.entries(art.stamps)) floorGpu.stamps[name] = picture(floorGl, canvas, floorGpu.stamps[name]);
      floorGpu.initials = picture(floorGl, art.initials, floorGpu.initials);
    }
    lastPainted = "";
  };
  const buildOrbGpu = () => {
    orbGpu = { ...mesh(orbGl, program(orbGl, ORB_VERTEX, ORB_FRAGMENT)), stamps: {}, initials: null };
    uploadArt();
  };
  const buildFloorGpu = () => {
    const gl = floorGl;
    gl.enable(gl.BLEND);
    floorGpu = {
      dabs: mesh(gl, program(gl, DAB_VERTEX, DAB_FRAGMENT), [["center", 2], ["size", 1], ["pole", 4], ["ballSize", 1], ["tint", 3]]),
      drops: mesh(gl, program(gl, DROP_VERTEX, DROP_FRAGMENT), [["center", 2], ["radii", 2], ["angle", 1], ["alpha", 1], ["tint", 3]]),
      imprints: mesh(gl, program(gl, PRINT_VERTEX, PRINT_FRAGMENT), [["center", 2], ["reach", 3], ["alpha", 1], ["columnX", 3], ["columnY", 3], ["columnZ", 3], ["tint", 3]]),
      stamps: {},
      initials: null,
    };
    uploadArt();
  };

  // --- Look ---
  const look = { spotlight: false, shading: false, shadow: false, initials: true, stamp: "brain", size: 25, paint: "blue", own: "#e0245e" };
  const STAMP_NAMES = { brain: "Brain", sigmoid: "Sigmoid curve", hole: "Hole" };
  const palettes = { stripes: [], blend: [], film: FILM_PAINT };
  const paperColor = fromCss(getComputedStyle(document.body).backgroundColor);
  const blue = fromCss(getComputedStyle(root).getPropertyValue("--blue").trim());
  let solid = blue;
  let roll = 0;
  const bandsNow = () => palettes[look.paint] ?? [];
  const stampInk = () => {
    const bands = bandsNow();
    if (!bands.length) return solid;
    return bands.reduce((darkest, color) => (color[0] + color[1] + color[2] < darkest[0] + darkest[1] + darkest[2] ? color : darkest));
  };

  const shuffle = (kind) => {
    const start = Math.random() * 360;
    const count = 3 + Math.floor(Math.random() * 3);
    const turn = 25 + Math.random() * 70;
    palettes[kind] = Array.from({ length: count }, (_, i) => fromHsl((start + i * turn) % 360, 0.65 + Math.random() * 0.3, 0.32 + (i / count) * 0.36));
    const stops = palettes[kind].map((color, i) => (kind === "blend" ? toCss(color) : `${toCss(color)} ${(i * 100) / count}% ${((i + 1) * 100) / count}%`));
    panel?.style.setProperty(`--${kind}-dab`, `conic-gradient(${stops.join(", ")})`);
  };

  const capSine = () => {
    const edge = 1 - look.size / 50;
    return Math.sqrt(1 - edge * edge) / grow ** STAMP_HOLD;
  };
  const capEdge = () => Math.sqrt(Math.max(0, 1 - capSine() ** 2));

  // Paint under the ball right now. Striped paints give the colour of the band touching the floor.
  const contactInk = () => {
    const bands = bandsNow();
    if (!bands.length) return solid;
    const z = qTurn(qBack(turnState), [0, 0, 1])[2];
    const span = Math.acos(clamp(-capEdge(), -1, 1)) || 1;
    const along = clamp(Math.acos(clamp(-z, -1, 1)) / span, 0, 1);
    if (look.paint !== "blend") return bands[Math.min(Math.floor(along * bands.length), bands.length - 1)];
    const at = along * (bands.length - 1);
    const low = Math.min(Math.floor(at), bands.length - 2);
    return bands[low].map((value, i) => lerp(value, bands[low + 1][i], at - low));
  };

  // --- State ---
  let unit = 24, radius = 24, grow = 1, crisp = 1;
  let spot = null, speedXY = [0, 0], airHeight = 0, airSpeed = 0, turnState = [0, 0, 0, 1], spin = [0, 0, 0];
  let parked = true, armed = false, chase = null, pointerAt = null, lampAt = null, lamp = LAMP_REST, tilt = null, level = null;
  let trail = [], drops = [], imprints = [], inkWidth = 0;
  let pageHeight = 0, tailHeight = 0, sheetWidth = 0, sheetHeight = 0, origin = null;
  let plunge = 0, depth = 0, coasting = 0, rewind = 0, deepest = 0, lastCamera = 0;
  let swipe = null, flick = 0, touching = false, wheeling = false, lastFlow = null;
  let raf = 0, clock = 0, lastPainted = "";
  let panel = null, toggle = null;
  let dabData = new Float32Array(11 * 8192), dropData = new Float32Array(9 * 512), printData = new Float32Array(18 * 2048);

  const camera = () => scrollY + depth;
  const viewHeight = () => root.clientHeight;
  const pastEnd = () => (tailHeight ? Math.max(0, scrollY - (pageHeight - tailHeight - innerHeight)) + depth : 0);
  const atBottom = () => scrollY + innerHeight >= root.scrollHeight - 2;
  const easedOut = (distance) => smooth(Math.min(pastEnd() / distance, 1));
  const tailStart = () => pageHeight - tailHeight;

  const lane = () => {
    if (narrow.matches) return unit * 1.5;
    const a = document.querySelector(".masthead").getBoundingClientRect();
    const b = document.querySelector(".body").getBoundingClientRect();
    return (a.right + b.left) / 2;
  };

  const chapterInFocus = () => {
    if (narrow.matches) return null; // No chapter focus without a lane beside the words.
    if (mouseUser.matches) {
      if (!pointerAt) return null;
      return document.elementsFromPoint(...pointerAt).map((node) => node.closest(".chapter")).find(Boolean) ?? null;
    }
    const line = viewHeight() / 2;
    return [...document.querySelectorAll(".chapter")].find((node) => {
      const box = node.getBoundingClientRect();
      return box.top <= line && box.bottom > line;
    }) ?? null;
  };

  // Where the ball rests, in viewport coordinates.
  const restingPlace = (chapter = null) => {
    const top = unit * 2.5, bottom = viewHeight() - radius * 2.5;
    let x = lane(), y;
    if (chapter) {
      const box = chapter.getBoundingClientRect();
      y = clamp((Math.max(box.top, 0) + Math.min(box.bottom, viewHeight())) / 2, top, bottom);
    } else {
      const name = document.querySelector(".masthead__name")?.getBoundingClientRect();
      const span = Math.max(1, pageHeight - tailHeight - innerHeight);
      const progress = clamp(scrollY / span, 0, 1);
      const first = name ? (name.top + name.bottom) / 2 + (narrow.matches ? scrollY : 0) : bottom;
      y = lerp(first, bottom, progress);
    }
    const run = pastEnd();
    if (!run) return [x, y];
    // In the run-out the ball leaves its lane for the middle of the page, and wanders.
    const width = root.clientWidth;
    const drift = easedOut(tailHeight + innerHeight);
    const wander = Math.sin(run / 290) * 0.52 + Math.sin(run / 181 + 2.1) * 0.27 + Math.sin(run / 613 + 0.6) * 0.21;
    x = clamp(lerp(x, width / 2, drift) + wander * width * 0.31 * drift, radius * 1.5, width - radius * 1.5);
    y = lerp(y, viewHeight() / 2, easedOut(innerHeight * 8));
    return [x, y];
  };

  // --- Layout ---
  const measure = () => {
    crisp = devicePixelRatio || 1;
    unit = orb.offsetWidth / 2 || 24;
    radius = unit * grow;
    pageHeight = Math.max(innerHeight, document.body.offsetHeight);
    tailHeight = tail.offsetHeight;
    const width = root.clientWidth;
    const height = Math.min(Math.ceil(innerHeight * 1.6), pageHeight);
    if (width !== sheetWidth || height !== sheetHeight) {
      sheetWidth = width;
      sheetHeight = height;
      floor.width = width * crisp;
      floor.height = height * crisp;
      floor.style.width = `${width}px`;
      floor.style.height = `${height}px`;
    }
    origin = null;
    const size = Math.ceil(unit * 2 * MAX_GROW * crisp);
    if (orb.width !== size) {
      orb.width = orb.height = size;
      lastPainted = "";
    }
  };

  const moveSheet = () => {
    const view = camera();
    const lowest = Math.max(0, pageHeight - sheetHeight) + depth;
    if (origin === null || origin > lowest || view < origin || view + innerHeight > origin + sheetHeight) {
      origin = clamp(view - (sheetHeight - innerHeight) / 2, 0, lowest);
    }
    floor.style.translate = `0 ${origin - depth}px`;
  };

  // --- Paint ---
  const inkLife = (item, now) => (item.kept && !item.fading ? 1 : 1 - (now - item.time) / INK_LIFE);

  const curve = (a, b, c, d, t) => {
    const t2 = t * t, t3 = t2 * t;
    const axis = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
    return [axis(a.x, b.x, c.x, d.x), axis(a.y, b.y, c.y, d.y)];
  };

  const fill = (mesh, data, count) => {
    const gl = floorGl;
    gl.useProgram(mesh.made);
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instances);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * mesh.floats), gl.STREAM_DRAW);
    gl.uniform2f(mesh.uniforms.sheet, sheetWidth, sheetHeight);
    gl.uniform1f(mesh.uniforms.origin, origin);
  };
  const bindMarkings = (gl, holder, uniforms) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, holder.stamps[look.stamp] ?? holder.stamps.brain ?? null);
    gl.uniform1i(uniforms.stampArt, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, holder.initials);
    gl.uniform1i(uniforms.initialsArt, 1);
    gl.uniform1f(uniforms.capSine, capSine());
    gl.uniform1f(uniforms.initialsReach, 0.62 / grow ** STAMP_HOLD);
    gl.uniform1i(uniforms.hasStamp, look.stamp !== "hole");
    gl.uniform1i(uniforms.hasInitials, look.initials);
  };

  const paintFloor = (now) => {
    const gl = floorGl;
    if (gl.isContextLost() || !floorGpu) return;
    moveSheet();
    gl.viewport(0, 0, floor.width, floor.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const margin = radius * 2.5, high = origin - margin, low = origin + sheetHeight + margin;

    let count = 0;
    for (let i = 1; i < trail.length && count < DAB_LIMIT; i++) {
      const b = trail[i];
      if (b.gap) continue;
      const a = trail[i - 1];
      if (Math.max(a.y, b.y) < high || Math.min(a.y, b.y) > low) continue;
      const fade = Math.sqrt(Math.max(inkLife(b, now), 0));
      const stepSize = Math.max(1.25, Math.min(a.width, b.width) * fade * 0.22);
      const parts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepSize));
      const before = i > 1 && !a.gap ? trail[i - 2] : a;
      const after = trail[i + 1] && !trail[i + 1].gap ? trail[i + 1] : b;
      if (dabData.length < (count + parts + 1) * 11) {
        const larger = new Float32Array(dabData.length * 2);
        larger.set(dabData);
        dabData = larger;
      }
      for (let k = 1; k <= parts; k++) {
        const t = k / parts;
        const [x, y] = curve(before, a, b, after, t);
        dabData.set([
          x, y, (lerp(a.width, b.width, t) / 2) * fade,
          lerp(a.pole[0], b.pole[0], t), lerp(a.pole[1], b.pole[1], t), lerp(a.pole[2], b.pole[2], t), lerp(a.edge, b.edge, t),
          Math.max(lerp(a.ball, b.ball, t) * fade, 0.001),
          b.ink[0], b.ink[1], b.ink[2],
        ], count * 11);
        count++;
      }
    }
    if (count) {
      fill(floorGpu.dabs, dabData, count);
      gl.uniform1f(floorGpu.dabs.uniforms.crisp, crisp);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }

    const shownDrops = drops.filter(({ y, reach }) => y + reach >= high && y - reach <= low);
    if (shownDrops.length) {
      if (dropData.length < shownDrops.length * 9) dropData = new Float32Array(shownDrops.length * 18);
      shownDrops.forEach((drop, i) => {
        dropData.set([drop.x, drop.y, drop.rx, drop.ry, drop.angle, inkLife(drop, now), ...drop.ink], i * 9);
      });
      fill(floorGpu.drops, dropData, shownDrops.length);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, shownDrops.length);
    }

    const shownImprints = imprints.filter(({ y }) => y >= high && y <= low);
    if (shownImprints.length) {
      if (printData.length < shownImprints.length * 18) printData = new Float32Array(shownImprints.length * 36);
      shownImprints.forEach((print, i) => {
        printData.set([print.x, print.y, print.dir[0], print.dir[1], print.length, inkLife(print, now), ...print.toBall, ...print.ink], i * 18);
      });
      const mesh = floorGpu.imprints;
      fill(mesh, printData, shownImprints.length);
      gl.uniform1f(mesh.uniforms.ballSize, radius);
      bindMarkings(gl, floorGpu, mesh.uniforms);
      gl.uniform1i(mesh.uniforms.erasing, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, shownImprints.length);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(mesh.uniforms.erasing, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, shownImprints.length);
    }
  };

  const paintOrb = () => {
    const gl = orbGl;
    if (gl.isContextLost() || !orbGpu) return;
    const signature = [turnState, airHeight, lamp, grow, solid, bandsNow().length ? bandsNow() : "", JSON.stringify(look)].join();
    if (signature === lastPainted) return;
    lastPainted = signature;
    const { made, uniforms, vao } = orbGpu;
    gl.viewport(0, 0, orb.width, orb.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(made);
    gl.bindVertexArray(vao);
    gl.uniformMatrix3fv(uniforms.toBall, false, worldToBall(turnState));
    gl.uniform3fv(uniforms.paint, solid);
    gl.uniform3fv(uniforms.paper, paperColor);
    gl.uniform3fv(uniforms.stampInk, stampInk());
    const bands = bandsNow().slice(0, 8);
    gl.uniform1i(uniforms.bandCount, bands.length);
    gl.uniform1i(uniforms.blendBands, look.paint === "blend");
    if (bands.length) gl.uniform3fv(uniforms.bands, bands.flat());
    gl.uniform3fv(uniforms.lamp, lamp);
    gl.uniform1f(uniforms.shading, look.shading ? 1 : 0);
    gl.uniform1f(uniforms.spotlight, look.spotlight ? 1 : 0);
    bindMarkings(gl, orbGpu, uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const place = () => {
    const x = spot[0], y = spot[1] - camera();
    orb.style.translate = `${x - unit}px ${y - unit}px`;
    orb.style.scale = String((1 + airHeight / 480) * grow);
    grip.style.translate = orb.style.translate;
    grip.style.scale = String(grow);
    const reach = shade.offsetWidth / 2;
    const away = Math.min(1.5, Math.hypot(lamp[0], lamp[1]) / Math.max(-lamp[2], 0.01));
    const heading = Math.atan2(-lamp[1], -lamp[0]);
    const cast = away * (radius * 0.55 + airHeight * 0.7);
    shade.style.translate = `${x - reach + Math.cos(heading) * cast}px ${y - reach + Math.sin(heading) * cast}px`;
    shade.style.scale = String((1 + (airHeight * 0.25) / Math.max(reach, 1)) * grow);
    shade.style.opacity = String(1 / (1 + airHeight / 70));
    const [restX, restY] = restingPlace();
    const ring = home.offsetWidth / 2;
    home.style.translate = `${restX - ring}px ${restY - ring}px`;
  };

  // --- Ink events ---
  const addDrop = (drop) => drops.push({ ...drop, time: clock, kept: drop.y >= tailStart() && tailHeight > 0 });
  const splatter = (angle, spread, amount, reach) => {
    const ink = contactInk();
    for (let n = 0; n < amount; n++) {
      const heading = angle + (Math.random() - 0.5) * spread;
      const distance = radius * 0.6 + unit * Math.random() * reach;
      const x = spot[0] + Math.cos(heading) * distance;
      const y = spot[1] + Math.sin(heading) * distance;
      const size = unit * (0.03 + Math.random() ** 2 * 0.13);
      if (Math.random() < 0.28) {
        // A streak thrown outward: a short chain of shrinking drops.
        const length = unit * (0.35 + Math.random() * 0.55);
        const bend = (Math.random() - 0.5) * 0.5;
        for (let k = 0; k < 5; k++) {
          const along = (k / 4) * length;
          addDrop({
            x: x + Math.cos(heading + bend * (k / 4)) * along,
            y: y + Math.sin(heading + bend * (k / 4)) * along,
            rx: size * (1 - k * 0.14) * 1.5,
            ry: size * (1 - k * 0.14),
            angle: heading,
            ink,
            reach: size * 2,
          });
        }
      } else {
        addDrop({ x, y, rx: size * (1 + Math.random() * 1.4), ry: size, angle: heading, ink, reach: size * 3 });
      }
    }
  };

  const stampTouching = () => qTurn(turnState, [0, 0, 1])[2] > capEdge() - 0.35;

  // Printing: when the stamp or the initials touch the floor, a thin strip of them is pressed down at the contact line.
  const press = (ground, speed) => {
    if (speed < 1 || (look.stamp === "hole" && !look.initials)) return;
    const contactZ = qTurn(qBack(turnState), [0, 0, 1])[2];
    const near = (look.stamp !== "hole" && contactZ > capEdge() - 0.25) || (look.initials && contactZ < -0.55);
    if (!near) return;
    const toBall = worldToBall(turnState);
    const newest = imprints.at(-1);
    const moved = newest ? Math.hypot(spot[0] - newest.x, spot[1] - newest.y) : 0;
    const length = (moved < radius ? moved : clamp(speed / 60, 1.5, 6)) / 2 + 0.45;
    const ink = contactZ < 0 ? [1, 1, 1] : stampInk();
    imprints.push({
      x: spot[0], y: spot[1], dir: [ground[0] / speed, ground[1] / speed], length, toBall, ink,
      time: clock, kept: tailHeight > 0 && spot[1] >= tailStart(),
    });
  };

  const expireInk = (now) => {
    deepest = Math.max(deepest, spot[1]);
    const limit = deepest - KEPT_SCREENS * innerHeight;
    for (const list of [trail, drops, imprints]) {
      for (const item of list) {
        if (item.kept && !item.fading && item.y < limit) {
          item.fading = true;
          item.time = now;
        }
      }
    }
    let broke = false;
    trail = trail.filter((point) => {
      if (inkLife(point, now) <= 0) {
        broke = true;
        return false;
      }
      if (broke) point.gap = true;
      broke = false;
      return true;
    });
    drops = drops.filter((drop) => inkLife(drop, now) > 0);
    imprints = imprints.filter((print) => inkLife(print, now) > 0);
  };

  // --- Physics ---
  const steerDive = (dt) => {
    if (coasting) {
      nudgeDepth(coasting * dt);
      coasting *= Math.exp(-dt / 0.5);
      if (Math.abs(coasting) < 20 || (coasting < 0 && !plunge)) coasting = 0;
    }
    depth = Math.abs(plunge - depth) < 0.5 ? plunge : depth + (plunge - depth) * (1 - Math.exp(-dt / 0.12));
    grow = 1 + (MAX_GROW - 1) * (1 - Math.exp(-pastEnd() / (innerHeight * 4)));
    radius = unit * grow;
  };

  const step = (now) => {
    const dt = Math.min((now - clock) / 1000, 1 / 30);
    clock = now;
    steerDive(dt);
    const shift = camera() - lastCamera;
    lastCamera = camera();
    const leapt = parked && Math.abs(shift) > innerHeight / 2;
    const carried = parked && !leapt && dt > 0 ? shift / dt : 0;
    if (parked) spot = [spot[0], spot[1] + shift];

    let aim = null;
    if (parked) aim = restingPlace(chapterInFocus());
    else {
      aim = chase;
      const [restX, restY] = restingPlace();
      const toRest = Math.hypot(spot[0] - restX, spot[1] - camera() - restY);
      if (toRest > radius * 3) armed = true;
      if (armed && airHeight === 0 && toRest < radius * 0.5) park();
    }
    const [aimX, aimY] = aim ? [aim[0], aim[1] + camera()] : spot;
    const rolling = airHeight === 0;
    if (rolling) {
      const ax = tilt ? TILT_PULL * tilt[0] - TILT_DRAG * speedXY[0] : PULL * (aimX - spot[0]) - DRAG * speedXY[0];
      const ay = tilt ? TILT_PULL * tilt[1] - TILT_DRAG * speedXY[1] : PULL * (aimY - spot[1]) - DRAG * speedXY[1];
      speedXY = [speedXY[0] + ax * dt, speedXY[1] + ay * dt];
      flingOnTurn(ax, ay);
      spin = [(speedXY[1] + carried) / radius, -speedXY[0] / radius, 0];
    } else {
      airSpeed -= FALL * dt;
      airHeight += airSpeed * dt;
      if (airHeight <= 0) land();
    }
    const over = Math.hypot(...speedXY) / MAX_SPEED;
    if (over > 1) speedXY = speedXY.map((v) => v / over);
    spot = [spot[0] + speedXY[0] * dt, spot[1] + speedXY[1] * dt];
    if (tilt) hitWalls();
    turnState = qSpin(turnState, spin, dt);

    const ground = [speedXY[0], speedXY[1] + carried];
    const speed = Math.hypot(...ground);
    if (airHeight === 0 && look.paint === "rainbow") {
      roll += speed * dt * 0.09;
      solid = fromHsl(roll % 360, 0.88, 0.5);
    }
    layInk(ground, speed, dt, leapt, rolling);
    expireInk(now);

    const lit = steerLamp(dt);
    paintFloor(now);
    paintOrb();
    place();
    revealTools();

    const still = !coasting && depth === plunge && lit && airHeight === 0 && speed < 0.5 && Math.hypot(aimX - spot[0], aimY - spot[1]) < 0.5;
    const dry = [trail, drops, imprints].every((list) => list.every((item) => item.kept && !item.fading));
    raf = still && dry ? 0 : requestAnimationFrame(step);
  };

  const layInk = (ground, speed, dt, leapt, wasRolling) => {
    const previous = trail.at(-1);
    if (airHeight > 0) {
      if (previous) previous.lifted = true;
      return;
    }
    const gap = leapt || !wasRolling || !previous || previous.lifted;
    const wanted = radius * (0.18 + 0.94 * Math.exp(-speed / 210));
    if (gap) inkWidth = radius * 0.18;
    inkWidth += (wanted - inkWidth) * (1 - Math.exp(-dt / (wanted > inkWidth ? 0.75 : 0.09)));
    if (!gap && Math.hypot(spot[0] - previous.x, spot[1] - previous.y) <= 1.5) {
      previous.width = inkWidth;
      previous.time = clock;
      return;
    }
    trail.push({
      x: spot[0], y: spot[1], width: inkWidth, ball: radius, gap, ink: contactInk(),
      pole: qTurn(turnState, [0, 0, 1]), edge: capEdge(), time: clock, kept: tailHeight > 0 && spot[1] >= tailStart(),
    });
    press(ground, speed);
  };

  const flingOnTurn = (ax, ay) => {
    const speed = Math.hypot(...speedXY);
    if (speed < 90 || stampTouching()) return;
    const along = (ax * speedXY[0] + ay * speedXY[1]) / speed;
    const side = [ax - (along * speedXY[0]) / speed, ay - (along * speedXY[1]) / speed];
    const force = Math.hypot(...side);
    if (force < 2100 || Math.random() > (force - 2100) / 6300) return;
    const outward = Math.atan2(-side[1], -side[0]);
    const forward = Math.atan2(speedXY[1], speedXY[0]);
    const between = outward + Math.atan2(Math.sin(forward - outward), Math.cos(forward - outward)) / 3;
    splatter(between, 0.9, 1 + Math.floor(Math.random() * 3), 0.5 + speed / 700);
  };

  const hitWalls = () => {
    const boxes = [[0, radius, innerWidth - radius], [1, camera() + radius, camera() + innerHeight - radius]];
    for (const [axis, low, high] of boxes) {
      const side = spot[axis] < low ? -1 : spot[axis] > high ? 1 : 0;
      if (!side) continue;
      spot[axis] = side < 0 ? low : high;
      const hit = Math.abs(speedXY[axis]);
      speedXY[axis] = hit > 60 ? -speedXY[axis] * 0.45 : 0;
      if (airHeight === 0 && hit > 260 && !stampTouching()) {
        const angle = axis ? (side * Math.PI) / 2 : side > 0 ? 0 : Math.PI;
        splatter(angle, 2, Math.min(15, Math.round(hit / 65)), 0.3 + hit / 900);
      }
    }
  };

  const land = () => {
    airHeight = 0;
    const hit = -airSpeed;
    if (hit > 440 && !stampTouching()) splatter(0, Math.PI * 2, Math.min(26, Math.round(hit / 36)), 0.4 + hit / 450);
    airSpeed = hit * REBOUND > 120 ? hit * REBOUND : 0;
    if (airSpeed) airHeight = 0.01;
    speedXY = speedXY.map((v, axis) => (axis ? lerp(v, spin[0] * radius, 0.25) : lerp(v, -spin[1] * radius, 0.25)));
  };

  const hop = (power = 1) => {
    if (!spot || airHeight > 0) return;
    airSpeed = HOP * power;
    airHeight = 0.01;
    const speed = Math.hypot(...speedXY);
    const swing = 1.15 + Math.random() * 0.85;
    const twist = (Math.random() < 0.5 ? -1 : 1) * (speed * 0.6 + airSpeed * 0.4);
    spin = [(speedXY[1] / radius) * swing, (-speedXY[0] / radius) * swing, twist / radius];
    wake();
  };

  const steerLamp = (dt) => {
    const goal = lampAt ? unit3([(lampAt[0] - spot[0]) / LAMP_REACH, (lampAt[1] - spot[1] + camera()) / LAMP_REACH, -1]) : LAMP_REST;
    if (Math.hypot(goal[0] - lamp[0], goal[1] - lamp[1], goal[2] - lamp[2]) < 0.002) {
      lamp = goal;
      return true;
    }
    const pull = 1 - Math.exp(-dt / 0.08);
    lamp = unit3(lamp.map((value, i) => value + (goal[i] - value) * pull));
    return false;
  };

  const wake = () => {
    if (raf || !spot) return;
    clock = performance.now();
    raf = requestAnimationFrame(step);
  };

  // --- Free play ---
  const park = () => {
    parked = true;
    armed = false;
    tilt = null;
    chase = null;
    home.classList.remove("is-on");
    grip.hidden = false;
    root.dataset.ball = "parked";
  };
  const release = () => {
    parked = false;
    grip.hidden = true;
    home.classList.add("is-on");
    chase = null;
    root.dataset.ball = "free";
    if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then((state) => state === "granted" && listenToTilt()).catch(() => {});
    } else listenToTilt();
    hop();
  };
  let tiltListening = false;
  const listenToTilt = () => {
    if (tiltListening) return;
    tiltListening = true;
    addEventListener("deviceorientation", ({ beta, gamma }) => {
      if (parked || gamma == null || beta == null) return;
      level ??= beta;
      const radians = Math.PI / 180;
      const lean = [Math.sin(gamma * radians), Math.sin((beta - level) * radians)];
      const screenTurn = (screen.orientation?.angle ?? 0) * radians;
      const [cos, sin] = [Math.cos(screenTurn), Math.sin(screenTurn)];
      tilt = [lean[0] * cos + lean[1] * sin, lean[1] * cos - lean[0] * sin].map((v) => (Math.abs(v) < 0.03 ? 0 : v));
      chase = null;
      wake();
    });
  };

  // --- Rolling on past the end of the page ---
  const nudgeDepth = (amount) => {
    if (amount > 0) rewind = 0;
    else rewind ||= Math.max(4, plunge / (2 * innerHeight));
    plunge = Math.max(0, plunge + (amount < 0 ? amount * rewind : amount));
  };
  const dive = (amount, event) => {
    if (!atBottom() || (amount <= 0 && !depth && !plunge)) return false;
    if (event.cancelable) event.preventDefault();
    nudgeDepth(amount);
    wake();
    return true;
  };
  const onFlow = () => {
    const now = performance.now();
    const gone = lastFlow ? (now - lastFlow.time) / 1000 : 0;
    const speed = gone > 0 && gone < 0.1 ? lastFlow.speed * 0.2 + ((scrollY - lastFlow.y) / gone) * 0.8 : 0;
    const arrived = atBottom() && lastFlow && !lastFlow.bottom;
    const handedOn = arrived ? Math.max(lastFlow.speed, speed) : 0;
    lastFlow = { y: scrollY, time: now, speed, bottom: atBottom() };
    if (plunge && tailHeight && scrollY <= tailStart() - innerHeight) {
      plunge = 0;
      coasting = 0;
      rewind = 0;
    }
    const noBounce = pastEnd() > 0 ? "none" : "";
    if (root.style.overscrollBehaviorY !== noBounce) root.style.overscrollBehaviorY = noBounce;
    if (arrived && !touching && !wheeling && handedOn > 0 && !depth) {
      coasting = Math.min(handedOn, 2600);
      wake();
    }
  };

  // --- Settings panel ---
  const makeTools = () => {
    panel = document.querySelector(".tools");
    toggle = document.querySelector(".tools-toggle");
    if (!panel || !toggle) return;
    const fields = panel.elements;
    const stampButton = panel.querySelector(".tools__stamp");
    const order = Object.keys(STAMP_NAMES);
    const showStamp = () => {
      const value = stampButton.value;
      stampButton.classList.toggle("is-hole", value === "hole");
      stampButton.style.setProperty("--glyph", art.glyphs?.[value] ? `url("${art.glyphs[value]}")` : "none");
      stampButton.setAttribute("aria-label", `${STAMP_NAMES[value]}, click for the next stamp`);
    };
    showStampButton = showStamp;
    showStamp();
    shuffle("stripes");
    shuffle("blend");
    panel.style.setProperty("--own-dab", look.own);
    const apply = () => {
      look.spotlight = fields.spotlight.checked;
      look.shading = fields.shading.checked;
      look.shadow = fields.shadow.checked;
      look.initials = fields.initials.checked;
      look.stamp = stampButton.value;
      look.size = Number(fields.size.value);
      look.paint = fields.paint.value;
      look.own = fields.own.value;
      panel.style.setProperty("--own-dab", look.own);
      solid = look.paint === "own" ? fromCss(look.own) : look.paint === "rainbow" ? fromHsl(roll % 360, 0.88, 0.5) : blue;
      shade.hidden = !look.shadow;
      lastPainted = "";
      wake();
    };
    panel.addEventListener("submit", (event) => event.preventDefault());
    panel.addEventListener("input", (event) => {
      if (event.target === fields.own) fields.paint.value = "own";
      apply();
    });
    panel.addEventListener("click", (event) => {
      const clicked = event.target.value;
      if (clicked === "stripes" || clicked === "blend") {
        shuffle(clicked);
        apply();
      }
    });
    stampButton.addEventListener("click", () => {
      stampButton.value = order[(order.indexOf(stampButton.value) + 1) % order.length];
      showStamp();
      apply();
    });
    panel.hidden = false;
    toggle.hidden = false;
    toggle.addEventListener("click", () => openTools(!panel.classList.contains("is-open")));
    apply();
  };
  let showStampButton = () => {};
  const openTools = (open) => {
    panel.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  const revealTools = () => {
    if (!toggle) return;
    const wellPast = pastEnd() > 0.75 * innerHeight;
    if (wellPast === toggle.classList.contains("is-on")) return;
    toggle.classList.toggle("is-on", wellPast);
    if (!wellPast) openTools(false);
  };

  // --- Art: BCC material only ---
  const ART = 256;
  const makeCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ART;
    const context = canvas.getContext("2d");
    context.beginPath();
    context.arc(ART / 2, ART / 2, ART / 2, 0, Math.PI * 2);
    context.clip();
    return [canvas, context];
  };
  const makeSigmoid = () => {
    const [canvas, context] = makeCanvas();
    context.strokeStyle = "#000";
    context.lineWidth = 15;
    context.lineCap = "round";
    context.beginPath();
    for (let x = -1; x <= 1; x += 0.02) {
      const y = 1 / (1 + Math.exp(-x * 6));
      const px = ART / 2 + x * ART * 0.38;
      const py = ART * 0.76 - y * ART * 0.52;
      if (x === -1) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(ART * 0.12, ART * 0.76);
    context.lineTo(ART * 0.88, ART * 0.76);
    context.stroke();
    return canvas;
  };
  const makeBrain = async () => {
    const drawing = document.querySelector(".masthead__drawing");
    if (!drawing) return null;
    const copy = drawing.cloneNode(true);
    copy.removeAttribute("class");
    copy.setAttribute("width", ART);
    copy.setAttribute("height", ART);
    copy.setAttribute("color", "#000");
    copy.querySelector("g").setAttribute("stroke-width", "2.6");
    copy.querySelectorAll(".portrait__shade, .portrait__tone").forEach((part) => part.remove());
    copy.querySelectorAll(".portrait__eye").forEach((eye) => eye.setAttribute("r", "3"));
    const source = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
    const image = new Image(ART, ART);
    image.src = source;
    await image.decode();
    const [canvas, context] = makeCanvas();
    context.drawImage(image, 0, 0, ART, ART);
    art.glyphs = { ...art.glyphs, brain: source };
    return canvas;
  };
  const makeInitials = async () => {
    const family = getComputedStyle(document.body).fontFamily;
    const size = ART * 0.46;
    await document.fonts.load(`${size}px ${family}`, "MM");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ART;
    const context = canvas.getContext("2d");
    context.font = `${size}px ${family}`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText("MM", ART / 2, (ART + context.measureText("MM").actualBoundingBoxAscent) / 2);
    return canvas;
  };

  // --- Start ---
  const onPointerMove = (event) => {
    if (event.pointerType !== "mouse") return;
    lampAt = [event.clientX, event.clientY];
    if (parked) pointerAt = lampAt;
    else chase = lampAt;
    wake();
  };

  const start = async () => {
    document.body.prepend(floor);
    document.body.append(home, shade, orb, grip);
    root.classList.add("has-ball");
    root.dataset.ball = "parked";
    measure();
    buildOrbGpu();
    buildFloorGpu();
    const sigmoid = makeSigmoid();
    art.stamps.sigmoid = sigmoid;
    art.glyphs = { sigmoid: sigmoid.toDataURL() };
    makeTools();
    const [first, second] = restingPlace(chapterInFocus());
    spot = [first, second + camera()];
    lastCamera = camera();
    paintOrb();
    place();
    wake();

    Promise.all([makeBrain(), makeInitials()]).then(([brain, initials]) => {
      if (brain) art.stamps.brain = brain;
      art.initials = initials;
      uploadArt();
      showStampButton();
      wake();
    }).catch(() => {});

    grip.addEventListener("click", release);
    grip.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" && Math.hypot(...speedXY) < 150) hop(0.55);
    });
    addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", () => {
      pointerAt = null;
      lampAt = null;
      wake();
    });
    addEventListener("pointerdown", (event) => {
      if (!parked && event.pointerType === "mouse" && event.button === 0 && !event.target.closest?.(".tools, .tools-toggle")) hop();
    }, { passive: true });
    addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !parked) {
        park();
        grip.focus({ preventScroll: true });
        wake();
      }
    });
    const follow = (event) => {
      if (parked) return;
      if (tilt) {
        if (event.type === "touchstart") hop();
        return;
      }
      chase = [event.touches[0].clientX, event.touches[0].clientY];
      wake();
    };
    addEventListener("touchstart", follow, { passive: true });
    addEventListener("touchmove", follow, { passive: true });
    addEventListener("wheel", (event) => {
      wheeling = true;
      dive(event.deltaY * (event.deltaMode === 1 ? 16 : 1), event);
    }, { passive: false });
    const swipeTrack = (event) => {
      touching = !event.type.endsWith("end");
      wheeling = false;
      if (event.type === "touchend") {
        coasting = swipe && performance.now() - swipe.time < 100 ? flick : 0;
        if (coasting) wake();
        return;
      }
      const y = event.touches[0].clientY;
      const time = performance.now();
      if (event.type === "touchstart") {
        coasting = 0;
        flick = 0;
      } else if (swipe) {
        const moved = dive(swipe.y - y, event);
        flick = moved ? flick * 0.2 + ((swipe.y - y) / (Math.max(time - swipe.time, 1) / 1000)) * 0.8 : 0;
      }
      swipe = { y, time };
    };
    addEventListener("touchstart", swipeTrack, { passive: true });
    addEventListener("touchmove", swipeTrack, { passive: false });
    addEventListener("touchend", swipeTrack, { passive: true });
    addEventListener("scroll", () => {
      onFlow();
      wake();
    }, { passive: true });
    addEventListener("load", () => {
      measure();
      wake();
    });
    document.fonts.ready.then(() => {
      measure();
      wake();
    });
    new ResizeObserver(() => {
      measure();
      wake();
    }).observe(document.body);
    addEventListener("resize", () => {
      measure();
      if (parked && airHeight === 0) {
        const [x, y] = restingPlace(chapterInFocus());
        spot = [x, y + camera()];
        speedXY = [0, 0];
      }
      wake();
    });
    for (const [canvas, build] of [[orb, buildOrbGpu], [floor, buildFloorGpu]]) {
      canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
      canvas.addEventListener("webglcontextrestored", () => {
        build();
        wake();
      });
    }
  };

  start();
})();
