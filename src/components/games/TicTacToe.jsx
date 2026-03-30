import { useState, useEffect } from "react";
import { motion } from "framer-motion";

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

// Simple minimax AI
function getBestMove(board, isMaximizing) {
  const winner = checkWinner(board);
  if (winner === "O") return { score: 10 };
  if (winner === "X") return { score: -10 };
  if (winner === "draw") return { score: 0 };

  const moves = board.map((v, i) => v ? null : i).filter(i => i !== null);
  let best = isMaximizing ? { score: -Infinity } : { score: Infinity };

  for (const i of moves) {
    board[i] = isMaximizing ? "O" : "X";
    const result = getBestMove(board, !isMaximizing);
    board[i] = null;
    result.index = i;
    if (isMaximizing ? result.score > best.score : result.score < best.score) {
      best = result;
    }
  }
  return best;
}

// Easy mode: random move
function getRandomMove(board) {
  const empty = board.map((v,i) => v ? null : i).filter(i => i !== null);
  return empty[Math.floor(Math.random() * empty.length)];
}

export default function TicTacToe({ character, onGameEnd }) {
  const [board, setBoard] = useState(Array(9).fill(null));
  const [isUserTurn, setIsUserTurn] = useState(true);
  const [winner, setWinner] = useState(null);
  const [thinkingChar, setThinkingChar] = useState(false);
  const [winLine, setWinLine] = useState(null);

  // Determine AI difficulty from personality
  const isCompetitive = (character?.personality_traits || []).some(t =>
    ["competitive","aggressive","dominant","strategic","calculating"].includes(t?.toLowerCase())
  );

  useEffect(() => {
    if (!isUserTurn && !winner) {
      setThinkingChar(true);
      const delay = 600 + Math.random() * 800;
      const timer = setTimeout(() => {
        setBoard(prev => {
          const newBoard = [...prev];
          const move = isCompetitive
            ? getBestMove([...newBoard], true).index
            : Math.random() < 0.6
              ? getBestMove([...newBoard], true).index
              : getRandomMove(newBoard);

          if (move === undefined || move === null) return prev;
          newBoard[move] = "O";
          const result = checkWinner(newBoard);
          if (result) {
            setWinner(result);
            if (result !== "draw") {
              const line = WIN_LINES.find(([a,b,c]) => newBoard[a] && newBoard[a] === newBoard[b] && newBoard[a] === newBoard[c]);
              setWinLine(line || null);
            }
            setTimeout(() => onGameEnd(result === "draw" ? "draw" : result === "X" ? "user_win" : "char_win"), 1000);
          }
          return newBoard;
        });
        setThinkingChar(false);
        setIsUserTurn(true);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [isUserTurn, winner]);

  const handleClick = (i) => {
    if (!isUserTurn || board[i] || winner || thinkingChar) return;
    const newBoard = [...board];
    newBoard[i] = "X";
    const result = checkWinner(newBoard);
    setBoard(newBoard);
    if (result) {
      setWinner(result);
      if (result !== "draw") {
        const line = WIN_LINES.find(([a,b,c]) => newBoard[a] && newBoard[a] === newBoard[b] && newBoard[a] === newBoard[c]);
        setWinLine(line || null);
      }
      setTimeout(() => onGameEnd(result === "draw" ? "draw" : result === "X" ? "user_win" : "char_win"), 800);
    } else {
      setIsUserTurn(false);
    }
  };

  const reset = () => {
    setBoard(Array(9).fill(null));
    setWinner(null);
    setWinLine(null);
    setIsUserTurn(true);
    setThinkingChar(false);
  };

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4">
      {/* Status */}
      <div className="text-center">
        {thinkingChar && !winner && (
          <p className="text-sm text-muted-foreground animate-pulse">{character.name} is thinking…</p>
        )}
        {!thinkingChar && !winner && isUserTurn && (
          <p className="text-sm text-muted-foreground">Your turn — tap a square</p>
        )}
        {winner && (
          <p className="text-sm font-semibold text-foreground">
            {winner === "draw" ? "Draw!" : winner === "X" ? "You won! 🎉" : `${character.name} wins! 😤`}
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <span><span className="text-primary font-bold">X</span> = You</span>
        <span><span className="text-rose-400 font-bold">O</span> = {character.name}</span>
      </div>

      {/* Board */}
      <div className="grid grid-cols-3 gap-2">
        {board.map((cell, i) => {
          const isWinCell = winLine?.includes(i);
          return (
            <motion.button
              key={i}
              whileTap={{ scale: 0.92 }}
              onClick={() => handleClick(i)}
              className={`w-24 h-24 rounded-2xl border-2 flex items-center justify-center text-3xl font-bold transition-colors ${
                isWinCell
                  ? "border-primary bg-primary/20"
                  : cell
                  ? "border-border bg-secondary cursor-default"
                  : "border-border bg-secondary hover:bg-secondary/70 cursor-pointer"
              }`}
            >
              {cell === "X" && <span className="text-primary">✕</span>}
              {cell === "O" && <span className="text-rose-400">○</span>}
            </motion.button>
          );
        })}
      </div>

      <button
        onClick={reset}
        className="mt-2 px-5 py-2 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
      >
        New Game
      </button>
    </div>
  );
}