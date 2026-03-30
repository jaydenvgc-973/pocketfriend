import { useState, useEffect } from "react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGameBackground } from "./useGameBackground";

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

// TURN STATES: "user_turn" | "char_turn" | "resolving" | "game_over"
export default function TicTacToe({ character, onGameEnd }) {
  const [board, setBoard] = useState(Array(9).fill(null));
  const [turnState, setTurnState] = useState("user_turn");
  const [winLine, setWinLine] = useState(null);
  const [scores, setScores] = useState({ user: 0, char: 0, draws: 0 });
  const [round, setRound] = useState(1);
  const { bgUrl, loading: bgLoading } = useGameBackground("tictactoe");

  const isCompetitive = (character?.personality_traits || []).some(t =>
    ["competitive","aggressive","dominant","strategic","calculating"].includes((t||"").toLowerCase())
  );

  const resolveEnd = (newBoard, currentBoard) => {
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

  // Character turn logic
  useEffect(() => {
    if (turnState !== "char_turn") return;
    const delay = 800 + Math.random() * 700;
    const t = setTimeout(() => {
      setBoard(prev => {
        const newBoard = [...prev];
        const move = isCompetitive ? getBestMove([...newBoard]) : (Math.random() < 0.65 ? getBestMove([...newBoard]) : getEasyMove(newBoard));
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
    setRound(r => r + 1);
  };

  const statusText = {
    user_turn: "Your turn — tap a square",
    char_turn: `${character.name} is thinking…`,
    resolving: "Resolving…",
    game_over: winLine ? (board[winLine[0]] === "X" ? "You won! 🎉" : `${character.name} wins!`) : "Draw! 🤝",
  }[turnState] || "";

  return (
    <div className="relative flex flex-col items-center select-none" style={{ minHeight: 380 }}>
      {/* AI Background */}
      <div className="absolute inset-0 overflow-hidden rounded-t-3xl">
        {bgUrl ? (
          <img src={bgUrl} alt="" className="w-full h-full object-cover opacity-30" draggable={false} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-amber-950/40 to-yellow-900/20" />
        )}
        <div className="absolute inset-0 bg-card/60" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 py-6 px-4 w-full">
        {/* Score row */}
        <div className="flex items-center gap-6 text-xs font-semibold">
          <span className="text-primary">You: {scores.user}</span>
          <span className="text-muted-foreground">Draws: {scores.draws}</span>
          <span className="text-rose-400">{character.name}: {scores.char}</span>
        </div>

        {/* Status */}
        <AnimatePresence mode="wait">
          <motion.p
            key={statusText}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`text-sm font-medium ${turnState === "char_turn" ? "text-rose-400 animate-pulse" : "text-foreground"}`}
          >
            {statusText}
          </motion.p>
        </AnimatePresence>

        {/* Legend */}
        <div className="flex gap-6 text-xs text-muted-foreground">
          <span><span className="text-primary font-bold text-base">✕</span> You</span>
          <span><span className="text-rose-400 font-bold text-base">○</span> {character.name}</span>
        </div>

        {/* Board */}
        <div className="grid grid-cols-3 gap-3">
          {board.map((cell, i) => {
            const isWin = winLine?.includes(i);
            return (
              <motion.button
                key={i}
                whileTap={turnState === "user_turn" && !cell ? { scale: 0.88 } : {}}
                onClick={() => handleClick(i)}
                className={`w-20 h-20 rounded-2xl border-2 flex items-center justify-center text-4xl font-bold transition-all duration-200
                  ${isWin ? "border-primary bg-primary/25 shadow-lg shadow-primary/30" : ""}
                  ${!cell && turnState === "user_turn" ? "border-border bg-card/70 hover:bg-card hover:border-primary/50 cursor-pointer" : "border-border/50 bg-card/50 cursor-default"}
                  ${cell ? "border-border/50 bg-card/60" : ""}
                `}
              >
                <AnimatePresence>
                  {cell === "X" && (
                    <motion.span
                      initial={{ scale: 0, rotate: -30 }}
                      animate={{ scale: 1, rotate: 0 }}
                      className="text-primary drop-shadow-lg"
                    >✕</motion.span>
                  )}
                  {cell === "O" && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="text-rose-400 drop-shadow-lg"
                    >○</motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex gap-3 mt-2">
          <button
            onClick={reset}
            className="px-5 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground hover:bg-secondary/70 transition-colors"
          >
            {turnState === "game_over" ? "🔄 Rematch" : "↺ Restart"}
          </button>
        </div>

        {bgLoading && (
          <p className="text-[10px] text-muted-foreground/50 animate-pulse">Generating visual…</p>
        )}
      </div>
    </div>
  );
}