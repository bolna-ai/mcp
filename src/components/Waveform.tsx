"use client";

import { useEffect, useRef } from "react";

const BAR_COUNT = 64;

export default function Waveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const seeds = Array.from({ length: BAR_COUNT }, (_, i) => ({
      phase: (i / BAR_COUNT) * Math.PI * 2 + i * 0.37,
      speed: 0.6 + ((i * 13) % 7) / 10,
      base: 0.18 + ((i * 29) % 11) / 22,
    }));

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      const gap = width / BAR_COUNT;
      const barWidth = Math.max(gap * 0.42, 1.5);
      const time = t / 1000;
      const mid = height / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        const s = seeds[i]!;
        const envelope =
          0.5 + 0.5 * Math.sin(i * 0.25 - time * 0.5);
        const amp = reduceMotion
          ? s.base
          : s.base +
            0.34 *
              envelope *
              (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
        const barHeight = Math.max(height * amp, 2);
        const x = i * gap + (gap - barWidth) / 2;
        const y = mid - barHeight / 2;

        const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
        grad.addColorStop(0, "rgba(0, 246, 255, 0.9)");
        grad.addColorStop(1, "rgba(126, 214, 223, 0.35)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        const r = Math.min(barWidth / 2, 3);
        ctx.roundRect(x, y, barWidth, barHeight, r);
        ctx.fill();
      }

      if (!reduceMotion) {
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="waveform" aria-hidden="true" />;
}
