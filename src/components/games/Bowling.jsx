import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";

// ── Bowling scoring (mirrors backend for local/character display) ────────────
function frameScore(frames, i) {
  const frame = frames[i];
  if (!frame || frame.rolls.length === 0) return null;
  const rolls = frame.rolls;
  const r0 = rolls[0] ?? 0, r1 = rolls[1] ?? 0;
  if (i < 9) {
    if (r0 === 10) { const n = nextTwoRolls(frames, i); return n === null ? null : 10 + n; }
    if (rolls.length === 2 && r0 + r1 === 10) { const n = nextOneRoll(frames, i); return n === null ? null : 10 + n; }
    if (rolls.length === 2) return r0 + r1;
    return null;
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const isStrikeOrSpare = r0 === 10 || (rolls.length >= 2 && r0 + r1 === 10);
  if (isStrikeOrSpare && rolls.length < 3) return null;
  if (!isStrikeOrSpare && rolls.length < 2) return null;
  return sum;
}
function nextOneRoll(frames, i) {
  for (let k = i + 1; k < frames.length; k++) if (frames[k].rolls.length > 0) return frames[k].rolls[0];
  return null;
}
function nextTwoRolls(frames, i) {
  const c = [];
  for (let k = i + 1; k < frames.length && c.length < 2; k++) for (const r of frames[k].rolls) { c.push(r); if (c.length >= 2) break; }
  return c.length < 2 ? null : c[0] + c[1];
}
function computeCumulatives(frames) {
  const cum = []; let total = 0;
  for (let i = 0; i < frames.length; i++) {
    const fs = frameScore(frames, i);
    cum.push(fs === null ? null : (total += fs));
  }
  return cum;
}
function isFrameComplete(frame, i) {
  if (frame.rolls.length === 0) return false;
  if (i < 9) return frame.rolls[0] === 10 || frame.rolls.length === 2;
  const r0 = frame.rolls[0] ?? 0, r1 = frame.rolls[1] ?? 0;
  const sos = r0 === 10 || (frame.rolls.length >= 2 && r0 + r1 === 10);
  return sos ? frame.rolls.length === 3 : frame.rolls.length === 2;
}
function emptyFrames() {
  return Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => ({ rolls: [] })));
}
function totalsFor(frames) {
  return frames.map(pf => {
    const cum = computeCumulatives(pf);
    return cum[9] ?? cum.filter(c => c !== null).pop() ?? 0;
  });
}

// ── Pin result from a throw (skill-based, variable, not predetermined) ───────
function computeThrow(aimError, power) {
  // aimError: 0 (perfect) .. ~1 (extreme). power: 0..1
  const accuracy = 1 - Math.min(aimError, 1);
  const powerFactor = Math.min(power, 1);
  const quality = accuracy * (0.45 + powerFactor * 0.55);
  // Gutter if very off-target
  if (accuracy < 0.25 && Math.random() < 0.5) return 0;
  let strikeChance;
  if (quality > 0.85) strikeChance = 0.62;
  else if (quality > 0.6) strikeChance = 0.26;
  else if (quality > 0.35) strikeChance = 0.08;
  else strikeChance = 0.01;
  if (Math.random() < strikeChance) return 10;
  const base = quality * 8 + 1;
  const pins = Math.max(0, Math.min(9, Math.round(base + (Math.random() * 4 - 2))));
  return pins;
}
function characterThrowQuality(character) {
  const traits = (character?.personality_traits || []).map(t => (t || "").toLowerCase());
  const competitive = traits.some(t => ["competitive","strategic","calculating","dominant","ambitious"].includes(t));
  const distracted = traits.some(t => ["easily distracted","goofy","chaotic","impulsive","carefree"].includes(t));
  const conscientious = traits.some(t => ["conscientious","disciplined","focused","perfectionist"].includes(t));
  let skill = 0.55;
  if (competitive) skill = 0.72;
  if (conscientious) skill = 0.68;
  if (distracted) skill = 0.42;
  // Variability per throw
  return Math.max(0.1, Math.min(0.95, skill + (Math.random() * 0.3 - 0.15)));
}

// ── Canvas dimensions (bowler's-eye perspective) ────────────────────────────
const LW = 280, LH = 440;
const PIN_R = 5;
const BALL_R = 22;           // large foreground ball
const LANE_TOP = 20;
const LANE_BOTTOM = 420;
const BALL_REST_Y = 380;
const FAR_HALF_W = 32;       // lane half-width at far end (pins)
const NEAR_HALF_W = 118;     // lane half-width at near end (bowler)
const PIN_AREA_Y = 110;      // y where ball reaches pins
const CX = LW / 2;

// Lane half-width at a given y (perspective interpolation)
function laneHalfWidthAt(y) {
  const t = Math.max(0, Math.min(1, (y - LANE_TOP) / (LANE_BOTTOM - LANE_TOP)));
  return FAR_HALF_W + (NEAR_HALF_W - FAR_HALF_W) * t;
}

// Ball radius at a given y (perspective: small when far, large when near)
function ballRadiusAt(y) {
  const t = Math.max(0, Math.min(1, (y - LANE_TOP) / (LANE_BOTTOM - LANE_TOP)));
  return BALL_R * (0.25 + 0.75 * t);
}

function pinPositions() {
  // Standard 4-3-2-1 rack: 4 pins farthest from bowler, 1 head pin closest.
  // Head pin is closest to the ball (which sits below the rack).
  const cx = CX;
  const topY = 38;
  const dy = 19;
  const spacing = 13;
  const pins = [];
  // Row 0: 4 pins (farthest from ball)
  for (let i = 0; i < 4; i++) {
    pins.push({ x: cx + (i - 1.5) * spacing, y: topY, standing: true, r: PIN_R });
  }
  // Row 1: 3 pins
  for (let i = 0; i < 3; i++) {
    pins.push({ x: cx + (i - 1) * spacing, y: topY + dy, standing: true, r: PIN_R });
  }
  // Row 2: 2 pins
  for (let i = 0; i < 2; i++) {
    pins.push({ x: cx + (i - 0.5) * spacing, y: topY + dy * 2, standing: true, r: PIN_R });
  }
  // Row 3: 1 head pin (closest to ball)
  pins.push({ x: cx, y: topY + dy * 3, standing: true, r: PIN_R });
  return pins;
}

// ── Pin rendering (bottle-shaped, not circles) ──────────────────────────────
function drawPin(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  // Pin body silhouette
  ctx.fillStyle = "#f5f5f0";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.35, y - r * 2.2);
  ctx.bezierCurveTo(x - r * 0.35, y - r * 1.6, x - r * 0.55, y - r * 0.9, x - r, y - r * 0.2);
  ctx.bezierCurveTo(x - r, y + r * 0.4, x - r * 0.85, y + r * 0.8, x - r * 0.75, y + r);
  ctx.lineTo(x + r * 0.75, y + r);
  ctx.bezierCurveTo(x + r * 0.85, y + r * 0.8, x + r, y + r * 0.4, x + r, y - r * 0.2);
  ctx.bezierCurveTo(x + r * 0.55, y - r * 0.9, x + r * 0.35, y - r * 1.6, x + r * 0.35, y - r * 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Red neck stripe
  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.42, y - r * 1.35);
  ctx.lineTo(x + r * 0.42, y - r * 1.35);
  ctx.stroke();
  // Subtle shading
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3, y, r * 0.25, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Ball rendering (dimensional, with finger holes) ──────────────────────────
function drawBall(ctx, x, y, r) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  const bg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  bg.addColorStop(0, "#a78bfa");
  bg.addColorStop(0.55, "#7c3aed");
  bg.addColorStop(1, "#4c1d95");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();
  // Highlight
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.35, r * 0.25, r * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // Finger holes
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  const hr = r * 0.11;
  ctx.beginPath(); ctx.arc(x - r * 0.22, y - r * 0.12, hr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.14, y - r * 0.12, hr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x - r * 0.04, y + r * 0.22, hr, 0, Math.PI * 2); ctx.fill();
}

export default function Bowling({
  mode, // "character" | "human"
  opponent, // { participant_name, participant_type, avatar_url, character? }
  gameId, // shared game id (human mode)
  myPlayerIndex, // 0 or 1
  roomName,
  onGameEnd,
}) {
  const canvasRef = useRef(null);
  const [frames, setFrames] = useState(emptyFrames);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [pinsStanding, setPinsStanding] = useState(10);
  const [turnState, setTurnState] = useState("aiming"); // aiming | throwing | resolving | char_turn | waiting | game_over
  const [lastPins, setLastPins] = useState(null);
  const [scoreFlash, setScoreFlash] = useState(null);

  const aimRef = useRef({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 });
  const ballRef = useRef({ x: LW / 2, y: BALL_REST_Y, vx: 0, vy: 0, rolling: false });
  const pinsRef = useRef(pinPositions());
  const animRef = useRef(null);
  const throwResolveRef = useRef(null);

  // ── Refs for character-turn execution (avoid re-trigger from parent re-renders) ──
  // executeThrow and opponent change identity on every parent re-render (because
  // onGameEnd is not memoized). Keeping them in the character-turn effect deps
  // causes the timeout to be cleared before it fires. These refs always hold the
  // latest values without forcing the effect to re-run.
  const executeThrowRef = useRef(null);
  const opponentRef = useRef(null);
  // Idempotency guard: prevents the same character turn from executing twice
  // (Strict Mode double-invoke, realtime re-renders, etc.)
  const charTurnLockRef = useRef(false);

  const isMyTurn = mode === "character" ? currentPlayer === 0 : currentPlayer === myPlayerIndex;
  const opponentIndex = mode === "character" ? 1 : (myPlayerIndex === 0 ? 1 : 0);
  const totals = totalsFor(frames);

  // ── Human mode: subscribe to shared game state ─────────────────────────────
  useEffect(() => {
    if (mode !== "human" || !gameId) return;
    const unsub = base44.entities.GatheringRoomGame.subscribe((event) => {
      if (!event.data || event.data.id !== gameId) return;
      const g = event.data;
      if (g.state) {
        setFrames(g.state.frames || emptyFrames());
        setCurrentPlayer(g.state.currentPlayer ?? 0);
        setCurrentFrame(g.state.currentFrame ?? 0);
        setPinsStanding(g.state.pinsStanding ?? 10);
        // Reset visual pins when a fresh rack is set
        if (g.state.pinsStanding === 10) pinsRef.current = pinPositions();
      }
      if (g.status === "completed") {
        setTurnState("game_over");
        const won = g.winner_index === myPlayerIndex ? "user_win" : g.winner_index === -1 ? "draw" : "char_win";
        setTimeout(() => onGameEnd?.(won), 800);
      }
    });
    return unsub;
  }, [mode, gameId, myPlayerIndex, onGameEnd]);

  // Load initial shared state for human mode
  useEffect(() => {
    if (mode !== "human" || !gameId) return;
    (async () => {
      try {
        const games = await base44.entities.GatheringRoomGame.filter({ id: gameId }, null, 1);
        const g = games[0];
        if (g?.state) {
          setFrames(g.state.frames || emptyFrames());
          setCurrentPlayer(g.state.currentPlayer ?? 0);
          setCurrentFrame(g.state.currentFrame ?? 0);
          setPinsStanding(g.state.pinsStanding ?? 10);
          setTurnState(g.state.currentPlayer === myPlayerIndex ? "aiming" : "waiting");
        }
      } catch (_) {}
    })();
  }, [mode, gameId, myPlayerIndex]);

  // ── Human mode: sync turnState to whose turn it is from shared state ────────
  useEffect(() => {
    if (mode !== "human" || turnState === "game_over") return;
    if (currentPlayer === myPlayerIndex && turnState === "waiting") {
      setTurnState("aiming");
    } else if (currentPlayer !== myPlayerIndex && turnState === "aiming") {
      setTurnState("waiting");
    }
  }, [mode, currentPlayer, myPlayerIndex, turnState]);

  // ── Drawing (bowler's-eye perspective) ─────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // Background (surrounding area — dark venue)
    ctx.fillStyle = "#0f0a06";
    ctx.fillRect(0, 0, LW, LH);

    // Lane (trapezoid — narrow at far end, wide at near end)
    const grad = ctx.createLinearGradient(0, LANE_TOP, 0, LANE_BOTTOM);
    grad.addColorStop(0, "#7a5c3a");
    grad.addColorStop(0.4, "#9a7a4f");
    grad.addColorStop(0.85, "#b89568");
    grad.addColorStop(1, "#c9a878");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(CX - FAR_HALF_W, LANE_TOP);
    ctx.lineTo(CX + FAR_HALF_W, LANE_TOP);
    ctx.lineTo(CX + NEAR_HALF_W, LANE_BOTTOM);
    ctx.lineTo(CX - NEAR_HALF_W, LANE_BOTTOM);
    ctx.closePath();
    ctx.fill();

    // Wood grain lines (perspective)
    ctx.strokeStyle = "rgba(80,55,30,0.25)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const y = LANE_TOP + t * (LANE_BOTTOM - LANE_TOP);
      const hw = laneHalfWidthAt(y);
      ctx.beginPath();
      ctx.moveTo(CX - hw, y);
      ctx.lineTo(CX + hw, y);
      ctx.stroke();
    }

    // Gutters (angled dark regions on both sides)
    ctx.fillStyle = "#241a0e";
    ctx.beginPath();
    ctx.moveTo(CX - FAR_HALF_W - 7, LANE_TOP);
    ctx.lineTo(CX - FAR_HALF_W, LANE_TOP);
    ctx.lineTo(CX - NEAR_HALF_W, LANE_BOTTOM);
    ctx.lineTo(CX - NEAR_HALF_W - 22, LANE_BOTTOM);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(CX + FAR_HALF_W, LANE_TOP);
    ctx.lineTo(CX + FAR_HALF_W + 7, LANE_TOP);
    ctx.lineTo(CX + NEAR_HALF_W + 22, LANE_BOTTOM);
    ctx.lineTo(CX + NEAR_HALF_W, LANE_BOTTOM);
    ctx.closePath();
    ctx.fill();

    // Lane arrows (aiming markers — converging toward center)
    ctx.fillStyle = "rgba(55,35,15,0.45)";
    for (let i = 0; i < 4; i++) {
      const y = LANE_BOTTOM - 70 - i * 28;
      const hw = laneHalfWidthAt(y);
      for (let j = -1; j <= 1; j++) {
        const x = CX + j * hw * 0.38;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4, y + 9);
        ctx.lineTo(x + 4, y + 9);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Foul line
    const foulY = LANE_BOTTOM - 28;
    const foulHW = laneHalfWidthAt(foulY);
    ctx.strokeStyle = "rgba(220,70,70,0.65)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(CX - foulHW, foulY);
    ctx.lineTo(CX + foulHW, foulY);
    ctx.stroke();

    // Pin deck (darker zone behind pins)
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.moveTo(CX - FAR_HALF_W, LANE_TOP);
    ctx.lineTo(CX + FAR_HALF_W, LANE_TOP);
    ctx.lineTo(CX + FAR_HALF_W + 4, LANE_TOP + 12);
    ctx.lineTo(CX - FAR_HALF_W - 4, LANE_TOP + 12);
    ctx.closePath();
    ctx.fill();

    // Pins (drawn as pin shapes, back-to-front for correct overlap)
    const standing = pinsRef.current.filter(p => p.standing).sort((a, b) => a.y - b.y);
    for (const p of standing) {
      drawPin(ctx, p.x, p.y, p.r || PIN_R);
    }

    // Aim line (converges toward pin area)
    const aim = aimRef.current;
    const ball = ballRef.current;
    if (aim.active && !ball.rolling && turnState === "aiming") {
      const dx = ball.x - aim.currentX;
      const dy = ball.y - aim.currentY;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        const ux = dx / len, uy = dy / len;
        // Project the aim line to the pin area
        const targetY = PIN_AREA_Y;
        const scale = (targetY - ball.y) / (uy || -0.01);
        const targetX = ball.x + ux * Math.abs(scale);
        ctx.save();
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
        ctx.setLineDash([]);
        // Aim target dot
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        ctx.arc(targetX, targetY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Power bar (bottom of lane)
        const power = Math.min(len / 80, 1);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(CX - NEAR_HALF_W, LANE_BOTTOM + 4, NEAR_HALF_W * 2, 6);
        ctx.fillStyle = power > 0.7 ? "rgba(239,68,68,0.9)" : power > 0.4 ? "rgba(251,191,36,0.9)" : "rgba(34,197,94,0.9)";
        ctx.fillRect(CX - NEAR_HALF_W, LANE_BOTTOM + 4, NEAR_HALF_W * 2 * power, 6);
      }
    }

    // Ball (with perspective size based on current y)
    const ballR = ballRadiusAt(ball.y);
    drawBall(ctx, ball.x, ball.y, ballR);
  }, [turnState]);

  // ── Animation loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      const ball = ballRef.current;
      if (ball.rolling) {
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vy *= 0.996;
        ball.vx *= 0.996;
        // Perspective gutter check — ball must stay within lane at current y
        const hw = laneHalfWidthAt(ball.y);
        const br = ballRadiusAt(ball.y);
        if (ball.x < CX - hw + br * 0.5) {
          ball.vx = 0;
          ball.x = CX - hw + br * 0.5;
        }
        if (ball.x > CX + hw - br * 0.5) {
          ball.vx = 0;
          ball.x = CX + hw - br * 0.5;
        }
        // Reached pins area
        if (ball.y <= PIN_AREA_Y) {
          ball.rolling = false;
          if (throwResolveRef.current) {
            const resolve = throwResolveRef.current;
            throwResolveRef.current = null;
            resolve();
          }
        }
        // Off top
        if (ball.y < LANE_TOP) {
          ball.rolling = false;
          if (throwResolveRef.current) {
            const resolve = throwResolveRef.current;
            throwResolveRef.current = null;
            resolve();
          }
        }
      }
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // ── Apply a roll result (knock pins, update state) ─────────────────────────
  // Returns { frameComplete, gameComplete } so callers can manage turn state.
  const applyRoll = useCallback((pinCount, playerIdx) => {
    let result = { frameComplete: false, gameComplete: false };
    setFrames(prev => {
      const newFrames = prev.map(pf => pf.map(f => ({ rolls: [...f.rolls] })));
      const pf = newFrames[playerIdx];
      const frame = pf[currentFrame];
      const before = pinsStanding;
      const pins = Math.max(0, Math.min(pinCount, before));
      frame.rolls.push(pins);

      // Knock down pins visually
      const standing = pinsRef.current.filter(p => p.standing);
      const toKnock = Math.min(pins, standing.length);
      const shuffled = [...standing].sort(() => Math.random() - 0.5);
      for (let i = 0; i < toKnock; i++) shuffled[i].standing = false;

      // Determine new pins standing + frame/turn advance
      const frameDone = isFrameComplete(frame, currentFrame);
      let newPinsStanding = before - pins;
      if (currentFrame === 9) {
        const r0 = frame.rolls[0] ?? 0, r1 = frame.rolls[1] ?? 0;
        if (frame.rolls.length === 1 && r0 === 10) newPinsStanding = 10;
        if (frame.rolls.length === 2 && r0 === 10 && r1 === 10) newPinsStanding = 10;
        if (frame.rolls.length === 2 && r0 !== 10 && r0 + r1 === 10) newPinsStanding = 10;
      } else {
        if (frameDone) newPinsStanding = 10;
        if (frame.rolls[0] === 10) newPinsStanding = 10;
      }
      setPinsStanding(newPinsStanding);
      result.frameComplete = frameDone;

      if (frameDone) {
        if (playerIdx === 0) {
          setCurrentPlayer(1);
          pinsRef.current = pinPositions();
        } else {
          const nextFrame = currentFrame + 1;
          if (nextFrame >= 10) {
            result.gameComplete = true;
            setTurnState("game_over");
            const t = totalsFor(newFrames);
            const max = Math.max(...t);
            const winners = t.map((x, i) => x === max ? i : -1).filter(i => i >= 0);
            const res = winners.length === 1 ? (winners[0] === 0 ? "user_win" : "char_win") : "draw";
            setTimeout(() => onGameEnd?.(res), 1000);
          } else {
            setCurrentFrame(nextFrame);
            setCurrentPlayer(0);
            pinsRef.current = pinPositions();
          }
        }
      }
      return newFrames;
    });
    return result;
  }, [currentPlayer, currentFrame, pinsStanding, onGameEnd]);

  // ── Execute a throw ─────────────────────────────────────────────────────────
  // Returns { pinCount, frameComplete, gameComplete }.
  const executeThrow = useCallback((aimError, power, playerIdx) => {
    return new Promise((resolve) => {
      const pinCount = computeThrow(aimError, power);
      setTurnState("throwing");
      const ball = ballRef.current;
      ball.rolling = true;
      ball.vx = (Math.random() - 0.5) * aimError * 6;
      ball.vy = -(4 + power * 8);
      throwResolveRef.current = () => {
        setLastPins(pinCount);
        setScoreFlash(pinCount === 10 ? "STRIKE! 🎳" : pinCount === 0 ? "Gutter 😬" : `+${pinCount}`);
        setTimeout(() => setScoreFlash(null), 1200);
        const r = applyRoll(pinCount, playerIdx);
        ball.x = LW / 2;
        ball.y = BALL_REST_Y;
        ball.vx = 0; ball.vy = 0;
        resolve({ pinCount, ...r });
      };
    });
  }, [applyRoll]);

  // ── Keep refs in sync with latest values (without triggering effect re-runs) ──
  executeThrowRef.current = executeThrow;
  opponentRef.current = opponent;

  // ── Character opponent turn ─────────────────────────────────────────────────
  // Triggers ONLY when the authoritative turn state changes (mode, currentPlayer,
  // turnState). Uses refs for executeThrow and opponent so that parent re-renders
  // (which recreate onGameEnd → applyRoll → executeThrow) do NOT clear the
  // timeout. An idempotency lock prevents duplicate execution from Strict Mode
  // or rapid re-renders.
  useEffect(() => {
    if (mode !== "character") return;
    if (currentPlayer !== 1 || turnState === "game_over") return;
    if (turnState !== "char_turn") return;
    // Idempotency: if a character turn is already executing for this turn state,
    // do not start another one. Released in cleanup so Strict Mode's double-invoke
    // still works (first run cleared, second run proceeds).
    if (charTurnLockRef.current) return;
    charTurnLockRef.current = true;

    const t = setTimeout(async () => {
      const fn = executeThrowRef.current;
      const opp = opponentRef.current;
      if (!fn) { charTurnLockRef.current = false; return; }
      const quality = characterThrowQuality(opp?.character);
      const aimError = (1 - quality) * 0.6 + Math.random() * 0.15;
      const power = 0.5 + Math.random() * 0.4;
      const r = await fn(aimError, power, 1);
      // Release the lock so the next character turn (second roll or next frame) can fire
      charTurnLockRef.current = false;
      if (r.gameComplete) return;
      if (r.frameComplete) {
        // frame done, currentPlayer now 0 → user's turn
        setTurnState("aiming");
      } else {
        // frame not complete → character rolls again
        setTurnState("char_turn");
      }
    }, 1100 + Math.random() * 700);
    return () => { clearTimeout(t); charTurnLockRef.current = false; };
    // Intentionally NOT depending on executeThrow or opponent — those change
    // identity on every parent re-render and would clear the timeout.
  }, [mode, currentPlayer, turnState]);

  // ── Human mode: after my throw resolves, send roll to backend ───────────────
  const submitHumanRoll = useCallback(async (pinCount) => {
    if (mode !== "human" || !gameId) return;
    try {
      await base44.functions.invoke("updateGatheringRoomGame", {
        game_id: gameId,
        action: "roll",
        as_player_index: myPlayerIndex,
        pin_count: pinCount,
      });
    } catch (err) {
      console.warn("Bowling roll submit failed", err?.message);
    }
  }, [mode, gameId, myPlayerIndex]);

  // ── Pointer handlers (user aim) ──────────────────────────────────────────────
  const getPos = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = LW / rect.width, sy = LH / rect.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  };

  const canAim = mode === "character"
    ? (currentPlayer === 0 && turnState === "aiming")
    : (currentPlayer === myPlayerIndex && turnState === "aiming");

  const onPointerDown = (e) => {
    if (!canAim) return;
    const pos = getPos(e);
    const ball = ballRef.current;
    if (Math.hypot(pos.x - ball.x, pos.y - ball.y) < BALL_R * 5) {
      aimRef.current = { active: true, startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y };
    }
  };
  const onPointerMove = (e) => {
    if (!aimRef.current.active) return;
    const pos = getPos(e);
    aimRef.current.currentX = pos.x;
    aimRef.current.currentY = pos.y;
  };
  const onPointerUp = async () => {
    if (!aimRef.current.active) return;
    const aim = aimRef.current;
    aim.active = false;
    const ball = ballRef.current;
    const dx = ball.x - aim.currentX, dy = ball.y - aim.currentY;
    const len = Math.hypot(dx, dy);
    if (len < 10) return;
    // aimError: deviation from straight up (negative y)
    const angle = Math.atan2(dy, dx);
    const straightAngle = -Math.PI / 2;
    const aimError = Math.abs(angle - straightAngle) / (Math.PI / 2); // 0..~1
    const power = Math.min(len / 120, 1);

    if (mode === "character") {
      const r = await executeThrow(aimError, power, 0);
      if (r.gameComplete) return;
      if (r.frameComplete) {
        // frame done, currentPlayer now 1 → character's turn
        setTurnState("char_turn");
      } else {
        // frame not complete (e.g. open first roll) → user rolls again
        setTurnState("aiming");
      }
    } else {
      // Human mode: compute pinCount locally, submit to backend, animate locally
      const pinCount = computeThrow(aimError, power);
      setTurnState("throwing");
      const b = ballRef.current;
      b.rolling = true;
      b.vx = (Math.random() - 0.5) * aimError * 6;
      b.vy = -(4 + power * 8);
      throwResolveRef.current = () => {
        setLastPins(pinCount);
        setScoreFlash(pinCount === 10 ? "STRIKE! 🎳" : pinCount === 0 ? "Gutter 😬" : `+${pinCount}`);
        setTimeout(() => setScoreFlash(null), 1200);
        const r = applyRoll(pinCount, myPlayerIndex);
        b.x = LW / 2; b.y = BALL_REST_Y; b.vx = 0; b.vy = 0;
        submitHumanRoll(pinCount);
        // If frame not complete, user rolls again; otherwise wait for opponent
        setTurnState(r.frameComplete ? "waiting" : "aiming");
      };
    }
  };

  // ── Reset pins visually when frame advances (handled in applyRoll) ──────────
  // ── Status text ─────────────────────────────────────────────────────────────
  const myName = mode === "character" ? "You" : (myPlayerIndex === 0 ? "You" : "You");
  const oppName = opponent?.participant_name || "Opponent";
  const statusText = turnState === "game_over"
    ? (totals[0] > totals[1] ? "You win! 🎉" : totals[1] > totals[0] ? `${oppName} wins!` : "Draw! 🤝")
    : turnState === "throwing" ? "Ball rolling…"
    : mode === "character" && currentPlayer === 1 ? `${oppName} is bowling…`
    : mode === "human" && currentPlayer !== myPlayerIndex ? `${oppName}'s turn…`
    : "Your turn — drag back from the ball & release";

  const frameLabel = (rolls, i) => {
    if (rolls.length === 0) return "";
    const r0 = rolls[0], r1 = rolls[1], r2 = rolls[2];
    if (i < 9) {
      if (r0 === 10) return "X";
      if (rolls.length === 2 && r0 + r1 === 10) return "/";
      if (rolls.length === 2) return `${r0} ${r1}`;
      return `${r0}`;
    }
    const parts = rolls.map((r, idx) => {
      if (r === 10) return "X";
      if (idx === 1 && rolls[0] !== 10 && rolls[0] + r === 10) return "/";
      if (idx === 2 && rolls[1] !== 10 && rolls[0] !== 10 && rolls[1] + r === 10) return "/";
      return r;
    });
    return parts.join(" ");
  };

  return (
    <div className="flex flex-col items-center gap-3 py-3 px-2">
      {/* Scoreboard */}
      <div className="w-full max-w-md overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {[0, 1].map(pi => {
            const cum = computeCumulatives(frames[pi]);
            const isMe = mode === "character" ? pi === 0 : pi === myPlayerIndex;
            const name = isMe ? "You" : oppName;
            const active = currentPlayer === pi && turnState !== "game_over";
            return (
              <div key={pi} className={`flex flex-col rounded-xl border ${active ? "border-primary bg-primary/5" : "border-border bg-secondary/40"} px-2 py-1.5`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {opponent?.avatar_url && !isMe && (
                    <img src={opponent.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                  )}
                  <span className={`text-[10px] font-bold ${isMe ? "text-primary" : "text-rose-400"}`}>{name}</span>
                  <span className="text-[10px] text-muted-foreground">{totals[pi]}</span>
                </div>
                <div className="flex">
                  {frames[pi].map((f, fi) => (
                    <div key={fi} className={`w-7 h-9 border border-border/60 flex flex-col items-center justify-center text-[9px] ${fi === 9 ? "w-10" : ""}`}>
                      <span className="font-mono leading-none">{frameLabel(f.rolls, fi)}</span>
                      <span className="text-muted-foreground mt-0.5 font-mono">{cum[fi] ?? ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status */}
      <AnimatePresence mode="wait">
        <motion.p
          key={statusText}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={`text-xs font-medium ${turnState === "game_over" ? "text-primary" : (mode === "character" && currentPlayer === 1) || (mode === "human" && currentPlayer !== myPlayerIndex) ? "text-rose-400 animate-pulse" : "text-muted-foreground"}`}
        >
          {statusText}
        </motion.p>
      </AnimatePresence>

      {/* Lane canvas — responsive, maintains aspect ratio */}
      <div className="relative w-full" style={{ maxWidth: LW }}>
        <canvas
          ref={canvasRef}
          width={LW}
          height={LH}
          className="rounded-xl touch-none w-full"
          style={{ aspectRatio: `${LW} / ${LH}`, cursor: canAim ? "crosshair" : "default" }}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchStart={onPointerDown}
          onTouchMove={onPointerMove}
          onTouchEnd={onPointerUp}
        />
        <AnimatePresence>
          {scoreFlash && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 0 }}
              animate={{ scale: 1.3, opacity: 1, y: -20 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="absolute top-1/3 left-1/2 -translate-x-1/2 text-2xl font-black text-yellow-300 drop-shadow-lg pointer-events-none"
            >
              {scoreFlash}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <p className="text-[10px] text-muted-foreground/60 text-center">
        Drag back from the ball to aim · release to bowl
      </p>
    </div>
  );
}