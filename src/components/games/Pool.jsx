import { useRef, useEffect, useState, useCallback } from "react";

const W = 380;
const H = 210;
const POCKET_R = 12;
const BALL_R = 9;
const FRICTION = 0.988;
const MIN_SPEED = 0.07;
const RAIL = 18; // rail thickness

const POCKETS = [
  { x: RAIL, y: RAIL },
  { x: W / 2, y: RAIL / 2 },
  { x: W - RAIL, y: RAIL },
  { x: RAIL, y: H - RAIL },
  { x: W / 2, y: H - RAIL / 2 },
  { x: W - RAIL, y: H - RAIL },
];

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makeBalls() {
  const balls = [];
  balls.push({ id: 0, x: 100, y: H / 2, vx: 0, vy: 0, color: "#f5f5f0", owner: "cue", pocketed: false, number: 0 });

  const rack = [
    [260, H/2],
    [260+BALL_R*2, H/2 - BALL_R],     [260+BALL_R*2, H/2 + BALL_R],
    [260+BALL_R*4, H/2 - BALL_R*2],   [260+BALL_R*4, H/2],           [260+BALL_R*4, H/2 + BALL_R*2],
    [260+BALL_R*6, H/2 - BALL_R*3],   [260+BALL_R*6, H/2 - BALL_R],  [260+BALL_R*6, H/2 + BALL_R],  [260+BALL_R*6, H/2 + BALL_R*3],
  ];

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

  const userBalls = configs.filter(c => c.owner === "user").sort(() => Math.random()-0.5);
  const charBalls = configs.filter(c => c.owner === "char").sort(() => Math.random()-0.5);
  const eight = configs.find(c => c.owner === "eight");
  const allMinusEight = [...userBalls, ...charBalls].sort(() => Math.random()-0.5);
  allMinusEight.splice(4, 0, eight);

  rack.forEach(([x, y], i) => {
    const cfg = allMinusEight[i] || configs[i];
    balls.push({ id: i+1, x, y, vx: 0, vy: 0, ...cfg, pocketed: false });
  });
  return balls;
}

// Draw the pool table using pure canvas — no AI images
function drawTable(ctx) {
  // Outer wooden frame
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#8B5E3C");
  grad.addColorStop(0.5, "#6B4226");
  grad.addColorStop(1, "#4A2C0A");
  ctx.fillStyle = grad;
  ctx.roundRect(0, 0, W, H, 8);
  ctx.fill();

  // Rail border highlight
  ctx.strokeStyle = "#A0693A";
  ctx.lineWidth = 2;
  ctx.roundRect(1, 1, W-2, H-2, 8);
  ctx.stroke();

  // Inner felt surface
  const feltGrad = ctx.createLinearGradient(RAIL, RAIL, W - RAIL, H - RAIL);
  feltGrad.addColorStop(0, "#1a6b2f");
  feltGrad.addColorStop(0.4, "#1e7d35");
  feltGrad.addColorStop(1, "#164f23");
  ctx.fillStyle = feltGrad;
  ctx.fillRect(RAIL, RAIL, W - RAIL*2, H - RAIL*2);

  // Felt texture lines (subtle)
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let x = RAIL; x < W - RAIL; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, RAIL);
    ctx.lineTo(x, H - RAIL);
    ctx.stroke();
  }

  // Center line (baulk line)
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(W / 2, RAIL);
  ctx.lineTo(W / 2, H - RAIL);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center spot
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 2.5, 0, Math.PI*2);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fill();

  // Baulk spot (cue ball area indicator)
  ctx.beginPath();
  ctx.arc(100, H / 2, 2, 0, Math.PI*2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();

  // Semicircle (D)
  ctx.beginPath();
  ctx.arc(100, H / 2, 22, -Math.PI/2, Math.PI/2);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Pockets
  for (const p of POCKETS) {
    // Pocket shadow
    ctx.beginPath();
    ctx.arc(p.x, p.y, POCKET_R + 3, 0, Math.PI*2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill();

    // Pocket hole
    ctx.beginPath();
    ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI*2);
    const pocketGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, POCKET_R);
    pocketGrad.addColorStop(0, "#0a0a0a");
    pocketGrad.addColorStop(0.7, "#111");
    pocketGrad.addColorStop(1, "#333");
    ctx.fillStyle = pocketGrad;
    ctx.fill();

    // Pocket rim
    ctx.beginPath();
    ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI*2);
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Rail inner edge highlight
  ctx.strokeStyle = "rgba(139,94,60,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(RAIL, RAIL, W - RAIL*2, H - RAIL*2);
}

function drawBall(ctx, b) {
  ctx.save();

  // Shadow
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;

  // Main ball body
  const ballGrad = ctx.createRadialGradient(b.x - 2.5, b.y - 2.5, 1, b.x, b.y, BALL_R);
  if (b.owner === "cue") {
    ballGrad.addColorStop(0, "#ffffff");
    ballGrad.addColorStop(0.7, "#e8e8e0");
    ballGrad.addColorStop(1, "#c8c8c0");
  } else if (b.owner === "eight") {
    ballGrad.addColorStop(0, "#2a2a2a");
    ballGrad.addColorStop(1, "#000000");
  } else {
    // Convert hex to slightly lighter for gradient
    ballGrad.addColorStop(0, lighten(b.color, 40));
    ballGrad.addColorStop(0.6, b.color);
    ballGrad.addColorStop(1, darken(b.color, 30));
  }

  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_R, 0, Math.PI*2);
  ctx.fillStyle = ballGrad;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Stripe for char balls
  if (b.owner === "char") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI*2);
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(b.x - BALL_R, b.y - 4, BALL_R*2, 8);
    ctx.restore();

    // Stripe colored center on white
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R, 0, Math.PI*2);
    ctx.clip();
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_R * 0.55, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // Number label
  if (b.owner === "eight" || (b.number && b.number <= 9)) {
    ctx.save();
    if (b.owner === "eight") {
      // White circle background for 8
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R * 0.5, 0, Math.PI*2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
    ctx.fillStyle = b.owner === "eight" ? "#111" : "#fff";
    ctx.font = `bold ${b.number >= 10 ? 6 : 7}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.number, b.x, b.y);
    ctx.restore();
  }

  // Shine highlight
  ctx.beginPath();
  ctx.arc(b.x - 3, b.y - 3, BALL_R * 0.35, 0, Math.PI*2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();

  // Outline
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_R, 0, Math.PI*2);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.restore();
}

function lighten(hex, amount) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}
function darken(hex, amount) {
  return lighten(hex, -amount);
}

export default function Pool({ character, onGameEnd }) {
  const canvasRef = useRef(null);
  const ballsRef = useRef(makeBalls());
  const turnStateRef = useRef("user_turn");
  const aimRef = useRef({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
  const [turnState, setTurnState] = useState("user_turn");
  const [userCount, setUserCount] = useState(7);
  const [charCount, setCharCount] = useState(7);
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

  const physicsStep = useCallback(() => {
    const balls = ballsRef.current.filter(b => !b.pocketed);
    let anyMoving = false;

    for (const b of balls) {
      b.x += b.vx; b.y += b.vy;
      b.vx *= FRICTION; b.vy *= FRICTION;
      if (Math.abs(b.vx) < MIN_SPEED) b.vx = 0;
      if (Math.abs(b.vy) < MIN_SPEED) b.vy = 0;

      const minX = RAIL + BALL_R, maxX = W - RAIL - BALL_R;
      const minY = RAIL + BALL_R, maxY = H - RAIL - BALL_R;
      if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * 0.72; }
      if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * 0.72; }
      if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * 0.72; }
      if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * 0.72; }

      for (const p of POCKETS) {
        if (dist(b, p) < POCKET_R + 1) {
          b.pocketed = true; b.vx = 0; b.vy = 0;
          if (b.owner === "cue") {
            b.pocketed = false; b.x = 100; b.y = H/2;
          }
          break;
        }
      }
      if (b.vx !== 0 || b.vy !== 0) anyMoving = true;
    }

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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // Draw the structured table
    drawTable(ctx);

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
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(cue.x + ux * 130, cue.y + uy * 130);
        ctx.stroke();
        ctx.setLineDash([]);

        // Cue stick
        ctx.strokeStyle = "rgba(160,100,40,0.7)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cue.x - ux * (BALL_R + 4), cue.y - uy * (BALL_R + 4));
        ctx.lineTo(cue.x - ux * 60, cue.y - uy * 60);
        ctx.stroke();

        // Power bar
        const power = Math.min(len / 50, 1);
        ctx.fillStyle = `rgba(0,0,0,0.5)`;
        ctx.fillRect(RAIL, H - RAIL + 2, W - RAIL*2, 6);
        const barColor = power > 0.7 ? `rgba(239,68,68,0.9)` : power > 0.4 ? `rgba(251,191,36,0.9)` : `rgba(34,197,94,0.9)`;
        ctx.fillStyle = barColor;
        ctx.fillRect(RAIL, H - RAIL + 2, (W - RAIL*2) * power, 6);
        ctx.restore();
      }
    }

    // Balls
    for (const b of ballsRef.current) {
      if (b.pocketed) continue;
      drawBall(ctx, b);
    }
  }, []);

  useEffect(() => {
    const loop = () => {
      const state = turnStateRef.current;
      const moving = physicsStep();
      draw();

      if (state === "shot_in_progress" && !moving) {
        setTurn("resolving");
        syncCounts();
        if (!checkGameEnd()) {
          setTimeout(() => {
            if (turnStateRef.current === "resolving") setTurn("char_turn");
          }, 300);
        }
      }
      if (state === "char_shooting" && !moving) {
        setTurn("resolving");
        syncCounts();
        if (!checkGameEnd()) {
          setTimeout(() => {
            if (turnStateRef.current === "resolving") setTurn("user_turn");
          }, 300);
        }
      }
      if (turnStateRef.current !== "game_over") rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [physicsStep, draw, syncCounts, checkGameEnd]);

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
    if (dist(pos, cue) < BALL_R * 5) {
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

  const onPointerUp = () => {
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
  };

  const statusMap = {
    user_turn: "Your turn — drag near cue ball to aim & release",
    aiming: "Release to shoot",
    shot_in_progress: "Balls moving…",
    resolving: "Evaluating…",
    char_turn: `${character.name} is lining up a shot…`,
    char_shooting: `${character.name} shot!`,
    game_over: "Game over!",
  };

  return (
    <div className="flex flex-col items-center gap-3 py-4 px-2">
      <div className="flex gap-8 text-xs font-semibold w-full justify-center">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block ring-1 ring-white/20" />
          You: {userCount} left
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block border-2 border-white/40 ring-1 ring-white/20" style={{ backgroundImage: "repeating-linear-gradient(90deg,#fff 0px,#fff 3px,transparent 3px,transparent 6px)" }} />
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
          className="rounded-xl touch-none w-full"
          style={{ cursor: turnState === "user_turn" ? "crosshair" : "default", maxWidth: W, imageRendering: "crisp-edges" }}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        />
      </div>

      <div className="flex gap-3">
        <button onClick={reset} className="px-5 py-2 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors">
          🔄 New Rack
        </button>
      </div>

      <div className="flex gap-6 text-[10px] text-muted-foreground/70">
        <span>■ Solid = You</span>
        <span>≡ Stripe = {character.name}</span>
        <span>● 8-ball = Decider</span>
      </div>
    </div>
  );
}