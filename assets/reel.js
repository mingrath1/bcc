// The film reel and the drawing's eyes. Without motion or JavaScript the article simply has neither.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canHover = matchMedia("(hover: hover) and (pointer: fine)");

  const eyes = [...document.querySelectorAll(".masthead__drawing .portrait__eye")];
  if (!calm && eyes.length && canHover.matches) {
    let looking = null;
    let queued = false;
    const look = () => {
      queued = false;
      for (const eye of eyes) {
        if (!looking) {
          eye.removeAttribute("transform");
          continue;
        }
        const box = eye.getBoundingClientRect();
        const angle = Math.atan2(looking[1] - box.y - box.height / 2, looking[0] - box.x - box.width / 2);
        eye.setAttribute("transform", `translate(${(Math.cos(angle) * 0.7).toFixed(2)} ${(Math.sin(angle) * 0.7).toFixed(2)})`);
      }
    };
    const aim = (spot) => {
      looking = spot;
      if (!queued) requestAnimationFrame(look);
      queued = true;
    };
    addEventListener("pointermove", (event) => aim([event.clientX, event.clientY]), { passive: true });
    root.addEventListener("pointerleave", () => aim(null));
  }

  const reel = document.querySelector(".reel");
  const strip = reel?.querySelector(".reel__strip");
  if (calm || !reel || !strip) return;
  root.classList.add("has-reel");

  const clips = [...strip.children];
  const chapters = [...document.querySelectorAll(".chapter")];
  const runs = [...document.querySelectorAll(".run")];
  const masthead = reel.parentElement;
  const before = reel.nextElementSibling;
  const quiet = navigator.connection?.saveData === true;
  const rail = matchMedia("(min-width: 781px) and (min-height: 721px)");
  const beside = matchMedia("(min-width: 541px) and (max-width: 780px)");
  const phone = matchMedia("(max-width: 540px)");

  strip.style.setProperty("--strip", clips.length);
  reel.style.setProperty("--strip", clips.length);
  for (const run of runs) {
    const slot = document.createElement("div");
    slot.className = "run__slot";
    run.append(slot);
  }

  const source = (clip, number) => {
    if (clip.src) return;
    clip.src = `assets/clips/${number}.mp4`;
  };
  const start = (clip, number) => {
    if (quiet) return;
    source(clip, number);
    clip.play().catch(() => {});
  };
  const pauseAll = (except) => clips.forEach((clip) => clip !== except && !clip.paused && clip.pause());

  // Below a chapter's title on a phone: each clip plays only while it is on screen.
  let phoneClips = null;
  const inView = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting && phone.matches) start(target, target.dataset.clip);
      else if (!target.paused) target.pause();
    }
  }, { threshold: 0.2 });
  const buildPhoneClips = () => {
    phoneClips = chapters.map((chapter) => {
      const clip = document.createElement("video");
      clip.className = "chapter__clip";
      clip.dataset.clip = chapter.dataset.clip;
      clip.muted = clip.loop = clip.playsInline = true;
      clip.preload = "none";
      clip.tabIndex = -1;
      clip.setAttribute("aria-hidden", "true");
      clip.poster = `assets/clips/${chapter.dataset.clip}.webp`;
      chapter.querySelector(".chapter__media").append(clip);
      inView.observe(clip);
      return clip;
    });
  };

  let settled = false;
  let hovered = null;
  let lastPointer = null;
  let current = -1;

  const lineTarget = (items) => {
    const line = innerHeight / 2;
    return items.find((item) => {
      const box = item.getBoundingClientRect();
      return box.top <= line && box.bottom > line;
    }) ?? null;
  };

  const showNumber = (number) => {
    reel.classList.toggle("is-on", number >= 0);
    if (number === current) return;
    current = number;
    if (number < 0) {
      pauseAll();
      return;
    }
    strip.style.setProperty("--at", number);
    pauseAll(clips[number]);
    start(clips[number], clips[number].dataset.clip);
  };

  const indexOf = (chapter) => chapters.indexOf(chapter);

  // On the rail the reel lines up with the chapter's words, and never covers the name above it.
  const lineUp = (chapter) => {
    const home = masthead.getBoundingClientRect().top + reel.offsetTop;
    const words = chapter.querySelector(".run, .chapter__title").getBoundingClientRect().top;
    const firstLine = chapter.getBoundingClientRect().top;
    const lowest = innerHeight - 16 - reel.offsetHeight;
    const wanted = Math.min(Math.max(Math.max(words, firstLine), home), lowest);
    reel.style.setProperty("--slide", `${Math.max(wanted - home, 0)}px`);
  };

  const moveReel = (slot, at) => {
    if (reel.parentElement === slot) return;
    reel.classList.remove("is-on");
    reel.style.removeProperty("--slide");
    slot.insertBefore(reel, at);
    void reel.offsetHeight;
  };

  const refresh = () => {
    if (!settled) return;
    if (phone.matches) {
      moveReel(masthead, before);
      showNumber(-1);
      if (!phoneClips) buildPhoneClips();
      return;
    }
    if (phoneClips) phoneClips.forEach((clip) => clip.pause());
    if (beside.matches) {
      const run = lineTarget(runs);
      if (!run) return;
      moveReel(run.querySelector(".run__slot"), null);
      showNumber(indexOf(run.closest(".chapter")));
      return;
    }
    moveReel(masthead, before);
    if (!rail.matches) {
      showNumber(-1);
      return;
    }
    const chapter = hovered ?? lineTarget(chapters);
    if (chapter) lineUp(chapter);
    showNumber(chapter ? indexOf(chapter) : -1);
  };

  const hoverAt = (x, y) => {
    hovered = document.elementFromPoint(x, y)?.closest(".chapter") ?? null;
    refresh();
  };

  addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    lastPointer = [event.clientX, event.clientY];
    hoverAt(...lastPointer);
  }, { passive: true });
  root.addEventListener("pointerleave", () => {
    lastPointer = null;
    hovered = null;
    refresh();
  });
  addEventListener("focusin", (event) => {
    hovered = event.target.closest(".chapter");
    refresh();
  });
  addEventListener("scroll", () => {
    if (lastPointer) hoverAt(...lastPointer);
    else refresh();
  }, { passive: true });
  addEventListener("resize", refresh, { passive: true });
  for (const query of [rail, beside, phone]) query.addEventListener("change", refresh);

  const ready = () => {
    clips.forEach((clip) => (clip.poster = `assets/clips/${clip.dataset.clip}.webp`));
    settled = true;
    refresh();
  };
  const whenIdle = () => ("requestIdleCallback" in window ? requestIdleCallback(ready, { timeout: 1200 }) : setTimeout(ready, 300));
  if (document.readyState === "complete") whenIdle();
  else addEventListener("load", whenIdle, { once: true });
})();
