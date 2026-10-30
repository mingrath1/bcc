(() => {
  const reel = document.querySelector(".reel");
  if (!reel) return;
  const track = reel.querySelector(".reel__track");
  const slides = [...reel.querySelectorAll(".reel__video")];
  const highlights = [...document.querySelectorAll(".highlight")];
  const intro = reel.closest(".intro");
  const originalParent = reel.parentElement;
  const originalNext = reel.nextElementSibling;
  const motion = matchMedia("(prefers-reduced-motion: no-preference)");
  const wide = matchMedia("(min-width: 48.8125em) and (min-height: 45.0625em)");
  const tablet = matchMedia("(max-width: 48.75em)");
  const phone = matchMedia("(max-width: 33.75em)");

  let ready = false;
  let hovered = null;
  let centered = null;
  let pointer = null;

  document.body.classList.add("has-reel");
  track.style.setProperty("--reel-count", slides.length);

  const position = () => {
    if (!hovered || !wide.matches) return;
    const naturalTop = intro.getBoundingClientRect().top + reel.offsetTop;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const textTop = hovered.querySelector(".highlight__text").getBoundingClientRect().top;
    const top = Math.min(Math.max(textTop, rem), innerHeight - rem - reel.offsetHeight);
    reel.style.setProperty("--reel-shift", `${top - naturalTop}px`);
  };

  const show = (index) => {
    reel.classList.toggle("reel--visible", index >= 0);
    if (index < 0) return;
    track.style.setProperty("--reel-index", index);
  };

  const update = () => {
    if (phone.matches || !motion.matches) {
      if (reel.parentElement !== originalParent) originalParent.insertBefore(reel, originalNext);
      show(-1);
      return;
    }
    const focus = tablet.matches ? centered : hovered ?? centered;
    const index = ready && focus ? slides.findIndex((slide) => slide.dataset.preview === focus.dataset.preview) : -1;
    const slot = tablet.matches ? focus?.querySelector(".highlight__media") : originalParent;
    if (index < 0 || !slot) {
      show(-1);
      return;
    }
    if (reel.parentElement !== slot) {
      reel.classList.remove("reel--visible");
      reel.style.removeProperty("--reel-shift");
      slot.insertBefore(reel, slot === originalParent ? originalNext : null);
      void track.offsetHeight;
    }
    position();
    show(index);
  };

  const updateCenter = () => {
    const line = innerHeight / 2;
    centered = highlights.find((highlight) => {
      const box = highlight.getBoundingClientRect();
      return box.top <= line && box.bottom > line;
    }) ?? null;
  };

  const updateHover = (target) => {
    const next = target?.closest?.(".highlight") ?? null;
    if (next === hovered) return;
    hovered = next;
    position();
    update();
  };

  addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    pointer = event;
    updateHover(event.target);
  }, { passive: true });

  document.documentElement.addEventListener("pointerleave", () => {
    pointer = null;
    updateHover(null);
  });

  addEventListener("scroll", () => {
    const previous = centered;
    updateCenter();
    if (tablet.matches || centered !== previous) update();
    if (!tablet.matches && pointer) {
      updateHover(document.elementFromPoint(pointer.clientX, pointer.clientY));
      position();
    }
  }, { passive: true });

  const reset = () => {
    updateCenter();
    update();
  };
  wide.addEventListener("change", reset);
  tablet.addEventListener("change", reset);
  phone.addEventListener("change", reset);
  motion.addEventListener("change", reset);

  const start = () => {
    ready = true;
    reset();
  };
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
