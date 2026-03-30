import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGameBackground } from "./useGameBackground";

const DOTS = 5; // 5x5 dots = 4x4 boxes
const BOXES = DOTS - 1;

// Lines stored as flat arrays
// H lines: row 0..BOXES, col 0..BOXES-1  → index = row*(BOXES) + col
// V lines: row 0..BOXES-1, col 0..DOTS-1 → index = row*(DOTS) + col

function hIdx(r, c) { return r * BOXES + c; }
function vIdx(r, c) { return r * DOTS + c; }

const H_COUNT = (BOXES + 1) * BOXES;
const V_COUNT = BOXES * DOTS;

function initState() {
  return {
    h: new Array(H_COUNT).fill(false),
    v: new Array(V_COUNT).fill(false),
    boxes: new Array(BOXES * BOXES).fill(null), // null | "user" | "char"
  };
}

function claimBoxes(h, v, currentPlayer) {
  const boxes = new Array(BOXES * BOXES).fill(null);
  let scored = 0;
  for (let r = 0; r < BOXES; r++) {
    for (let c = 0; c < BOXES; c++) {
      const idx = r * BOXES + c;
      if (h[hIdx(r, c)] && h[hIdx(r+1, c)] && v[vIdx(r, c)] && v[vIdx(r, c+1)]) {
        boxes[idx] = currentPlayer;
        scored++;
      }
    }
  }
  return { boxes, scored };
}

function getAvailableLines(h, v) {
  const lines = [];
  for (let r = 0; r <= BOXES; r++)
    for (let c = 0; c < BOXES; c++)
      if (!h[hIdx(r,c)]) lines.push({ type: "h", r, c });
  for (let r = 0; r < BOXES; r++)
    for (let c = 0; c <= BOXES; c++)
      if (!v[vIdx(r,c)]) lines.push({ type: "v", r, c });
  return lines;
}

function aiMove(h, v) {
  const available = getAvailableLines(h, v);
  if (available.length === 0) return null;

  // 1. Win now: complete a box
  for (const line of available) {
    const nh = [...h], nv = [...v];
    if (line.type === "h") nh[hIdx(line.r, line.c)] = true;
    else nv[vIdx(line.r, line.c)] = true;
    const { scored } = claimBoxes(nh, nv, "char");
    if (scored > 0) return line;
  }

  // 2. Avoid giving opponent a box (don't make 3-sided box)
  const safe = available.filter(line => {
    const nh = [...h], nv = [...v];
    if (line.type === "h") nh[hIdx(line.r, line.c)] = true;
    else nv[vIdx(line.r, line.c)] = true;
    const { scored } = claimBoxes(nh, nv, "user");
    return scored === 0;
  });

  const pool = safe.length > 0 ? safe : available;
  return pool[Math.floor(Math.random() * pool.length)];
}

// TURN STATES: "user_turn" | "char_turn" | "game_over"
export default function DotsAndBoxes({ character, onGameEnd }) {
  const [state, setState] = useState(initState);
  const [turnState, setTurnState] = useState("user_turn");
  const [scores, setScores] = useState({ user: 0, char: 0 });
  const [thinking, setThinking] = useState(false);
  const [lastLine, setLastLine] = useState(null);
  const { bgUrl, loading: bgLoading } = useGameBackground("dotsandboxes");

  const applyLine = useCallback((prevState, line, player) => {
    const nh = [...prevState.h], nv = [...prevState.v];
    if (line.type === "h") nh[hIdx(line.r, line.c)] = true;
    else nv[vIdx(line.r, line.c)] = true;
    const { boxes, scored } = claimBoxes(nh, nv, player);
    // Merge existing claimed boxes with new
    const merged = prevState.boxes.map((b, i) => b || boxes[i]);
    return { h: nh, v: nv, boxes: merged, scored };
  }, []);

  const handleLineClick = useCallback((type, r, c) => {
    if (turnState !== "user_turn" || thinking) return;
    const lineKey = `${type}_${r}_${c}`;
    if (type === "h" && state.h[hIdx(r, c)]) return;
    if (type === "v" && state.v[vIdx(r, c)]) return;

    setLastLine(lineKey);
    const { h: nh, v: nv, boxes, scored } = applyLine(state, { type, r, c }, "user");
    const newState = { h: nh, v: nv, boxes };
    const newScores = { ...scores, user: scores.user + scored };
    setState(newState);
    setScores(newScores);

    const total = BOXES * BOXES;
    const claimed = boxes.filter(Boolean).length;
    if (claimed >= total) {
      setTurnState("game_over");
      const outcome = newScores.user > newScores.char ? "user_win" : newScores.char > newScores.user ? "char_win" : "draw";
      setTimeout(() => onGameEnd(outcome), 600);
      return;
    }

    // If no box scored, hand to character
    if (scored === 0) setTurnState("char_turn");
    // else user gets another turn
  }, [turnState, thinking, state, scores, applyLine, onGameEnd]);

  // Character AI turn
  useEffect(() => {
    if (turnState !== "char_turn") return;
    setThinking(true);
    let extraTurns = 0;
    const doCharTurn = (currentState, currentScores) => {
      const move = aiMove(currentState.h, currentState.v);
      if (!move) {
        setThinking(false);
        setTurnState("user_turn");
        return;
      }

      const timer = setTimeout(() => {
        const { h: nh, v: nv, boxes, scored } = applyLine(currentState, move, "char");
        const newState = { h: nh, v: nv, boxes };
        const newScores = { ...currentScores, char: currentScores.char + scored };
        const lineKey = `${move.type}_${move.r}_${move.c}`;
        setLastLine(lineKey);
        setState(newState);
        setScores(newScores);

        const total = BOXES * BOXES;
        const claimed = boxes.filter(Boolean).length;
        if (claimed >= total) {
          setThinking(false);
          setTurnState("game_over");
          const outcome = newScores.user > newScores.char ? "user_win" : newScores.char > newScores.user ? "char_win" : "draw";
          setTimeout(() => onGameEnd(outcome), 600);
          return;
        }

        if (scored > 0 && extraTurns < 5) {
          extraTurns++;
          doCharTurn(newState, newScores);
        } else {
          setThinking(false);
          setTurnState("user_turn");
        }
      }, 600 + Math.random() * 500);
    };
    doCharTurn(state, scores);
  }, [turnState]);

  const reset = () => {
    setState(initState());
    setTurnState("user_turn");
    setScores({ user: 0, char: 0 });
    setThinking(false);
    setLastLine(null);
  };

  // Grid rendering
  const DOT_GAP = 52;
  const BOARD_W = DOTS * DOT_GAP;
  const BOARD_H = DOTS * DOT_GAP;
  const DOT_R = 5;

  const statusText = turnState === "game_over"
    ? (scores.user > scores.char ? "You win! 🎉" : scores.char > scores.user ? `${character.name} wins!` : "Draw! 🤝")
    : thinking
    ? `${character.name} is thinking…`
    : turnState === "user_turn"
    ? "Your turn — tap a line segment"
    : "";

  return (
    <div className="relative flex flex-col items-center" style={{ minHeight: 380 }}>
      {/* BG */}
      <div className="absolute inset-0 overflow-hidden rounded-t-3xl">
        {bgUrl ? (
          <img src={bgUrl} alt="" className="w-full h-full object-cover opacity-20" draggable={false} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-950/40 to-blue-900/20" />
        )}
        <div className="absolute inset-0 bg-card/65" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 py-5 px-4 w-full">
        {/* Scores */}
        <div className="flex gap-8 text-sm font-bold">
          <span className="text-primary">You: {scores.user}</span>
          <span className="text-muted-foreground">/{BOXES*BOXES} boxes</span>
          <span className="text-rose-400">{character.name}: {scores.char}</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.p
            key={statusText}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-xs font-medium ${thinking ? "text-rose-400 animate-pulse" : "text-muted-foreground"}`}
          >
            {statusText}
          </motion.p>
        </AnimatePresence>

        {/* Board */}
        <div className="overflow-x-auto">
          <div className="relative" style={{ width: BOARD_W + 20, height: BOARD_H + 20 }}>

            {/* Claimed boxes */}
            {state.boxes.map((owner, idx) => {
              if (!owner) return null;
              const r = Math.floor(idx / BOXES), c = idx % BOXES;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`absolute rounded-md ${owner === "user" ? "bg-primary/35" : "bg-rose-400/35"}`}
                  style={{ left: c * DOT_GAP + DOT_R + 4, top: r * DOT_GAP + DOT_R + 4, width: DOT_GAP - DOT_R, height: DOT_GAP - DOT_R }}
                >
                  <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${owner === "user" ? "text-primary/70" : "text-rose-400/70"}`}>
                    {owner === "user" ? "✕" : "○"}
                  </span>
                </motion.div>
              );
            })}

            {/* Horizontal lines */}
            {Array.from({ length: BOXES + 1 }, (_, r) =>
              Array.from({ length: BOXES }, (_, c) => {
                const active = state.h[hIdx(r, c)];
                const key = `h_${r}_${c}`;
                return (
                  <div
                    key={key}
                    onClick={() => handleLineClick("h", r, c)}
                    title={!active && turnState === "user_turn" ? "Click to draw line" : ""}
                    className={`absolute rounded-full transition-all duration-200
                      ${active ? (lastLine === key ? "bg-foreground shadow-md" : "bg-foreground/80") : turnState === "user_turn" && !thinking ? "bg-border hover:bg-primary hover:scale-y-150 cursor-pointer" : "bg-border/50 cursor-default"}`}
                    style={{ left: c * DOT_GAP + DOT_R + 5, top: r * DOT_GAP + DOT_R - 3, width: DOT_GAP - DOT_R * 2, height: 6 }}
                  />
                );
              })
            )}

            {/* Vertical lines */}
            {Array.from({ length: BOXES }, (_, r) =>
              Array.from({ length: BOXES + 1 }, (_, c) => {
                const active = state.v[vIdx(r, c)];
                const key = `v_${r}_${c}`;
                return (
                  <div
                    key={key}
                    onClick={() => handleLineClick("v", r, c)}
                    className={`absolute rounded-full transition-all duration-200
                      ${active ? (lastLine === key ? "bg-foreground shadow-md" : "bg-foreground/80") : turnState === "user_turn" && !thinking ? "bg-border hover:bg-primary hover:scale-x-150 cursor-pointer" : "bg-border/50 cursor-default"}`}
                    style={{ left: c * DOT_GAP + DOT_R - 3, top: r * DOT_GAP + DOT_R + 5, width: 6, height: DOT_GAP - DOT_R * 2 }}
                  />
                );
              })
            )}

            {/* Dots */}
            {Array.from({ length: DOTS }, (_, r) =>
              Array.from({ length: DOTS }, (_, c) => (
                <div
                  key={`d_${r}_${c}`}
                  className="absolute rounded-full bg-foreground shadow-sm"
                  style={{ left: c * DOT_GAP + 4, top: r * DOT_GAP + 4, width: DOT_R*2, height: DOT_R*2 }}
                />
              ))
            )}
          </div>
        </div>

        <button onClick={reset} className="px-5 py-2 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors">
          {turnState === "game_over" ? "🔄 Rematch" : "↺ New Game"}
        </button>
      </div>
    </div>
  );
}