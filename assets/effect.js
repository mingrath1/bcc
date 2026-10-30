(() => {
  "use strict";

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = matchMedia("(min-width: 781px) and (hover: hover) and (pointer: fine)");
  const preview = document.querySelector(".page-preview img");
  const figures = [...document.querySelectorAll(".lab-figure")];

  // The sticky preview follows the same mechanism as the reference's reel:
  // pointer selection on desktop and viewport selection while scrolling.
  let previewSource = preview?.getAttribute("src") ?? "";
  const showPreview = (figure) => {
    if (!preview || !desktop.matches || reducedMotion.matches) return;
    const image = figure?.querySelector("img");
    const source = image?.getAttribute("src");
    if (!source || source === previewSource) return;
    previewSource = source;
    preview.src = source;
    preview.animate(
      [
        { opacity: 0, transform: "translateY(10px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 420, easing: "cubic-bezier(.3,.7,0,1)" },
    );
  };

  figures.forEach((figure) => figure.addEventListener("pointerenter", () => showPreview(figure), { passive: true }));
  const previewObserver = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.isIntersecting && showPreview(entry.target)),
    { rootMargin: "-42% 0px -42% 0px", threshold: 0 },
  );
  figures.forEach((figure) => previewObserver.observe(figure));

  const canvas = document.querySelector(".motion-trail");
  const ball = document.querySelector(".motion-ball");
  if (reducedMotion.matches || !canvas || !ball) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  canvas.hidden = false;
  ball.hidden = false;

  let ratio = 1;
  let x = 0;
  let y = 0;
  let targetX = 0;
  let targetY = 0;
  let velocityX = 0;
  let velocityY = 0;
  let radius = 24;
  let trail = [];
  let previous = null;
  let lastScroll = scrollY;
  let frame = 0;
  let dragging = false;
  let dragMoved = false;

  const dock = () => {
    if (!desktop.matches) return { x: 23, y: innerHeight * 0.45 };
    const header = document.querySelector(".page-head")?.getBoundingClientRect();
    return {
      x: Math.max(36, Math.min((header?.right ?? 280) - 20, innerWidth - 40)),
      y: Math.min(210, innerHeight * 0.3),
    };
  };

  const resize = () => {
    ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    radius = ball.offsetWidth / 2;
    const home = dock();
    targetX = Math.max(radius, Math.min(home.x, innerWidth - radius));
    targetY = Math.max(radius, Math.min(home.y, innerHeight - radius));
    x = targetX;
    y = targetY;
    velocityX = velocityY = 0;
    trail = [];
    ball.style.transform = `translate3d(${x - radius}px, ${y - radius}px, 0)`;
  };

  const draw = (time) => {
    context.clearRect(0, 0, innerWidth, innerHeight);
    trail = trail.filter((point) => time - point.time < 1350);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let index = 1; index < trail.length; index += 1) {
      const from = trail[index - 1];
      const to = trail[index];
      const life = 1 - (time - to.time) / 1350;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance > 90) continue;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.lineWidth = Math.max(1, to.width * life);
      context.strokeStyle = `rgba(21, 21, 223, ${0.68 * life})`;
      context.stroke();
    }
  };

  const tick = (time) => {
    frame = 0;
    const delta = previous ? Math.min((time - previous) / 1000, 1 / 30) : 1 / 60;
    previous = time;

    if (!dragging || desktop.matches) {
      velocityX += ((targetX - x) * 82 - velocityX * 13) * delta;
      velocityY += ((targetY - y) * 82 - velocityY * 13) * delta;
    } else {
      velocityX = (targetX - x) * 16;
      velocityY = (targetY - y) * 16;
    }

    x += velocityX * delta;
    y += velocityY * delta;
    const speed = Math.hypot(velocityX, velocityY);
    const distance = Math.hypot(targetX - x, targetY - y);
    const last = trail.at(-1);
    if (speed > 12 && (!last || Math.hypot(x - last.x, y - last.y) > 3)) {
      trail.push({ x, y, time, width: Math.min(19, 5 + speed * 0.018) });
      if (trail.length > 160) trail.splice(0, trail.length - 160);
    }

    draw(time);
    ball.style.transform = `translate3d(${x - radius}px, ${y - radius}px, 0)`;

    if (!document.hidden && (distance > 0.08 || speed > 0.6 || trail.length || dragging)) {
      frame = requestAnimationFrame(tick);
    } else {
      previous = null;
    }
  };

  const wake = () => {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  };

  const bounce = (strength = 1) => {
    velocityY -= 430 * strength;
    velocityX += (Math.random() - 0.5) * 180 * strength;
    wake();
  };

  addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") {
      targetX = event.clientX;
      targetY = event.clientY;
      wake();
    } else if (dragging) {
      targetX = Math.max(radius, Math.min(event.clientX, innerWidth - radius));
      targetY = Math.max(radius, Math.min(event.clientY, innerHeight - radius));
      dragMoved = true;
      wake();
    }
  }, { passive: true });

  addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button === 0) bounce(0.8);
  }, { passive: true });

  ball.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    dragging = true;
    dragMoved = false;
    targetX = event.clientX;
    targetY = event.clientY;
    ball.setPointerCapture(event.pointerId);
    wake();
  });

  const release = (event) => {
    if (!dragging) return;
    dragging = false;
    if (ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
    if (!dragMoved) bounce(0.9);
  };
  ball.addEventListener("pointerup", release);
  ball.addEventListener("pointercancel", release);
  ball.addEventListener("click", () => desktop.matches && bounce(1));

  document.documentElement.addEventListener("pointerleave", () => {
    if (dragging) return;
    const home = dock();
    targetX = home.x;
    targetY = home.y;
    wake();
  });

  addEventListener("scroll", () => {
    const change = scrollY - lastScroll;
    lastScroll = scrollY;
    velocityY += Math.max(-360, Math.min(360, change * 3));
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
      previous = null;
    } else {
      wake();
    }
  });

  desktop.addEventListener("change", () => {
    resize();
    wake();
  });

  resize();
  wake();
})();
