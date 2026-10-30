(() => {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const narrow = matchMedia("(max-width: 48.75em)");
  if (!motion.matches) return;

  const sphere = document.createElement("canvas");
  const gl = sphere.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return;

  const shell = document.querySelector(".shell");
  const runoutElement = document.querySelector(".runout");
  const highlights = [...document.querySelectorAll(".highlight")];
  const trail = document.createElement("canvas");
  const shadow = document.createElement("div");
  const handle = document.createElement("button");
  const dock = document.createElement("div");
  const drawing = trail.getContext("2d");
  if (!shell || !drawing) return;

  trail.className = "ball__trail";
  sphere.className = "ball__sphere";
  shadow.className = "ball__shadow";
  handle.className = "ball__handle";
  dock.className = "ball__dock";
  handle.type = "button";
  handle.setAttribute("aria-label", "Play with the ball");
  trail.setAttribute("aria-hidden", "true");
  sphere.setAttribute("aria-hidden", "true");
  shadow.setAttribute("aria-hidden", "true");
  dock.setAttribute("aria-hidden", "true");
  document.body.append(trail, shadow, sphere, handle, dock);

  const vertexSource = `#version 300 es
    in vec2 aPosition;
    out vec2 vPoint;
    void main() {
      vPoint = vec2(aPosition.x, -aPosition.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec2 vPoint;
    out vec4 outColor;
    uniform mat3 uRotation;
    uniform vec3 uColor;
    uniform vec3 uPaper;
    uniform vec3 uPalette[5];
    uniform int uPaletteCount;
    uniform bool uGradient;
    uniform bool uPoke;
    uniform bool uSpotlight;
    uniform bool uShading;
    uniform bool uInitials;
    uniform int uStampMode;
    uniform float uStampScale;
    uniform sampler2D uBrain;
    uniform sampler2D uLetters;

    void main() {
      float distanceFromCenter = dot(vPoint, vPoint);
      if (distanceFromCenter >= 1.0) discard;
      vec3 normal = vec3(vPoint.xy, -sqrt(1.0 - distanceFromCenter));
      vec3 local = uRotation * normal;
      float turn = acos(clamp(-local.z, -1.0, 1.0)) / 3.14159265359;
      vec3 paint = uColor;
      if (uPaletteCount > 1) {
        float scaled = turn * float(uPaletteCount - 1);
        int index = min(int(scaled), uPaletteCount - 2);
        float amount = uGradient ? fract(scaled) : smoothstep(.92, 1.0, fract(scaled));
        paint = mix(uPalette[index], uPalette[index + 1], amount);
      }
      if (uPoke) {
        paint = local.y > 0.0 ? vec3(1.0, .07, .0) : vec3(1.0);
        paint = mix(paint, vec3(0.0), 1.0 - smoothstep(.055, .075, abs(local.y)));
      }
      if (uStampMode != 2 && local.z > .25) {
        vec2 stampUv = local.xy * uStampScale + .5;
        if (all(greaterThanEqual(stampUv, vec2(0.0))) && all(lessThanEqual(stampUv, vec2(1.0)))) {
          float stamp = uStampMode == 0 ? texture(uBrain, stampUv).a : texture(uLetters, stampUv).a;
          paint = mix(paint, uPaper, stamp);
        }
      }
      if (uInitials && local.z < 0.0) {
        vec2 letterUv = local.xy * 1.35 + .5;
        if (all(greaterThanEqual(letterUv, vec2(0.0))) && all(lessThanEqual(letterUv, vec2(1.0)))) {
          paint = mix(paint, vec3(1.0), texture(uLetters, letterUv).a);
        }
      }
      float light = 1.0;
      if (uShading) light = .52 + .62 * max(0.0, dot(normal, normalize(vec3(-.45, -.55, -.7))));
      if (uSpotlight) {
        vec3 halfVector = normalize(normalize(vec3(-.45, -.55, -.7)) + vec3(0.0, 0.0, 1.0));
        light += pow(max(0.0, dot(normal, halfVector)), 14.0) * .2;
      }
      float alpha = 1.0 - smoothstep(.975, 1.0, distanceFromCenter);
      outColor = vec4(paint * light * alpha, alpha);
    }`;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const positionAttribute = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(positionAttribute);
  gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries([
    "uRotation", "uColor", "uPaper", "uPalette", "uPaletteCount", "uGradient", "uPoke",
    "uSpotlight", "uShading", "uInitials", "uStampMode", "uStampScale", "uBrain", "uLetters",
  ].map((name) => [name, gl.getUniformLocation(program, name)]));

  const makeTexture = (source, unit) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return texture;
  };

  const letters = document.createElement("canvas");
  letters.width = letters.height = 256;
  const letterContext = letters.getContext("2d");
  letterContext.fillStyle = "#fff";
  letterContext.font = "132px 'Libre Caslon Condensed', Georgia, serif";
  letterContext.textAlign = "center";
  letterContext.textBaseline = "middle";
  letterContext.fillText("MM", 128, 139);
  makeTexture(letters, 1);
  gl.uniform1i(uniforms.uLetters, 1);

  const brain = new Image();
  const brainTexture = document.createElement("canvas");
  brainTexture.width = brainTexture.height = 256;
  brain.src = "assets/portrait.svg";
  brain.addEventListener("load", () => {
    brainTexture.getContext("2d").drawImage(brain, 0, 0, 256, 256);
    makeTexture(brainTexture, 0);
  }, { once: true });
  gl.uniform1i(uniforms.uBrain, 0);

  const parseColor = (value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    probe.style.display = "none";
    document.body.append(probe);
    const parsed = getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    probe.remove();
    return parsed?.length === 3 ? parsed.map((channel) => channel / 255) : [0, 0, .87];
  };
  const themeColor = () => parseColor("var(--color-accent)");
  const paperColor = () => parseColor("var(--color-paper)");
  const hslColor = (hue, saturation = 75, lightness = 52) => {
    const probe = document.createElement("span");
    probe.style.color = `hsl(${hue} ${saturation}% ${lightness}%)`;
    probe.style.display = "none";
    document.body.append(probe);
    const parsed = getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    probe.remove();
    return parsed?.length === 3 ? parsed.map((channel) => channel / 255) : [0, 0, .87];
  };

  let settings = {
    spotlight: false,
    shading: false,
    shadow: false,
    initials: true,
    stamp: "brain",
    size: 25,
    color: "theme",
    custom: "#0000ee",
  };
  let accent = themeColor();
  let paper = paperColor();
  let palette = [];
  let hue = 0;
  let quaternion = [0, 0, 0, 1];
  let position = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  let velocity = { x: 0, y: 0 };
  let current = null;
  let hovered = null;
  let points = [];
  let stamps = [];
  let lastTime = 0;
  let frame = 0;
  let lastScroll = scrollY;
  let dragging = false;
  let detached = false;
  let moved = false;
  let grow = 1;
  let ratio = 1;
  let trailColor = accent;

  const centerHighlight = () => {
    const line = innerHeight / 2;
    return highlights.find((highlight) => {
      const box = highlight.getBoundingClientRect();
      return box.top <= line && box.bottom > line;
    }) ?? null;
  };

  const runoutProgress = () => {
    if (!runoutElement) return 0;
    const start = runoutElement.getBoundingClientRect().top + scrollY - innerHeight;
    return Math.max(0, Math.min(1, (scrollY - start) / Math.max(innerHeight, 1)));
  };

  const updateTarget = () => {
    const intro = document.querySelector(".shell__intro")?.getBoundingClientRect();
    const focus = narrow.matches ? current : hovered ?? current;
    const baseX = narrow.matches ? 36 : Math.max(48, intro?.right ?? innerWidth * .28);
    let baseY = scrollY + innerHeight * .3;
    if (focus) {
      const box = focus.getBoundingClientRect();
      baseY = scrollY + (box.top + box.bottom) / 2;
    } else {
      const name = document.querySelector(".intro__name")?.getBoundingClientRect();
      if (name) baseY = scrollY + (name.top + name.bottom) / 2;
    }
    const progress = runoutProgress();
    const eased = progress * progress * (3 - 2 * progress);
    grow = 1 + 2 * (1 - Math.exp(-progress * 1.8));
    const wander = Math.sin(scrollY / 310) * 90 * eased + Math.sin(scrollY / 137) * 35 * eased;
    target.x = baseX + (innerWidth / 2 - baseX) * eased + wander;
    target.y = baseY + (scrollY + innerHeight * .55 - baseY) * eased;
    const margin = 30 * grow;
    target.x = Math.max(margin, Math.min(innerWidth - margin, target.x));
    target.y = Math.max(scrollY + margin, Math.min(scrollY + innerHeight - margin, target.y));
    document.querySelector(".settings-trigger")?.classList.toggle("settings-trigger--visible", progress > .12);
  };

  const resize = () => {
    ratio = Math.min(devicePixelRatio || 1, 2);
    trail.width = Math.round(innerWidth * ratio);
    trail.height = Math.round(innerHeight * ratio);
    drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
    sphere.width = sphere.height = 288;
    gl.viewport(0, 0, 288, 288);
    current = centerHighlight();
    updateTarget();
    if (!position.x) position = { ...target };
  };

  const quaternionMatrix = () => {
    const [x, y, z, w] = quaternion;
    return new Float32Array([
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    ]);
  };

  const rotate = (axisX, axisY, amount) => {
    const length = Math.hypot(axisX, axisY);
    if (length < .0001) return;
    const angle = amount * length;
    const sine = Math.sin(angle / 2) / length;
    const qx = axisX * sine;
    const qy = axisY * sine;
    const qw = Math.cos(angle / 2);
    const [x, y, z, w] = quaternion;
    quaternion = [
      qw * x + qx * w + qy * z,
      qw * y - qx * z + qy * w,
      qw * z + qx * y - qy * x,
      qw * w - qx * x - qy * y,
    ];
    const norm = Math.hypot(...quaternion) || 1;
    quaternion = quaternion.map((value) => value / norm);
  };

  const drawTrail = (time) => {
    drawing.clearRect(0, 0, innerWidth, innerHeight);
    points = points.filter((point) => time - point.time < 8000);
    stamps = stamps.filter((stamp) => time - stamp.time < 8000);
    drawing.lineCap = "butt";
    drawing.lineJoin = "round";
    for (let start = 0; start < points.length - 1; start += 24) {
      const chunk = points.slice(start, Math.min(start + 25, points.length));
      if (chunk.length < 2) continue;
      const life = 1 - (time - chunk.at(-1).time) / 8000;
      if (!chunk.some((point) => point.y - scrollY > -80 && point.y - scrollY < innerHeight + 80)) continue;
      drawing.beginPath();
      drawing.moveTo(chunk[0].x, chunk[0].y - scrollY);
      for (let index = 1; index < chunk.length - 1; index += 1) {
        const point = chunk[index];
        const next = chunk[index + 1];
        drawing.quadraticCurveTo(point.x, point.y - scrollY, (point.x + next.x) / 2, (point.y + next.y) / 2 - scrollY);
      }
      const last = chunk.at(-1);
      drawing.lineTo(last.x, last.y - scrollY);
      drawing.lineWidth = Math.max(.5, chunk.reduce((sum, point) => sum + point.width, 0) / chunk.length * life);
      drawing.strokeStyle = `rgba(${trailColor.map((channel) => Math.round(channel * 255)).join(",")},${(.72 * life).toFixed(3)})`;
      drawing.stroke();
    }
    for (const stamp of stamps) {
      const life = 1 - (time - stamp.time) / 8000;
      const y = stamp.y - scrollY;
      if (y < -100 || y > innerHeight + 100 || !brain.complete) continue;
      drawing.save();
      drawing.translate(stamp.x, y);
      drawing.rotate(stamp.angle);
      drawing.globalAlpha = life * .65;
      const size = stamp.size;
      drawing.drawImage(brain, -size / 2, -size / 2, size, size);
      drawing.restore();
    }
  };

  const renderSphere = () => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniformMatrix3fv(uniforms.uRotation, false, quaternionMatrix());
    const colors = settings.color === "poline" || settings.color === "gradient" ? palette : [];
    gl.uniform3fv(uniforms.uColor, settings.color === "custom" ? parseColor(settings.custom) : accent);
    gl.uniform3fv(uniforms.uPaper, paper);
    gl.uniform3fv(uniforms.uPalette, new Float32Array(colors.flat().concat(Array(Math.max(0, 15 - colors.length * 3)).fill(0))));
    gl.uniform1i(uniforms.uPaletteCount, colors.length);
    gl.uniform1i(uniforms.uGradient, settings.color === "gradient");
    gl.uniform1i(uniforms.uPoke, settings.color === "pokeball");
    gl.uniform1i(uniforms.uSpotlight, settings.spotlight);
    gl.uniform1i(uniforms.uShading, settings.shading);
    gl.uniform1i(uniforms.uInitials, settings.initials);
    gl.uniform1i(uniforms.uStampMode, settings.stamp === "brain" ? 0 : settings.stamp === "initials" ? 1 : 2);
    gl.uniform1f(uniforms.uStampScale, 1.1 + (50 - settings.size) / 45);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const tick = (time) => {
    frame = 0;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 1 / 30) : 1 / 60;
    lastTime = time;
    const scrollDelta = scrollY - lastScroll;
    lastScroll = scrollY;
    current = centerHighlight();
    if (!dragging) updateTarget();

    velocity.x += ((target.x - position.x) * 70 - velocity.x * 11) * dt;
    velocity.y += ((target.y - position.y) * 70 - velocity.y * 11) * dt;
    const speed = Math.hypot(velocity.x, velocity.y);
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    rotate(velocity.y / (24 * grow), -velocity.x / (24 * grow), dt);
    if (settings.color === "cycle") {
      hue = (hue + speed * dt * .08) % 360;
      accent = hslColor(hue);
      trailColor = accent;
    }

    const clientY = position.y - scrollY;
    const radius = 24 * grow;
    if (clientY < radius || clientY > innerHeight - radius) {
      position.y = scrollY + Math.max(radius, Math.min(innerHeight - radius, clientY));
      velocity.y *= -.42;
    }
    if (position.x < radius || position.x > innerWidth - radius) {
      position.x = Math.max(radius, Math.min(innerWidth - radius, position.x));
      velocity.x *= -.42;
    }

    const last = points.at(-1);
    const movedDistance = last ? Math.hypot(position.x - last.x, position.y - last.y) : 99;
    if (movedDistance > 1.5) {
      points.push({
        x: position.x,
        y: position.y,
        width: radius * Math.min(1.1, .2 + speed / 900),
        time,
      });
      if (points.length > 900) points.splice(0, points.length - 900);
    }
    if (speed > 620 && brain.complete && Math.random() < dt * .35) {
      stamps.push({
        x: position.x + (Math.random() - .5) * radius,
        y: position.y + (Math.random() - .5) * radius,
        size: radius * (1.2 + Math.random()),
        angle: Math.atan2(velocity.y, velocity.x) + Math.random(),
        time,
      });
    }

    drawTrail(time);
    renderSphere();
    const x = position.x;
    const y = position.y - scrollY;
    sphere.style.translate = `${x - 24}px ${y - 24}px`;
    sphere.style.scale = grow;
    handle.style.translate = `${x - 24}px ${y - 24}px`;
    handle.style.scale = grow;
    shadow.hidden = !settings.shadow;
    shadow.style.translate = `${x - 36 + velocity.x * .015}px ${y - 30 + Math.abs(velocity.y) * .008}px`;
    shadow.style.scale = grow;
    shadow.style.opacity = Math.max(.15, 1 - Math.abs(velocity.y) / 1200);
    dock.style.translate = `${target.x - 19}px ${target.y - scrollY - 19}px`;

    const settled = Math.hypot(target.x - position.x, target.y - position.y) < .05 && speed < .5;
    if (!document.hidden && (!settled || points.length || stamps.length || Math.abs(scrollDelta) > 0)) frame = requestAnimationFrame(tick);
    else lastTime = 0;
  };

  const wake = () => {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  };
  const jump = (strength = 1) => {
    velocity.y -= 760 * strength;
    velocity.x += (Math.random() - .5) * 130;
    wake();
  };

  const randomPalette = () => {
    const base = Math.random() * 360;
    palette = Array.from({ length: 5 }, (_, index) => hslColor((base + index * 47 + Math.random() * 25) % 360, 68 + Math.random() * 22, 42 + index * 7));
    const css = palette.map((color) => `rgb(${color.map((channel) => Math.round(channel * 255)).join(" ")})`);
    const gradient = `conic-gradient(${css.join(",")})`;
    const form = document.querySelector(".settings");
    form?.style.setProperty("--settings-poline", gradient);
    form?.style.setProperty("--settings-gradient", gradient);
  };

  const form = document.querySelector(".settings");
  const trigger = document.querySelector(".settings-trigger");
  if (form && trigger) {
    form.hidden = false;
    trigger.hidden = false;
    [...form.children].forEach((row, index) => row.style.setProperty("--order", form.children.length - index));
    randomPalette();
    form.addEventListener("submit", (event) => event.preventDefault());
    form.addEventListener("input", () => {
      const elements = form.elements;
      if (document.activeElement?.name === "custom") elements.color.value = "custom";
      settings = {
        spotlight: elements.spotlight.checked,
        shading: elements.shading.checked,
        shadow: elements.shadow.checked,
        initials: elements.initials.checked,
        stamp: elements.stamp.value,
        size: Number(elements.size.value),
        color: elements.color.value,
        custom: elements.custom.value,
      };
      if (settings.color === "custom") accent = parseColor(settings.custom);
      else if (settings.color !== "cycle") accent = themeColor();
      trailColor = accent;
      form.style.setProperty("--settings-custom", settings.custom);
      wake();
    });
    form.addEventListener("click", (event) => {
      if (event.target.value === "poline" || event.target.value === "gradient") {
        randomPalette();
        wake();
      }
    });
    const stampButton = form.querySelector(".settings__stamp");
    const updateStampButton = () => {
      const value = form.elements.stamp.value;
      stampButton.classList.toggle("settings__stamp--hole", value === "hole");
      stampButton.textContent = value === "initials" ? "MM" : "";
      stampButton.style.setProperty("--stamp", value === "brain" ? 'url("portrait.svg")' : "none");
      stampButton.setAttribute("aria-label", `${value}, click for the next stamp`);
    };
    updateStampButton();
    stampButton.addEventListener("click", () => {
      const modes = ["brain", "initials", "hole"];
      form.elements.stamp.value = modes[(modes.indexOf(form.elements.stamp.value) + 1) % modes.length];
      updateStampButton();
      form.dispatchEvent(new Event("input"));
    });
    trigger.addEventListener("click", () => {
      const open = !form.classList.contains("settings--open");
      form.classList.toggle("settings--open", open);
      trigger.setAttribute("aria-expanded", String(open));
    });
  }

  addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") {
      hovered = event.target?.closest?.(".highlight") ?? null;
    } else if (dragging) {
      moved = true;
      target = { x: event.clientX, y: event.clientY + scrollY };
    }
    wake();
  }, { passive: true });

  addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button === 0) jump(.8);
  }, { passive: true });

  handle.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse" && Math.hypot(velocity.x, velocity.y) < 150) jump(.55);
  });
  handle.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    if (detached && !dragging) {
      detached = false;
      dock.classList.remove("ball__dock--visible");
      return;
    }
    dragging = detached = true;
    moved = false;
    dock.classList.add("ball__dock--visible");
    target = { x: event.clientX, y: event.clientY + scrollY };
    handle.setPointerCapture(event.pointerId);
    if (window.DeviceOrientationEvent?.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => {});
    wake();
  });
  const release = (event) => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (!moved) jump(.8);
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);
  handle.addEventListener("click", () => fine.matches && jump(1));

  addEventListener("deviceorientation", (event) => {
    if (!detached || event.gamma == null || event.beta == null) return;
    target.x += event.gamma * .08;
    target.y += event.beta * .08;
    wake();
  });
  addEventListener("scroll", () => {
    current = centerHighlight();
    wake();
  }, { passive: true });
  addEventListener("resize", () => {
    resize();
    wake();
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    } else wake();
  });
  narrow.addEventListener("change", () => {
    resize();
    wake();
  });
  document.fonts.ready.then(() => {
    letterContext.clearRect(0, 0, 256, 256);
    letterContext.fillStyle = "#fff";
    letterContext.font = "132px 'Libre Caslon Condensed', Georgia, serif";
    letterContext.textAlign = "center";
    letterContext.textBaseline = "middle";
    letterContext.fillText("MM", 128, 139);
    makeTexture(letters, 1);
    wake();
  });

  resize();
  wake();
})();
