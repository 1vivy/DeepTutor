"use client";

/**
 * Clearing a knowledge point's gate is the one real payoff Mastery Path
 * offers — and until now the product gave it nothing back beyond a number
 * ticking up in a rail most learners keep collapsed. This is that payoff
 * made visible: a canvas confetti burst portalled straight to
 * ``document.body``.
 *
 * Portalled rather than rendered in place: this screen's shell uses
 * ``overflow-hidden`` and the outline column has its own stacking context,
 * so a plain ``position: fixed`` div nested under either would still be a
 * citizen of that box. Escaping to `document.body` is what lets the burst
 * spray across the whole viewport — outline, header, and the conversation
 * both sit under it as one surface, not three.
 *
 * Physics run on a plain 2D canvas — no charting or particle dependency
 * pulled in for a two-and-a-half-second effect nobody sees twice in a row.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { PartyPopper } from "lucide-react";

const COLORS = [
  "#FF5D5D",
  "#FFB020",
  "#FFDE59",
  "#4ADE80",
  "#38BDF8",
  "#818CF8",
  "#F472B6",
];

const BURST_MS = 2600;
const FADE_MS = 500;
const TOAST_MS = 2000;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
  shape: "rect" | "circle";
}

function spawnBurst(
  originX: number,
  originY: number,
  count: number,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    // A wide upward cone — mostly straight up with generous spread either
    // side, the shape of a firework rather than a directionless cloud.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.85;
    const speed = 6 + Math.random() * 9;
    particles.push({
      x: originX + (Math.random() - 0.5) * 40,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.35,
      shape: Math.random() < 0.7 ? "rect" : "circle",
    });
  }
  return particles;
}

export function LevelUpCelebration({
  label,
  onDone,
}: {
  /** Toast copy, e.g. "已掌握「State in LangGraph」" — already translated. */
  label: string;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [toastVisible, setToastVisible] = useState(true);
  const [skipConfetti] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const toastTimer = setTimeout(() => setToastVisible(false), TOAST_MS);
    const doneTimer = setTimeout(
      onDone,
      skipConfetti ? TOAST_MS + FADE_MS : BURST_MS,
    );

    if (skipConfetti) {
      return () => {
        clearTimeout(toastTimer);
        clearTimeout(doneTimer);
      };
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return () => {
        clearTimeout(toastTimer);
        clearTimeout(doneTimer);
      };
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    const originY = window.innerHeight * 0.62;
    // Two bursts off-center plus a beat-later third down the middle reads as
    // one eruption filling the screen, not a single point of confetti.
    let particles = [
      ...spawnBurst(window.innerWidth * 0.28, originY, 70),
      ...spawnBurst(window.innerWidth * 0.72, originY, 70),
    ];
    let thirdBurstFired = false;

    const GRAVITY = 0.22;
    const DRAG = 0.992;
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      if (!thirdBurstFired && elapsed > 180) {
        particles.push(...spawnBurst(window.innerWidth * 0.5, originY, 60));
        thirdBurstFired = true;
      }

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const fadeStart = BURST_MS - FADE_MS;
      const globalFade =
        elapsed > fadeStart
          ? Math.max(0, 1 - (elapsed - fadeStart) / FADE_MS)
          : 1;

      for (const p of particles) {
        p.vy += GRAVITY;
        p.vx *= DRAG;
        p.vy *= DRAG;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;

        ctx.save();
        ctx.globalAlpha = globalFade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (elapsed < BURST_MS) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(toastTimer);
      clearTimeout(doneTimer);
      window.removeEventListener("resize", resize);
    };
    // Runs exactly once per mount — the parent forces a remount (a fresh
    // `key`) for every new celebration rather than letting this effect
    // re-fire, so mid-flight particles from the last gate never restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[999]">
      {!skipConfetti && <canvas ref={canvasRef} className="absolute inset-0" />}
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
            className="absolute left-1/2 top-[16%] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/95 px-4 py-2 shadow-[0_12px_36px_-8px_rgba(0,0,0,0.35)] backdrop-blur"
          >
            <PartyPopper className="h-4 w-4 shrink-0 text-[var(--primary)]" />
            <span className="text-[13px] font-semibold text-[var(--foreground)]">
              {label}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
