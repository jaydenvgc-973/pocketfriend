import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useGameBackground } from "./useGameBackground";

const DOTS = 5;
const BOXES = DOTS - 1;

function hIdx(r, c) { return r * BOXES + c; }
function vIdx(r, c) { return r * DOTS + c; }

const H_COUNT = (BOXES + 1) * BOXES;
const V_COUNT = BOXES * DOTS;

function initState() {
  return {
    h: new Array(H_COUNT).fill(false),
    v: new Array(V_COUNT).fill(false),
    boxes: new Array(BOXES * BOXES).fill(null),
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
  for (const line of available) {
    const nh = [...h], nv = [...v];
    if (line.type === "h") nh[hIdx(line.r, line.c)] = true;
    else nv[vIdx(line.r, line.c)] = true;
    const { scored } = claimBoxes(nh, nv, "char");
    if (scored > 0) return line;
  }
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

export default function DotsAndBoxes({ character, onGameEnd, mode = "character", gameId, myPlayerIndex = 0, opponent }) {
  // ── Character mode state ──
  const [state, setState] = useState(initState);
  const [turnState, setTurnState] = useState("user_turn");
  const [scores, setScores] = useState({ user: 0, char: 0 });
  const [thinking, setThinking] = useState(false);
  const [lastLine, setLastLine] = useState(null);

  // ── Human shared mode state ──
  const [sharedState, setSharedState] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { bgUrl, loading: bgLoading } = useGameBackground("dotsandboxes");
  const isHuman = mode === "human";
  const oppName = isHuman ? (opponent?.participant_name || "Opponent") : (character?.name || "Opponent");

  // ── Load + subscribe to shared game (human mode) ──
  useEffect(() => {
    if (!isHuman || !gameId) return;
    let unsub = () => {};
    (async () => {
      try {
        const games = await base44.entities.GatheringRoomGame.filter({ id: gameId }, null, 1);
        if (games[0]?.state) setSharedState(games[0].state);
      } catch (_) {}
      unsub = base44.entities.GatheringRoomGame.subscribe((event) => {
        if (event.data?.id === gameId && event.data?.state) {
          setSharedState(event.data.state);
        }
      });
    })();
    return () => unsub();
  }, [isHuman, gameId]);

  // ── Handle game completion (human mode) ──
  useEffect(() => {
    if (!isHuman || sharedState?.winner === null || sharedState?.winner === undefined) return;
    const outcome = sharedState.winner === -1 ? "draw"
      : sharedState.winner === myPlayerIndex ? "user_win" : "char_win";
    const timer = setTimeout(() => onGameEnd?.(outcome), 600);
    return () => clearTimeout(timer);
  }, [isHuman, sharedState, myPlayerIndex, onGameEnd]);

  // ── Character mode line application ──
  const applyLine = useCallback((prevState, line, player) => {
    const nh = [...prevState.h], nv = [...prevState.v];
    if (line.type === "h") nh[hIdx(line.r, line.c)] = true;
    else nv[vIdx(line.r, line.c)] = true;
    const { boxes, scored } = claimBoxes(nh, nv, player);
    const merged = prevState.boxes.map((b, i) => b || boxes[i]);
    return { h: nh, v: nv, boxes: merged, scored };
  }, []);

  // ── Character mode click ──
  const handleLineClick = useCallback((type, r, c) => {
    if (isHuman || turnState !== "user_turn" || thinking) return;
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
    if (scored === 0) setTurnState("char_turn");
  }, [isHuman, turnState, thinking, state, scores, applyLine, onGameEnd]);

  // ── Human mode click ──
  const handleHumanLineClick = async (type, r, c) => {
    if (submitting || !sharedState || sharedState.winner !== null) return;
    if (sharedState.currentPlayer !== myPlayerIndex) return;
    if (type === "h" && sharedState.h[hIdx(r, c)]) return;
    if (type === "v" && sharedState.v[vIdx(r, c)]) return;
    setSubmitting(true);
    setLastLine(`${type}_${r}_${c}`);
    try {
      await base44.functions.invoke("updateGatheringRoomGame", {
        game_id: gameId, action: "move", as_player_index: myPlayerIndex, move: { type, r, c },
      });
    } catch (err) { console.warn("Move failed", err?.message); }
    setSubmitting(false);
  };

  // ── Character AI turn ──
  useEffect(() => {
    if (isHuman || turnState !== "char_turn") return;
    setThinking(true);
    let extraTurns = 0;
    const doCharTurn = (currentState, currentScores) => {
      const move = aiMove(currentState.h, currentState.v);
      if (!move) { setThinking(false); setTurnState("user_turn"); return; }
      const timer = setTimeout(() => {
        const { h: nh, v: nv, boxes, scored } = applyLine(currentState, move, "char");
        const newState = { h: nh, v: nv, boxes };
        const newScores = { ...currentScores, char: currentScores.char + scored };
        setLastLine(`${move.type}_${move.r}_${move.c}`);
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
        if (scored > 0 && extraTurns < 5) { extraTurns++; doCharTurn(newState, newScores); }
        else { setThinking(false); setTurnState("user_turn"); }
      }, 600 + Math.random() * 500);
    };
    doCharTurn(state, scores);
  }, [turnState, isHuman]);

  const reset = () => {
    if (isHuman) return;
    setState(initState());
    setTurnState("user_turn");
    setScores({ user: 0, char: 0 });
    setThinking(false);
    setLastLine(null);
  };

  // ── Unified display state ──
  const displayH = isHuman ? (sharedState?.h || new Array(H_COUNT).fill(false)) : state.h;
  const displayV = isHuman ? (sharedState?.v || new Array(V_COUNT).fill(false)) : state.v;
  const displayBoxes = isHuman ? (sharedState?.boxes || new Array(BOXES * BOXES).fill(null)) : state.boxes;
  const displayScores = isHuman ? (sharedState?.scores || [0, 0]) : [scores.user, scores.char];
  const isMyTurn = isHuman
    ? (sharedState?.currentPlayer === myPlayerIndex && sharedState?.winner === null && !submitting)
    : (turnState === "user_turn" && !thinking);
  const gameWinner = isHuman ? sharedState?.winner : null;
  const isGameOver = isHuman ? (gameWinner !== null && gameWinner !== undefined) : turnState === "game_over";

  const DOT_GAP = 52;
  const BOARD_W = DOTS * DOT_GAP;
  const BOARD_H = DOTS * DOT_GAP;
  const DOT_R = 5;

  const statusText = isHuman
    ? (gameWinner === -1 ? "Draw! 🤝"
      : gameWinner !== null && gameWinner !== undefined ? (gameWinner === myPlayerIndex ? "You win! 🎉" : `${oppName} wins!`)
      : isMyTurn ? "Your turn — tap a line"
      : submitting ? "Sending…"
      : `Waiting for ${oppName}…`)
    : (turnState === "game_over"
      ? (scores.user > scores.char ? "You win! 🎉" : scores.char > scores.user ? `${oppName} wins!` : "Draw! 🤝")
      : thinking ? `${oppName} is thinking…`
      : turnState === "user_turn" ? "Your turn — tap a line segment"
      : "");

  const onLineClick = isHuman ? handleHumanLineClick : handleLineClick;

  return (
    <div className="relative flex flex-col items-center" style={{ minHeight: 380 }}>
      <div className="absolute inset-0 overflow-hidden rounded-t-3xl">
        {bgUrl ? <img src={bgUrl} alt="" className="w-full h-full object-cover opacity-20" draggable={false} />
          : <div className="w-full h-full bg-gradient-to-br from-purple-950/40 to-blue-900/20" />}
        <div className="absolute inset-0 bg-card/65" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 py-5 px-4 w-full">
        {/* Scores */}
        <div className="flex gap-8 text-sm font-bold">
          <span className="text-primary">{isHuman ? (myPlayerIndex === 0 ? "You" : oppName) : "You"}: {displayScores[0]}</span>
          <span className="text-muted-foreground">/{BOXES*BOXES} boxes</span>
          <span className="text-rose-400">{isHuman ? (myPlayerIndex === 1 ? "You" : oppName) : oppName}: {displayScores[1]}</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.p
            key={statusText}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-xs font-medium ${isHuman && !isMyTurn && !isGameOver ? "text-amber-400" : "text-muted-foreground"}`}
          >
            {statusText}
          </motion.p>
        </AnimatePresence>

        {/* Board */}
        <div className="overflow-x-auto">
          <div className="relative" style={{ width: BOARD_W + 20, height: BOARD_H + 20 }}>
            {/* Claimed boxes */}
            {displayBoxes.map((owner, idx) => {
              if (owner === null || owner === undefined) return null;
              const r = Math.floor(idx / BOXES), c = idx % BOXES;
              const isMine = isHuman ? owner === myPlayerIndex : owner === "user";
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`absolute rounded-md ${isMine ? "bg-primary/35" : "bg-rose-400/35"}`}
                  style={{ left: c * DOT_GAP + DOT_R + 4, top: r * DOT_GAP + DOT_R + 4, width: DOT_GAP - DOT_R, height: DOT_GAP - DOT_R }}
                >
                  <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${isMine ? "text-primary/70" : "text-rose-400/70"}`}>
                    {isMine ? "✕" : "○"}
                  </span>
                </motion.div>
              );
            })}

            {/* Horizontal lines */}
            {Array.from({ length: BOXES + 1 }, (_, r) =>
              Array.from({ length: BOXES }, (_, c) => {
                const active = displayH[hIdx(r, c)];
                const key = `h_${r}_${c}`;
                return (
                  <div
                    key={key}
                    onClick={() => onLineClick("h", r, c)}
                    className={`absolute rounded-full transition-all duration-200
                      ${active ? (lastLine === key ? "bg-foreground shadow-md" : "bg-foreground/80") : isMyTurn ? "bg-border hover:bg-primary hover:scale-y-150 cursor-pointer" : "bg-border/50 cursor-default"}`}
                    style={{ left: c * DOT_GAP + DOT_R + 5, top: r * DOT_GAP + DOT_R - 3, width: DOT_GAP - DOT_R * 2, height: 6 }}
                  />
                );
              })
            )}

            {/* Vertical lines */}
            {Array.from({ length: BOXES }, (_, r) =>
              Array.from({ length: BOXES + 1 }, (_, c) => {
                const active = displayV[vIdx(r, c)];
                const key = `v_${r}_${c}`;
                return (
                  <div
                    key={key}
                    onClick={() => onLineClick("v", r, c)}
                    className={`absolute rounded-full transition-all duration-200
                      ${active ? (lastLine === key ? "bg-foreground shadow-md" : "bg-foreground/80") : isMyTurn ? "bg-border hover:bg-primary hover:scale-x-150 cursor-pointer" : "bg-border/50 cursor-default"}`}
                    style={{ left: c * DOT_GAP + DOT_R - 3, top: r * DOT_GAP + DOT_R + 5, width: 6, height: DOT_GAP - DOT_R * 2 }}
                  />
                );
              })
            )}

            {/* Dots */}
            {Array.from({ length: DOTS }, (_, r) =>
              Array.from({ length: DOTS }, (_, c) => (
                <div key={`d_${r}_${c}`} className="absolute rounded-full bg-foreground shadow-sm"
                  style={{ left: c * DOT_GAP + 4, top: r * DOT_GAP + 4, width: DOT_R*2, height: DOT_R*2 }} />
              ))
            )}
          </div>
        </div>

        {!isHuman && (
          <button onClick={reset} className="px-5 py-2 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors">
            {isGameOver ? "🔄 Rematch" : "↺ New Game"}
          </button>
        )}
      </div>
    </div>
  );
}