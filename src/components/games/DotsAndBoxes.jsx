import { useState, useEffect, useCallback } from "react";

const GRID_SIZE = 4; // 4x4 dots = 3x3 boxes
const DOTS = GRID_SIZE;
const BOXES = GRID_SIZE - 1;

// Lines: horizontal lines and vertical lines
// H line (row, col): top edge of box at (row, col), row 0..BOXES, col 0..BOXES-1
// V line (row, col): left edge of box at (row, col), row 0..BOXES-1, col 0..BOXES

function initLines() {
  const h = Array(DOTS).fill(null).map(() => Array(BOXES).fill(false));
  const v = Array(BOXES).fill(null).map(() => Array(DOTS).fill(false));
  return { h, v };
}

function checkBoxes(h, v, boxes) {
  const newBoxes = boxes.map(row => [...row]);
  let scored = false;
  for (let r = 0; r < BOXES; r++) {
    for (let c = 0; c < BOXES; c++) {
      if (!newBoxes[r][c] && h[r][c] && h[r+1][c] && v[r][c] && v[r][c+1]) {
        newBoxes[r][c] = "pending"; // will be assigned by caller
        scored = true;
      }
    }
  }
  return { newBoxes, scored };
}

function getAvailableLines(h, v) {
  const lines = [];
  for (let r = 0; r <= BOXES; r++) {
    for (let c = 0; c < BOXES; c++) {
      if (!h[r][c]) lines.push({ type: "h", r, c });
    }
  }
  for (let r = 0; r < BOXES; r++) {
    for (let c = 0; c <= BOXES; c++) {
      if (!v[r][c]) lines.push({ type: "v", r, c });
    }
  }
  return lines;
}

// AI: prefer completing boxes, otherwise random
function getAIMove(h, v) {
  const available = getAvailableLines(h, v);
  // Try to find a move that completes a box
  for (const line of available) {
    const hCopy = h.map(r => [...r]);
    const vCopy = v.map(r => [...r]);
    if (line.type === "h") hCopy[line.r][line.c] = true;
    else vCopy[line.r][line.c] = true;
    // Check if any box completed
    for (let r = 0; r < BOXES; r++) {
      for (let c = 0; c < BOXES; c++) {
        if (hCopy[r][c] && hCopy[r+1]?.[c] && vCopy[r]?.[c] && vCopy[r]?.[c+1]) {
          return line;
        }
      }
    }
  }
  // Otherwise pick random
  return available[Math.floor(Math.random() * available.length)];
}

export default function DotsAndBoxes({ character, onGameEnd }) {
  const [lines, setLines] = useState(initLines);
  const [boxes, setBoxes] = useState(() => Array(BOXES).fill(null).map(() => Array(BOXES).fill(null)));
  const [scores, setScores] = useState({ user: 0, char: 0 });
  const [isUserTurn, setIsUserTurn] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const applyLine = useCallback((h, v, boxes, currentPlayer) => {
    let newH = h.map(r => [...r]);
    let newV = v.map(r => [...r]);
    let newBoxes = boxes.map(r => [...r]);
    let scored = false;

    for (let r = 0; r < BOXES; r++) {
      for (let c = 0; c < BOXES; c++) {
        if (!newBoxes[r][c] && newH[r][c] && newH[r+1]?.[c] && newV[r]?.[c] && newV[r]?.[c+1]) {
          newBoxes[r][c] = currentPlayer;
          scored = true;
        }
      }
    }
    return { newH, newV, newBoxes, scored };
  }, []);

  const handleLineClick = (type, r, c) => {
    if (!isUserTurn || thinking || gameOver) return;
    if (type === "h" && lines.h[r][c]) return;
    if (type === "v" && lines.v[r][c]) return;

    const newH = lines.h.map(row => [...row]);
    const newV = lines.v.map(row => [...row]);
    if (type === "h") newH[r][c] = true;
    else newV[r][c] = true;

    const { newBoxes, scored } = applyLine(newH, newV, boxes, "user") ;
    const userScore = scores.user + newBoxes.flat().filter(b => b === "user").length - boxes.flat().filter(b => b === "user").length;
    const charScore = scores.char;

    setLines({ h: newH, v: newV });
    setBoxes(newBoxes);
    setScores({ user: userScore, char: charScore });

    const totalBoxes = BOXES * BOXES;
    if (userScore + charScore >= totalBoxes) {
      setGameOver(true);
      setTimeout(() => {
        onGameEnd(userScore > charScore ? "user_win" : charScore > userScore ? "char_win" : "draw");
      }, 600);
      return;
    }

    if (!scored) setIsUserTurn(false);
  };

  // AI turn
  useEffect(() => {
    if (isUserTurn || gameOver || thinking) return;
    setThinking(true);
    const timer = setTimeout(() => {
      const move = getAIMove(lines.h, lines.v);
      if (!move) { setIsUserTurn(true); setThinking(false); return; }

      const newH = lines.h.map(r => [...r]);
      const newV = lines.v.map(r => [...r]);
      if (move.type === "h") newH[move.r][move.c] = true;
      else newV[move.r][move.c] = true;

      const { newBoxes, scored } = applyLine(newH, newV, boxes, "char");
      const charScore = scores.char + newBoxes.flat().filter(b => b === "char").length - boxes.flat().filter(b => b === "char").length;
      const userScore = scores.user;

      setLines({ h: newH, v: newV });
      setBoxes(newBoxes);
      setScores({ user: userScore, char: charScore });
      setThinking(false);

      const totalBoxes = BOXES * BOXES;
      if (userScore + charScore >= totalBoxes) {
        setGameOver(true);
        setTimeout(() => {
          onGameEnd(userScore > charScore ? "user_win" : charScore > userScore ? "char_win" : "draw");
        }, 600);
        return;
      }

      if (!scored) setIsUserTurn(true);
    }, 700 + Math.random() * 500);
    return () => clearTimeout(timer);
  }, [isUserTurn, gameOver]);

  const reset = () => {
    setLines(initLines());
    setBoxes(Array(BOXES).fill(null).map(() => Array(BOXES).fill(null)));
    setScores({ user: 0, char: 0 });
    setIsUserTurn(true);
    setThinking(false);
    setGameOver(false);
  };

  const DOT_GAP = 52; // px between dots
  const DOT_R = 6;

  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4">
      {/* Scores */}
      <div className="flex gap-8 text-sm font-semibold">
        <span className="text-primary">You: {scores.user}</span>
        <span className="text-rose-400">{character.name}: {scores.char}</span>
      </div>

      {thinking && <p className="text-xs text-muted-foreground animate-pulse">{character.name} is thinking…</p>}
      {!thinking && !gameOver && <p className="text-xs text-muted-foreground">{isUserTurn ? "Your turn — tap a line" : `${character.name}'s turn`}</p>}

      {/* Board */}
      <div className="relative" style={{ width: DOT_GAP * (DOTS - 1) + DOT_R * 2 + 20, height: DOT_GAP * (DOTS - 1) + DOT_R * 2 + 20 }}>
        {/* Filled boxes */}
        {boxes.map((row, r) =>
          row.map((cell, c) => cell ? (
            <div
              key={`box-${r}-${c}`}
              className={`absolute rounded-sm ${cell === "user" ? "bg-primary/30" : "bg-rose-400/30"}`}
              style={{
                left: c * DOT_GAP + DOT_R + 4,
                top: r * DOT_GAP + DOT_R + 4,
                width: DOT_GAP - 2,
                height: DOT_GAP - 2,
              }}
            />
          ) : null)
        )}

        {/* Horizontal lines */}
        {lines.h.map((row, r) =>
          row.map((active, c) => (
            <div
              key={`h-${r}-${c}`}
              onClick={() => handleLineClick("h", r, c)}
              className={`absolute rounded-full transition-colors ${
                active
                  ? "bg-foreground cursor-default"
                  : isUserTurn && !gameOver
                  ? "bg-border hover:bg-primary cursor-pointer"
                  : "bg-border cursor-default"
              }`}
              style={{
                left: c * DOT_GAP + DOT_R + 2,
                top: r * DOT_GAP + DOT_R - 3,
                width: DOT_GAP - 4,
                height: 6,
              }}
            />
          ))
        )}

        {/* Vertical lines */}
        {lines.v.map((row, r) =>
          row.map((active, c) => (
            <div
              key={`v-${r}-${c}`}
              onClick={() => handleLineClick("v", r, c)}
              className={`absolute rounded-full transition-colors ${
                active
                  ? "bg-foreground cursor-default"
                  : isUserTurn && !gameOver
                  ? "bg-border hover:bg-primary cursor-pointer"
                  : "bg-border cursor-default"
              }`}
              style={{
                left: c * DOT_GAP + DOT_R - 3,
                top: r * DOT_GAP + DOT_R + 2,
                width: 6,
                height: DOT_GAP - 4,
              }}
            />
          ))
        )}

        {/* Dots */}
        {Array(DOTS).fill(null).map((_, r) =>
          Array(DOTS).fill(null).map((_, c) => (
            <div
              key={`dot-${r}-${c}`}
              className="absolute rounded-full bg-foreground"
              style={{
                left: c * DOT_GAP + 4,
                top: r * DOT_GAP + 4,
                width: DOT_R * 2,
                height: DOT_R * 2,
              }}
            />
          ))
        )}
      </div>

      <button
        onClick={reset}
        className="px-5 py-2 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        New Game
      </button>
    </div>
  );
}