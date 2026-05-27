import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { GraduationCap } from "lucide-react";
import { base44 } from "@/api/base44Client";

const COMPLETION_LABELS = {
  diploma: '🎓 Diploma Earned',
  degree: '🎓 Degree Conferred',
  certificate: '📜 Certificate Earned',
  course_completion: '✅ Course Completed',
  training_completion: '🏅 Training Completed',
};

const COMPLETION_MESSAGES = {
  diploma: "has graduated! Hard work and dedication have paid off.",
  degree: "has earned their degree! A major milestone reached.",
  certificate: "earned their certification. A new credential on their profile.",
  course_completion: "completed the course. Knowledge gained, new doors open.",
  training_completion: "finished training. Ready for the next chapter.",
};

function ConfettiBurst() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: -20,
      w: Math.random() * 8 + 4,
      h: Math.random() * 5 + 2,
      color: ['#a78bfa','#34d399','#fbbf24','#f472b6','#60a5fa','#fb923c'][Math.floor(Math.random() * 6)],
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 4 + 2,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.2,
      opacity: 1,
    }));

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        p.vy += 0.05;
        p.opacity -= 0.007;
        if (p.opacity > 0 && p.y < canvas.height + 30) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.fillStyle = p.color;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }
      if (alive) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[115]"
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}

/**
 * GraduationEventModal
 *
 * Shown when a UserAchievement with event_type='graduation' is detected.
 * Triggered by AchievementUnlockModal's subscription, or directly from
 * the lifecycle checker via window event.
 */
export default function GraduationEventModal({ events, onDismiss }) {
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  if (!events || events.length === 0) return null;
  const ev = events[idx];
  if (!ev) return null;

  const advance = async () => {
    // Mark the achievement as seen
    if (ev.achievement_db_id) {
      base44.entities.UserAchievement.update(ev.achievement_db_id, { is_seen: true }).catch(() => {});
    }
    if (idx + 1 < events.length) {
      setIdx(idx + 1);
    } else {
      onDismiss?.();
    }
  };

  const completionLabel = COMPLETION_LABELS[ev.completion_type] || '🎓 Program Complete';
  const completionMsg = COMPLETION_MESSAGES[ev.completion_type] || 'has completed their program.';
  const dateStr = ev.completion_date
    ? new Date(ev.completion_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const modal = (
    <>
      <ConfettiBurst />
      <AnimatePresence>
        <motion.div
          key="grad-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[112] flex items-center justify-center bg-black/75 px-5"
        >
          <motion.div
            key={`grad-card-${ev.character_id}-${idx}`}
            initial={{ scale: 0.8, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="w-full max-w-sm bg-card border border-primary/30 rounded-3xl p-8 flex flex-col items-center text-center shadow-2xl"
          >
            {/* Icon */}
            <div className="relative mb-5">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl scale-150" />
              <div className="relative w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/40 flex items-center justify-center">
                <GraduationCap className="w-9 h-9 text-primary" />
              </div>
            </div>

            {/* Badge */}
            <span className="text-xs font-semibold text-primary uppercase tracking-widest mb-2 bg-primary/10 px-3 py-1 rounded-full">
              {completionLabel}
            </span>

            {/* Character name */}
            <h2 className="text-2xl font-bold text-foreground mt-3 mb-1">{ev.character_name}</h2>

            {/* Program */}
            {ev.program_name && (
              <p className="text-base text-primary/80 font-medium mb-1">{ev.program_name}</p>
            )}

            {/* Celebratory copy */}
            <p className="text-sm text-muted-foreground leading-relaxed mb-1">
              {ev.character_name} {completionMsg}
            </p>

            {/* Date */}
            <p className="text-xs text-muted-foreground/60 mt-1 mb-7">{dateStr}</p>

            <button
              onClick={advance}
              disabled={loading}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors active:scale-95"
            >
              🎉 Amazing!
            </button>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </>
  );

  return createPortal(modal, document.body);
}