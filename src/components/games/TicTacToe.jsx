import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

function checkWinner(board) {
  for (const [a,b,c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "draw";
  return null;
}

function minimax(board, isMax, depth = 0) {
  const w = checkWinner(board);
  if (w === "O") return 10 - depth;
  if (w === "X") return depth - 10;
  if (w === "draw") return 0;
  const moves = board.map((v,i) => v ? null : i).filter(i => i !== null);
  if (isMax) {
    let best = -Infinity;
    for (const i of moves) {
      board[i] = "O";
      best = Math.max(best, minimax(board, false, depth+1));
      board[i] = null;
    }
    return best;
  } else {
    let best = Infinity;
    for (const i of moves) {
      board[i] = "X";
      best = Math.min(best, minimax(board, true, depth+1));
      board[i] = null;
    }
    return best;
  }
}

function getBestMove(board) {
  let best = -Infinity, move = -1;
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = "O";
    const score = minimax([...board], false);
    board[i] = null;
    if (score > best) { best = score; move = i; }
  }
  return move;
}

function getEasyMove(board) {
  const empty = board.map((v,i) => v ? null : i).filter(i => i !== null);
  return empty[Math.floor(Math.random() * empty.length)];
}

// SVG hand-drawn style lines for the grid
function HandDrawnGrid() {
  // Slightly wobbly lines to simulate hand-drawn look
  return (
    <svg
      viewBox="0 0 300 300"
      className="absolute inset-0 w-full h-full pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Vertical line 1 */}
      <path
        d="M 99 12 C 100 50, 98 120, 101 160 C 100 200, 99 250, 100 290"
        stroke="#4a3728" strokeWidth="2.5" fill="none"
        strokeLinecap="round" opacity="0.7"
      />
      {/* Vertical line 2 */}
      <path
        d="M 199 10 C 201 60, 198 130, 200 170 C 201 210, 200 260, 199 292"
        stroke="#4a3728" strokeWidth="2.5" fill="none"
        strokeLinecap="round" opacity="0.7"
      />
      {/* Horizontal line 1 */}
      <path
        d="M 12 99 C 50 101, 130 98, 170 100 C 210 102, 260 99, 292 100"
        stroke="#4a3728" strokeWidth="2.5" fill="none"
        strokeLinecap="round" opacity="0.7"
      />
      {/* Horizontal line 2 */}
      <path
        d="M 10 199 C 55 200, 120 198, 165 200 C 215 202, 255 200, 292 199"
        stroke="#4a3728" strokeWidth="2.5" fill="none"
        strokeLinecap="round" opacity="0.7"
      />
    </svg>
  );
}

// Sketch-style X
function SketchX({ color = "#1d4ed8", win = false }) {
  return (
    <svg viewBox="0 0 60 60" className="w-12 h-12" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M 10 10 C 15 14, 30 28, 50 50"
        stroke={win ? "#7c3aed" : color} strokeWidth="4" fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 12 12 C 18 16, 32 29, 48 48"
        stroke={win ? "#7c3aed" : color} strokeWidth="2" fill="none"
        strokeLinecap="round" opacity="0.4"
      />
      <path
        d="M 50 10 C 45 15, 28 30, 10 50"
        stroke={win ? "#7c3aed" : color} strokeWidth="4" fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Sketch-style O
function SketchO({ color = "#dc2626", win = false }) {
  return (
    <svg viewBox="0 0 60 60" className="w-12 h-12" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M 30 8 C 52 8, 54 28, 52 34 C 50 50, 38 54, 28 52 C 10 50, 8 36, 8 28 C 8 14, 18 8, 30 8"
        stroke={win ? "#7c3aed" : color} strokeWidth="4" fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 30 12 C 48 11, 50 26, 49 33 C 47 47, 36 51, 28 49"
        stroke={win ? "#7c3aed" : color} strokeWidth="1.5" fill="none"
        strokeLinecap="round" opacity="0.35"
      />
    </svg>
  );
}

// Paper texture background using CSS + SVG
function PaperBackground() {
  return (
    <div className="absolute inset-0 rounded-t-3xl overflow-hidden">
      {/* Base paper color */}
      <div className="absolute inset-0" style={{ backgroundColor: "#f5f0e8" }} />
      {/* Ruled lines (notebook style) */}
      <div className="absolute inset-0" style={{
        backgroundImage: "repeating-linear-gradient(to bottom, transparent 0px, transparent 23px, #d4c9b8 24px)",
        backgroundSize: "100% 24px",
        opacity: 0.5,
      }} />
      {/* Subtle crease shadows */}
      <div className="absolute inset-0" style={{
        backgroundImage: "radial-gradient(ellipse at 30% 20%, rgba(180,160,130,0.15) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(160,140,110,0.12) 0%, transparent 50%)",
      }} />
      {/* Left margin line (red) */}
      <div className="absolute top-0 bottom-0" style={{ left: 36, width: 1, backgroundColor: "#e8a0a0", opacity: 0.5 }} />
      {/* Top fold crease */}
      <div className="absolute top-0 left-0 right-0 h-12" style={{
        background: "linear-gradient(to bottom, rgba(0,0,0,0.06) 0%, transparent 100%)",
      }} />
    </div>
  );
}

export default function TicTacToe({ character, onGameEnd }) {
  const [board, setBoard] = useState(Array(9).fill(null));
  const [turnState, setTurnState] = useState("user_turn");
  const [winLine, setWinLine] = useState(null);
  const [scores, setScores] = useState({ user: 0, char: 0, draws: 0 });

  const isCompetitive = (character?.personality_traits || []).some(t =>
    ["competitive","aggressive","dominant","strategic","calculating"].includes((t||"").toLowerCase())
  );

  const resolveEnd = (newBoard) => {
    for (const [a,b,c] of WIN_LINES) {
      if (newBoard[a] && newBoard[a] === newBoard[b] && newBoard[a] === newBoard[c]) {
        setWinLine([a,b,c]);
        const winner = newBoard[a];
        setTurnState("game_over");
        if (winner === "X") {
          setScores(s => ({ ...s, user: s.user + 1 }));
          setTimeout(() => onGameEnd("user_win"), 1200);
        } else {
          setScores(s => ({ ...s, char: s.char + 1 }));
          setTimeout(() => onGameEnd("char_win"), 1200);
        }
        return true;
      }
    }
    if (newBoard.every(Boolean)) {
      setTurnState("game_over");
      setScores(s => ({ ...s, draws: s.draws + 1 }));
      setTimeout(() => onGameEnd("draw"), 1000);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (turnState !== "char_turn") return;
    const delay = 750 + Math.random() * 600;
    const t = setTimeout(() => {
      setBoard(prev => {
        const newBoard = [...prev];
        const move = isCompetitive
          ? getBestMove([...newBoard])
          : (Math.random() < 0.65 ? getBestMove([...newBoard]) : getEasyMove(newBoard));
        if (move === -1 || move === undefined || move === null) return prev;
        newBoard[move] = "O";
        const ended = resolveEnd(newBoard);
        if (!ended) setTurnState("user_turn");
        return newBoard;
      });
    }, delay);
    return () => clearTimeout(t);
  }, [turnState]);

  const handleClick = (i) => {
    if (turnState !== "user_turn" || board[i]) return;
    const newBoard = [...board];
    newBoard[i] = "X";
    setBoard(newBoard);
    const ended = resolveEnd(newBoard);
    if (!ended) setTurnState("char_turn");
  };

  const reset = () => {
    setBoard(Array(9).fill(null));
    setWinLine(null);
    setTurnState("user_turn");
  };

  const statusText = {
    user_turn: "Your turn",
    char_turn: `${character.name} is thinking…`,
    game_over: winLine
      ? (board[winLine[0]] === "X" ? "You won! 🎉" : `${character.name} wins!`)
      : "Draw! 🤝",
  }[turnState] || "";

  // Cell positions in a 3x3 grid mapped to 300x300 canvas coordinate centers
  const cellCenters = [
    [50, 50], [150, 50], [250, 50],
    [50, 150], [150, 150], [250, 150],
    [50, 250], [150, 250], [250, 250],
  ];

  return (
    <div className="relative flex flex-col items-center select-none" style={{ minHeight: 400 }}>
      <PaperBackground />

      <div className="relative z-10 flex flex-col items-center gap-4 py-6 px-4 w-full">
        {/* Score row — ink-stamp style */}
        <div className="flex items-center gap-5 text-xs font-bold" style={{ color: "#4a3728" }}>
          <span>You: {scores.user}</span>
          <span style={{ color: "#888" }}>Draws: {scores.draws}</span>
          <span>{character.name}: {scores.char}</span>
        </div>

        {/* Status */}
        <AnimatePresence mode="wait">
          <motion.p
            key={statusText}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`text-sm font-medium`}
            style={{
              color: turnState === "char_turn" ? "#c2410c" : "#1d4ed8",
              fontFamily: "'Georgia', serif",
              fontStyle: "italic",
            }}
          >
            {statusText}
          </motion.p>
        </AnimatePresence>

        {/* Legend */}
        <div className="flex gap-6 text-xs" style={{ color: "#4a3728", fontFamily: "Georgia, serif" }}>
          <span>✕ You</span>
          <span>○ {character.name}</span>
        </div>

        {/* Board — paper look with hand-drawn grid */}
        <div
          className="relative"
          style={{
            width: 300,
            height: 300,
            boxShadow: "2px 4px 16px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(0,0,0,0.05)",
            backgroundColor: "#f9f4ea",
            borderRadius: 4,
          }}
        >
          <HandDrawnGrid />

          {/* Clickable cells */}
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
            {board.map((cell, i) => {
              const isWin = winLine?.includes(i);
              return (
                <motion.button
                  key={i}
                  whileTap={turnState === "user_turn" && !cell ? { scale: 0.85 } : {}}
                  onClick={() => handleClick(i)}
                  className="flex items-center justify-center"
                  style={{
                    cursor: turnState === "user_turn" && !cell ? "pointer" : "default",
                    background: isWin ? "rgba(109,40,217,0.08)" : "transparent",
                  }}
                >
                  <AnimatePresence>
                    {cell === "X" && (
                      <motion.div
                        initial={{ scale: 0, rotate: -15 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", damping: 12, stiffness: 200 }}
                      >
                        <SketchX win={isWin} />
                      </motion.div>
                    )}
                    {cell === "O" && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", damping: 12, stiffness: 200 }}
                      >
                        <SketchO win={isWin} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={reset}
          className="px-6 py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: "#4a3728",
            color: "#f9f4ea",
            fontFamily: "Georgia, serif",
            border: "none",
            boxShadow: "1px 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          {turnState === "game_over" ? "✏️ New Game" : "↺ Restart"}
        </motion.button>
      </div>
    </div>
  );
}