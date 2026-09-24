"use client";

import { useEffect, useRef } from "react";

// The scene behind every page. Two stacked image layers so a change of html[data-backdrop]
// crossfades instead of swapping, a tint on top, and a small parallax on fine pointers.
// Everything runs on refs and DOM attributes: no React state, so no re-render per mousemove.
// Styles live in globals.css (.backdrop*). tokens.css stays the source of the image per mode.
export function Backdrop() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);

  // Crossfade on data-backdrop changes
  useEffect(() => {
    const root = document.documentElement;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    const imageNow = () => getComputedStyle(root).getPropertyValue("--backdrop-image").trim();
    // Freeze the visible layer to the current scene so a token change can't swap it in place
    let current = imageNow();
    a.style.backgroundImage = current;
    let front = a;
    let generation = 0;

    const observer = new MutationObserver(() => {
      const next = imageNow();
      if (!next || next === current) return;
      current = next;
      const gen = ++generation;
      const incoming = front === a ? b : a;
      incoming.style.backgroundImage = next;
      const swap = () => {
        if (gen !== generation) return;
        incoming.setAttribute("data-front", "");
        front.removeAttribute("data-front");
        front = incoming;
      };
      // Wait for the image so the fade never shows an empty layer. Give up after a second
      const src = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(next)?.[1];
      if (!src) return swap();
      const img = new Image();
      img.src = src;
      const timeout = window.setTimeout(swap, 1000);
      img
        .decode()
        .catch(() => undefined)
        .then(() => {
          window.clearTimeout(timeout);
          swap();
        });
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-backdrop"] });
    return () => observer.disconnect();
  }, []);

  // Parallax. Fine pointers only and never under reduced motion
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const query = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");

    let max = 0;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let frame = 0;

    const tick = () => {
      x += (tx - x) * 0.05;
      y += (ty - y) * 0.05;
      if (Math.abs(tx - x) < 0.05 && Math.abs(ty - y) < 0.05) {
        x = tx;
        y = ty;
        frame = 0;
      } else {
        frame = requestAnimationFrame(tick);
      }
      scene.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    };
    const aim = (nx: number, ny: number) => {
      tx = nx;
      ty = ny;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      // Scene drifts against the pointer, up to max px from centre
      aim(-(e.clientX / window.innerWidth - 0.5) * 2 * max, -(e.clientY / window.innerHeight - 0.5) * 2 * max);
    };
    const recentre = () => aim(0, 0);

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", recentre);
      window.removeEventListener("blur", recentre);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      tx = ty = x = y = 0;
      scene.style.transform = "";
      scene.removeAttribute("data-parallax");
    };
    const start = () => {
      max = parseFloat(getComputedStyle(scene).getPropertyValue("--parallax-max")) || 0;
      if (!max) return;
      scene.setAttribute("data-parallax", "");
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("mouseleave", recentre);
      window.addEventListener("blur", recentre);
    };
    const sync = () => {
      stop();
      if (query.matches) start();
    };

    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
      stop();
    };
  }, []);

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-scene" ref={sceneRef}>
        <div className="backdrop-layer" data-front="" ref={aRef} />
        <div className="backdrop-layer" ref={bRef} />
      </div>
      <div className="backdrop-tint" />
    </div>
  );
}
