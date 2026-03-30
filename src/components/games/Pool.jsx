import { useRef, useEffect, useState, useCallback } from "react";

const W = 360;
const H = 200;
const POCKET_R = 12;
const BALL_R = 9;

const POCKETS = [
  { x: POCKET_R, y: POCKET_R },
  { x: W / 2, y: POCKET_R - 4 },
  { x: W - POCKET_R, y: POCKET_R },
  { x: POCKET_R, y: H - POCKET_R },
  { x: W / 2, y: H - POCKET_R + 4 },
  { x: W - POCKET_R, y: H - POCKET_R },
];

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function initBalls() {
  // Cue ball (white) + 7 solids (user) + 7 stripes (char) + 8-ball
  const balls = [{ id: 0, x: 100, y: H / 2, vx: 0, vy: 0, color: "#ffffff", owner: "cue", pocketed: false }];
  let id = 1;
  const rows = [[0], [1, 2], [3, 4, 5], [6, 7, 8, 9], [10, 11, 12, 13, 14]];
  const startX = 250;
  rows.forEach((row, ri) => {
    row.forEach((_, ci) => {
      const x = startX + ri * (BALL_R * 1.9);
      const y = H / 2 - (row.length - 1) * BALL_R + ci * BALL_R * 2;
      const isEight = id === 5;
      const color = isEight ? "#111" : id <= 7 ? "#6366f1" : "#f97316";
      const owner = isEight ? "eight" : id <= 7 ? "user" : "char";
      balls.push({ id, x, y, vx: 0, vy: 0, color, owner, pocketed: false });
      id++;
    });
  });
  return balls;
}

export default function Pool({ character, onGameEnd }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    balls: initBalls(),
    aiming: false,
    aimStart: null,
    power: 0,
    isMoving: false,
    isUserTurn: true,
    gameOver: false,
  });
  const [status, setStatus] = useState("Your turn — drag from cue ball to aim");
  const [turn, setTurn] = useState("user");
  const rafRef = useRef(null);

  const pocketBall = useCallback((ball) => {
    const s = stateRef.current;
    ball.pocketed = true;
    ball.vx = 0; ball.vy = 0;

    if (ball.owner === "eight") {
      // 8 ball pocketed
      s.gameOver = true;
      const userBalls = s.balls.filter(b => b.owner === "user" && b.pocketed).length;
      const charBalls = s.balls.filter(b => b.owner === "char" && b.pocketed).length;
      const outcome = userBalls >= charBalls ? "user_win" : "char_win";
      setStatus(outcome === "user_win" ? "You win! 🎱" : `${character.name} wins! 🎱`);
      setTimeout(() => onGameEnd(outcome), 800);
      return;
    }
    if (ball.owner === "cue") {
      // Scratch — respawn cue ball
      ball.pocketed = false;
      ball.x = 100; ball.y = H / 2;
      ball.vx = 0; ball.vy = 0;
    }
  }, [character, onGameEnd]);

  const simulate = useCallback(() => {
    const s = stateRef.current;
    const balls = s.balls.filter(b => !b.pocketed);
    let anyMoving = false;

    for (const b of balls) {
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= 0.985;
      b.vy *= 0.985;

      // Wall bounce
      if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx) * 0.8; }
      if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx) * 0.8; }
      if (b.y - BALL_R < 0) { b.y = BALL_R; b.vy = Math.abs(b.vy) * 0.8; }
      if (b.y + BALL_R > H) { b.y = H - BALL_R; b.vy = -Math.abs(b.vy) * 0.8; }

      // Pocket check
      for (const p of POCKETS) {
        if (dist(b, p) < POCKET_R + BALL_R * 0.5) {
          pocketBall(b);
          break;
        }
      }

      if (Math.abs(b.vx) > 0.05 || Math.abs(b.vy) > 0.05) anyMoving = true;
    }

    // Ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        if (a.pocketed || b.pocketed) continue;
        const d = dist(a, b);
        if (d < BALL_R * 2) {
          const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
          const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
          const dot = dvx * nx + dvy * ny;
          if (dot > 0) {
            a.vx -= dot * nx; a.vy -= dot * ny;
            b.vx += dot * nx; b.vy += dot * ny;
          }
          const overlap = BALL_R * 2 - d;
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
          b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        }
      }
    }

    if (!anyMoving && s.isMoving && !s.gameOver) {
      s.isMoving = false;
      // Switch turns
      s.isUserTurn = !s.isUserTurn;
      setTurn(s.isUserTurn ? "user" : "char");
      setStatus(s.isUserTurn ? "Your turn — drag from cue ball to aim" : `${character.name} is shooting…`);
    }

    return anyMoving;
  }, [character, pocketBall]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;

    // Table
    ctx.fillStyle = "#166534";
    ctx.fillRect(0, 0, W, H);

    // Rail
    ctx.strokeStyle = "#4a3728";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, W - 8, H - 8);

    // Pockets
    for (const p of POCKETS) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    }

    // Aim line
    const cue = s.balls[0];
    if (s.aiming && s.aimStart && !cue.pocketed) {
      const dx = cue.x - s.aimStart.x;
      const dy = cue.y - s.aimStart.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 5) {
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1.5;
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(cue.x + dx * 2, cue.y + dy * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Balls
    for (const b of s.balls) {
      if (b.pocketed) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Stripe overlay
      if (b.owner === "char") {
        ctx.beginPath();
        ctx.arc(b.x, b.y, BALL_R, 0.3, Math.PI - 0.3);
        ctx.arc(b.x, b.y, BALL_R, Math.PI + 0.3, Math.PI * 2 - 0.3);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }
  }, []);

  // AI shot
  const doAIShot = useCallback(() => {
    const s = stateRef.current;
    const cue = s.balls[0];
    if (!cue || cue.pocketed) return;
    const targets = s.balls.filter(b => !b.pocketed && b.owner === "char");
    if (targets.length === 0) return;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const dx = target.x - cue.x;
    const dy = target.y - cue.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const power = 4 + Math.random() * 4;
    cue.vx = (dx / d) * power;
    cue.vy = (dy / d) * power;
    s.isMoving = true;
  }, []);

  useEffect(() => {
    const loop = () => {
      const s = stateRef.current;
      const moving = simulate();

      if (!moving && !s.isUserTurn && !s.isMoving && !s.gameOver) {
        // Trigger AI shot after brief pause
        s.isMoving = true;
        setTimeout(() => doAIShot(), 800);
      }

      draw();
      if (!s.gameOver) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [simulate, draw, doAIShot]);

  // Touch/mouse events for aiming
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const onPointerDown = (e) => {
    const s = stateRef.current;
    if (!s.isUserTurn || s.isMoving || s.gameOver) return;
    const pos = getPos(e);
    const cue = s.balls[0];
    if (dist(pos, cue) < BALL_R * 3) {
      s.aiming = true;
      s.aimStart = pos;
    }
  };

  const onPointerMove = (e) => {
    const s = stateRef.current;
    if (!s.aiming) return;
    s.aimStart = getPos(e);
  };

  const onPointerUp = (e) => {
    const s = stateRef.current;
    if (!s.aiming || !s.aimStart) return;
    s.aiming = false;
    const cue = s.balls[0];
    const dx = cue.x - s.aimStart.x;
    const dy = cue.y - s.aimStart.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;
    const power = Math.min(len / 25, 10);
    cue.vx = (dx / len) * power;
    cue.vy = (dy / len) * power;
    s.isMoving = true;
    s.aimStart = null;
    setStatus("Balls moving…");
  };

  return (
    <div className="flex flex-col items-center gap-4 py-4 px-2">
      {/* Legend */}
      <div className="flex gap-6 text-xs text-muted-foreground">
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#6366f1] mr-1" />You (solid)</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-[#f97316] border border-white/30 mr-1" />
          {character.name} (striped)</span>
      </div>

      <p className="text-xs text-muted-foreground text-center px-4">{status}</p>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="rounded-xl border border-border touch-none"
        style={{ width: "100%", maxWidth: W, cursor: "crosshair" }}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      />

      <p className="text-xs text-muted-foreground/60 text-center">
        Drag from the white cue ball to aim · release to shoot
      </p>
    </div>
  );
}