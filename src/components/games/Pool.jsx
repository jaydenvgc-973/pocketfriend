import { useRef, useEffect, useState, useCallback } from "react";
import { useGameBackground } from "./useGameBackground";

const W = 380;
const H = 210;
const POCKET_R = 13;
const BALL_R = 9;
const FRICTION = 0.988;
const MIN_SPEED = 0.08;

const POCKETS = [
  { x: POCKET_R + 2, y: POCKET_R + 2 },
  { x: W / 2, y: 2 },
  { x: W - POCKET_R - 2, y: POCKET_R + 2 },
  { x: POCKET_R + 2, y: H - POCKET_R - 2 },
  { x: W / 2, y: H - 2 },
  { x: W - POCKET_R - 2, y: H - POCKET_R - 2 },
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makeBalls() {
  const balls = [];
  // Cue ball
  balls.push({ id: 0, x: 95, y: H / 2, vx: 0, vy: 0, color: "#f0f0f0", owner: "cue", pocketed: false, number: 0 });
  // Rack triangle at ~280
  const rack = [
    [280, H/2],
    [280+BALL_R*1.95, H/2 - BALL_R],     [280+BALL_R*1.95, H/2 + BALL_R],
    [280+BALL_R*3.9,  H/2 - BALL_R*2],   [280+BALL_R*3.9,  H/2],           [280+BALL_R*3.9,  H/2 + BALL_R*2],
    [280+BALL_R*5.85, H/2 - BALL_R*3],   [280+BALL_R*5.85, H/2 - BALL_R],  [280+BALL_R*5.85, H/2 + BALL_R],  [280+BALL_R*5.85, H/2 + BALL_R*3],
  ];
  // Ball colors: 1-7 solids (user), 8 black, 9-15 stripes (char)
  const configs = [
    { color: "#facc15", owner: "user", number: 1 },
    { color: "#3b82f6", owner: "user", number: 2 },
    { color: "#ef4444", owner: "user", number: 3 },
    { color: "#a855f7", owner: "user", number: 4 },
    { color: "#f97316", owner: "user", number: 5 },
    { color: "#10b981", owner: "user", number: 6 },
    { color: "#ec4899", owner: "user", number: 7 },
    { color: "#1a1a1a", owner: "eight", number: 8 },
    { color: "#facc15", owner: "char", number: 9 },
    { color: "#3b82f6", owner: "char", number: 10 },
    { color: "#ef4444", owner: "char", number: 11 },
    { color: "#a855f7", owner: "char", number: 12 },
    { color: "#f97316", owner: "char", number: 13 },
    { color: "#10b981", owner: "char", number: 14 },
    { color: "#ec4899", owner: "char", number: 15 },
  ];

  // Shuffle rack (keep 8 in middle position index 4)
  const userBalls = configs.filter(c => c.owner === "user");
  const charBalls = configs.filter(c => c.owner === "char");
  const eight = configs.find(c => c.owner === "eight");

  const shuffled = [];
  const uArr = [...userBalls].sort(() => Math.random()-0.5);
  const cArr = [...charBalls].sort(() => Math.random()-0.5);
  const allMinusEight = [...uArr, ...cArr].sort(() => Math.random()-0.5);
  allMinusEight.splice(4, 0, eight); // 8 ball in center

  rack.forEach(([x, y], i) => {
    const cfg = allMinusEight[i] || configs[i];
    balls.push({ id: i+1, x, y, vx: 0, vy: 0, ...cfg, pocketed: false });
  });

  return balls;
}

// TURN STATES: "user_turn" | "aiming" | "shot_in_progress" | "resolving" | "char_turn" | "char_shooting" | "game_over"
export default function Pool({ character, onGameEnd }) {
  const canvasRef = useRef(null);
  const ballsRef = useRef(makeBalls());
  const turnStateRef = useRef("user_turn");
  const aimRef = useRef({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
  const [turnState, setTurnState] = useState("user_turn");
  const [userCount, setUserCount] = useState(7);
  const [charCount, setCharCount] = useState(7);
  const { bgUrl } = useGameBackground("pool");
  const rafRef = useRef(null);
  const charTimerRef = useRef(null);

  const syncCounts = useCallback(() => {
    const balls = ballsRef.current;
    setUserCount(balls.filter(b => b.owner === "user" && !b.pocketed).length);
    setCharCount(balls.filter(b => b.owner === "char" && !b.pocketed).length);
  }, []);

  const setTurn = useCallback((state) => {
    turnStateRef.current = state;
    setTurnState(state);
  }, []);

  const checkGameEnd = useCallback(() => {
    const balls = ballsRef.current;
    const eightPocketed = balls.find(b => b.owner === "eight")?.pocketed;
    if (!eightPocketed) return false;
    const userRemain = balls.filter(b => b.owner === "user" && !b.pocketed).length;
    const charRemain = balls.filter(b => b.owner === "char" && !b.pocketed).length;
    setTurn("game_over");
    setTimeout(() => onGameEnd(userRemain <= charRemain ? "user_win" : "char_win"), 600);
    return true;
  }, [onGameEnd, setTurn]);

  // Physics loop
  const physicsStep = useCallback(() => {
    const balls = ballsRef.current.filter(b => !b.pocketed);
    let anyMoving = false;

    for (const b of balls) {
      b.x += b.vx; b.y += b.vy;
      b.vx *= FRICTION; b.vy *= FRICTION;
      if (Math.abs(b.vx) < MIN_SPEED) b.vx = 0;
      if (Math.abs(b.vy) < MIN_SPEED) b.vy = 0;

      // Walls (inside rail)
      const minX = POCKET_R + BALL_R, maxX = W - POCKET_R - BALL_R;
      const minY = POCKET_R + BALL_R, maxY = H - POCKET_R - BALL_R;
      if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * 0.75; }
      if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * 0.75; }
      if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * 0.75; }
      if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * 0.75; }

      // Pocket check
      for (const p of POCKETS) {
        if (dist(b, p) < POCKET_R + 2) {
          b.pocketed = true; b.vx = 0; b.vy = 0;
          if (b.owner === "cue") {
            // Scratch: respawn
            b.pocketed = false; b.x = 95; b.y = H/2; b.vx = 0; b.vy = 0;
          }
          break;
        }
      }

      if (b.vx !== 0 || b.vy !== 0) anyMoving = true;
    }

    // Ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      for (let j = i+1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        if (a.pocketed || b.pocketed) continue;
        const d = dist(a, b);
        if (d < BALL_R * 2 && d > 0) {
          const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
          const dot = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (dot > 0) {
            a.vx -= dot * nx; a.vy -= dot * ny;
            b.vx += dot * nx; b.vy += dot * ny;
          }
          const overlap = BALL_R * 2 - d;
          a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
        }
      }
    }

    return anyMoving;
  }, []);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // Table background
    if (bgUrl) {
      const img = new Image();
      img.src = bgUrl;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#166534";
      ctx.fillRect(0, 0, W, H);
      // Rail
      ctx.strokeStyle = "#5c3a1e";
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, W-10, H-10);
    }

    // Pockets
    for (const p of POCKETS) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI*2);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Aim line
    const aim = aimRef.current;
    const cue = ballsRef.current[0];
    if (aim.active && cue && !cue.pocketed && (turnStateRef.current === "aiming" || turnStateRef.current === "user_turn")) {
      const dx = cue.x - aim.currentX;
      const dy = cue.y - aim.currentY;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        const ux = dx / len, uy = dy / len;
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(cue.x + ux * 120, cue.y + uy * 120);
        ctx.stroke();
        ctx.setLineDash([]);
        // Power indicator
        const power = Math.min(len / 50, 1);
        ctx.fillStyle = `rgba(${Math.round(255*power)},${Math.round(255*(1-power))},50,0.9)`;
        ctx.fillRect(12, H - 22, (W - 24) * power, 8);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(12, H - 22, W - 24, 8);
        ctx.restore();
      }
    }

    // Balls
    for (const b of ballsRef.current) {
      if (b.pocketed) continue;
      ctx.save();
      // Shadow
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI*2);
      ctx.fillStyle = b.color;
      ctx.fill();

      // Stripe for char balls
      if (b.owner === "char") {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = "#fff";
        ctx.fillRect(b.x - BALL_R, b.y - 3, BALL_R*2, 6);
        ctx.restore();
      }

      // Number on ball (8 ball special)
      if (b.owner === "eight") {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("8", b.x, b.y);
      }

      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI*2);
      ctx.stroke();

      // Highlight
      ctx.beginPath();
      ctx.arc(b.x - 2.5, b.y - 2.5, BALL_R * 0.38, 0, Math.PI*2);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fill();

      ctx.restore();
    }
  }, [bgUrl]);

  // Main RAF loop
  useEffect(() => {
    let lastTurnState = turnStateRef.current;

    const loop = () => {
      const state = turnStateRef.current;
      const moving = physicsStep();
      draw();

      if (state === "shot_in_progress" && !moving) {
        setTurn("resolving");
        syncCounts();
        if (!checkGameEnd()) {
          // Switch turn
          const wasCueTurn = lastTurnState === "shot_in_progress";
          setTimeout(() => {
            const cur = turnStateRef.current;
            if (cur === "resolving") setTurn("char_turn");
          }, 300);
        }
      }
      if (state === "char_shooting" && !moving) {
        setTurn("resolving");
        syncCounts();
        if (!checkGameEnd()) {
          setTimeout(() => {
            const cur = turnStateRef.current;
            if (cur === "resolving") setTurn("user_turn");
          }, 300);
        }
      }
      lastTurnState = state;
      if (turnStateRef.current !== "game_over") rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); };
  }, [physicsStep, draw, syncCounts, checkGameEnd]);

  // Character AI shot
  useEffect(() => {
    if (turnState !== "char_turn") return;
    charTimerRef.current = setTimeout(() => {
      const balls = ballsRef.current;
      const cue = balls[0];
      if (!cue || cue.pocketed) { setTurn("user_turn"); return; }
      const targets = balls.filter(b => !b.pocketed && b.owner === "char");
      if (targets.length === 0) { setTurn("user_turn"); return; }
      const target = targets[Math.floor(Math.random() * Math.min(targets.length, 3))];
      const dx = target.x - cue.x, dy = target.y - cue.y;
      const d = Math.hypot(dx, dy);
      const power = 5 + Math.random() * 5;
      cue.vx = (dx/d) * power * (0.7 + Math.random() * 0.5);
      cue.vy = (dy/d) * power * (0.7 + Math.random() * 0.5);
      setTurn("char_shooting");
    }, 1200 + Math.random() * 800);
    return () => clearTimeout(charTimerRef.current);
  }, [turnState, setTurn]);

  // Pointer events
  const getPos = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const scaleX = W / rect.width, scaleY = H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const onPointerDown = (e) => {
    if (turnStateRef.current !== "user_turn") return;
    const pos = getPos(e);
    const cue = ballsRef.current[0];
    if (!cue || cue.pocketed) return;
    if (dist(pos, cue) < BALL_R * 4) {
      aimRef.current = { active: true, startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y };
      setTurn("aiming");
    }
  };

  const onPointerMove = (e) => {
    if (!aimRef.current.active) return;
    const pos = getPos(e);
    aimRef.current.currentX = pos.x;
    aimRef.current.currentY = pos.y;
  };

  const onPointerUp = (e) => {
    if (!aimRef.current.active) return;
    const aim = aimRef.current;
    aim.active = false;
    const cue = ballsRef.current[0];
    if (!cue) return;
    const dx = cue.x - aim.currentX, dy = cue.y - aim.currentY;
    const len = Math.hypot(dx, dy);
    if (len < 8) { setTurn("user_turn"); return; }
    const power = Math.min(len / 50, 1) * 14 + 2;
    cue.vx = (dx/len) * power;
    cue.vy = (dy/len) * power;
    setTurn("shot_in_progress");
  };

  const reset = () => {
    ballsRef.current = makeBalls();
    aimRef.current = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
    setTurn("user_turn");
    syncCounts();
    if (!rafRef.current) {
      const loop = () => { physicsStep(); draw(); rafRef.current = requestAnimationFrame(loop); };
      rafRef.current = requestAnimationFrame(loop);
    }
  };

  const statusMap = {
    user_turn: "Your turn — drag from cue ball to aim",
    aiming: "Release to shoot",
    shot_in_progress: "Balls moving…",
    resolving: "Evaluating…",
    char_turn: `${character.name} is lining up a shot…`,
    char_shooting: `${character.name} shot!`,
    game_over: "Game over!",
  };

  return (
    <div className="flex flex-col items-center gap-3 py-4 px-2">
      {/* Scores */}
      <div className="flex gap-8 text-xs font-semibold w-full justify-center">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-primary inline-block" />
          You: {userCount} left
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-rose-400 inline-block border-2 border-white/30" />
          {character.name}: {charCount} left
        </span>
      </div>

      <p className={`text-xs font-medium ${turnState === "char_turn" || turnState === "char_shooting" ? "text-rose-400 animate-pulse" : "text-muted-foreground"}`}>
        {statusMap[turnState] || ""}
      </p>

      <div className="relative w-full">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="rounded-xl border border-border/60 touch-none w-full"
          style={{ cursor: turnState === "user_turn" ? "crosshair" : "default", maxWidth: W }}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-5 py-2 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          🔄 New Rack
        </button>
      </div>

      <div className="flex gap-6 text-[10px] text-muted-foreground/70">
        <span>■ Solid = You</span>
        <span>≡ Stripe = {character.name}</span>
        <span>● 8-ball = Match decider</span>
      </div>
    </div>
  );
}