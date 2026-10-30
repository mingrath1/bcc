(() => {
  const eyes = [...document.querySelectorAll(".intro .portrait__eye")];
  const enabled = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  if (!eyes.length) return;
  let pointer = null;
  let frame = 0;

  const render = () => {
    frame = 0;
    for (const eye of eyes) {
      const box = eye.getBoundingClientRect();
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1;
      const pull = Math.min(distance, 240) / 240 * .6 / distance;
      eye.style.translate = `${(dx * pull).toFixed(3)}px ${(dy * pull).toFixed(3)}px`;
    }
  };
  const track = (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(render);
  };
  const rest = () => eyes.forEach((eye) => { eye.style.translate = ""; });
  const sync = () => {
    if (enabled.matches) addEventListener("pointermove", track, { passive: true });
    else {
      removeEventListener("pointermove", track);
      rest();
    }
  };
  document.documentElement.addEventListener("pointerleave", rest);
  sync();
  enabled.addEventListener("change", sync);
})();
