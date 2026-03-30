import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGameBackground } from "./useGameBackground";

const COLS = 7;
const ROWS = 7;
const TOTAL_ROUNDS = 5;
const TURNS_PER_PLAYER_PER_ROUND = 2;
const TURN_SECONDS = 20;

const GEM_TYPES = ["💎","🔴","🟡","🟢","🔵","🟣","🟠"];
const GEM_COLORS = {
  "💎": "from-cyan-400 to-blue-500 shadow-cyan-400/60",
  "🔴": "from-red-400 to-rose-600 shadow-red-400/60",
  "🟡": "from-yellow-300 to-amber-500 shadow-yellow-400/60",
  "🟢": "from-green-400 to-emerald-600 shadow-green-400/60",
  "🔵": "from-blue-400 to-indigo-600 shadow-blue-400/60",
  "🟣": "from-purple-400 to-violet-600 shadow-purple-400/60",
  "🟠": "from-orange-400 to-amber-600 shadow-orange-400/60",
};

function randGem() {
  return GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
}

function makeGrid() {
  let grid;
  do {
    grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null).map(() => randGem()));
  } while (findMatches(grid).length > 0);
  return grid;
}

function findMatches(grid) {
  const matched = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 2; c++) {
      if (grid[r][c] && grid[r][c] === grid[r][c+1] && grid[r][c] === grid[r][c+2]) {
        let end = c + 2;
        while (end + 1 < COLS && grid[r][end+1] === grid[r][c]) end++;
        for (let k = c; k <= end; k++) matched.add(`${r},${k}`);
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 2; r++) {
      if (grid[r][c] && grid[r][c] === grid[r+1][c] && grid[r][c] === grid[r+2][c]) {
        let end = r + 2;
        while (end + 1 < ROWS && grid[end+1][c] === grid[r][c]) end++;
        for (let k = r; k <= end; k++) matched.add(`${k},${c}`);
      }
    }
  }
  return [...matched];
}

function applyGravity(grid) {
  const g = grid.map(r => [...r]);
  for (let c = 0; c < COLS; c++) {
    let empty = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][c]) { g[empty][c] = g[r][c]; if (empty !== r) g[r][c] = null; empty--; }
    }
    for (let r = empty; r >= 0; r--) g[r][c] = randGem();
  }
  return g;
}

function scoreMatches(count, combo) {
  return count * 10 * (1 + combo * 0.5);
}

// Find a valid swap for the AI (one that creates a match)
function findAISwap(grid) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Try swap right
      if (c + 1 < COLS) {
        const g = grid.map(row => [...row]);
        [g[r][c], g[r][c+1]] = [g[r][c+1], g[r][c]];
        if (findMatches(g).length > 0) return { r1:r, c1:c, r2:r, c2:c+1 };
      }
      // Try swap down
      if (r + 1 < ROWS) {
        const g = grid.map(row => [...row]);
        [g[r][c], g[r+1][c]] = [g[r+1][c], g[r][c]];
        if (findMatches(g).length > 0) return { r1:r, c1:c, r2:r+1, c2:c };
      }
    }
  }
  // No match found — swap random adjacent
  const r = Math.floor(Math.random() * (ROWS-1));
  const c = Math.floor(Math.random() * (COLS-1));
  return { r1:r, c1:c, r2:r, c2:c+1 };
}

// TURN OWNER: "user" | "char"
export default function GemDuel({ character, onGameEnd }) {
  const [grid, setGrid] = useState(makeGrid);
  const [selected, setSelected] = useState(null);
  const [scores, setScores] = useState({ user: 0, char: 0 });
  const [round, setRound] = useState(1);
  // turnOwner: "user" | "char"
  // Each round: user x2, char x2 → total 4 turns/round
  const [turnOwner, setTurnOwner] = useState("user");
  const [turnsLeft, setTurnsLeft] = useState({ user: TURNS_PER_PLAYER_PER_ROUND, char: TURNS_PER_PLAYER_PER_ROUND });
  const [timer, setTimer] = useState(TURN_SECONDS);
  const [resolving, setResolving] = useState(false);
  const [combo, setCombo] = useState(0);
  const [flashCells, setFlashCells] = useState([]);
  const [comboText, setComboText] = useState(null);
  const [charThinking, setCharThinking] = useState(false);
  const timerRef = useRef(null);
  const { bgUrl, loading: bgLoading } = useGameBackground("gemduel");

  // Timer countdown
  useEffect(() => {
    if (resolving || turnOwner === "char") return;
    setTimer(TURN_SECONDS);
    timerRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) { endTurn(turnOwner); return TURN_SECONDS; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [turnOwner, resolving, round]);

  const advanceTurn = useCallback((currentOwner, currentTurnsLeft, currentScores, currentRound) => {
    const next = { ...currentTurnsLeft };
    next[currentOwner]--;

    if (next.user > 0 && currentOwner === "char") {
      setTurnsLeft(next);
      setTurnOwner("user");
    } else if (next.char > 0 && currentOwner === "user") {
      setTurnsLeft(next);
      setTurnOwner("char");
    } else if (next.char <= 0 && next.user <= 0) {
      // Round over
      const nextRound = currentRound + 1;
      if (nextRound > TOTAL_ROUNDS) {
        // Game over
        const outcome = currentScores.user > currentScores.char ? "user_win" : currentScores.char > currentScores.user ? "char_win" : "draw";
        setTimeout(() => onGameEnd(outcome), 600);
      } else {
        setRound(nextRound);
        setTurnsLeft({ user: TURNS_PER_PLAYER_PER_ROUND, char: TURNS_PER_PLAYER_PER_ROUND });
        setTurnOwner("user");
        setGrid(makeGrid());
      }
    } else {
      // Continue same pattern: user first
      setTurnsLeft(next);
      setTurnOwner(next.user > 0 ? "user" : "char");
    }
  }, [onGameEnd]);

  const endTurn = useCallback((owner) => {
    clearInterval(timerRef.current);
    advanceTurn(owner, turnsLeft, scores, round);
  }, [advanceTurn, turnsLeft, scores, round]);

  const resolveGrid = useCallback(async (g, owner, comboCount = 0) => {
    setResolving(true);
    let currentGrid = g;
    let totalScore = 0;
    let currentCombo = comboCount;

    while (true) {
      const matches = findMatches(currentGrid);
      if (matches.length === 0) break;
      setFlashCells(matches);
      const points = Math.round(scoreMatches(matches.length, currentCombo));
      totalScore += points;
      currentCombo++;

      if (currentCombo > 1) {
        setComboText(`Combo ×${currentCombo}! +${points}`);
        setTimeout(() => setComboText(null), 1000);
      }

      await new Promise(r => setTimeout(r, 350));
      setFlashCells([]);

      currentGrid = currentGrid.map(row => [...row]);
      matches.forEach(key => {
        const [r, c] = key.split(",").map(Number);
        currentGrid[r][c] = null;
      });
      currentGrid = applyGravity(currentGrid);
      setGrid(currentGrid.map(r => [...r]));
      await new Promise(r => setTimeout(r, 200));
    }

    setCombo(currentCombo);
    setScores(prev => ({ ...prev, [owner]: prev[owner] + totalScore }));
    setResolving(false);
    return { totalScore, newGrid: currentGrid };
  }, []);

  const swapGems = useCallback(async (r1, c1, r2, c2, owner) => {
    if (resolving) return;
    clearInterval(timerRef.current);

    const newGrid = grid.map(row => [...row]);
    [newGrid[r1][c1], newGrid[r2][c2]] = [newGrid[r2][c2], newGrid[r1][c1]];

    const matches = findMatches(newGrid);
    if (matches.length === 0 && owner === "user") {
      // Invalid swap — revert
      setSelected(null);
      return;
    }

    setGrid(newGrid);
    setSelected(null);
    await resolveGrid(newGrid, owner, 0);
    advanceTurn(owner, turnsLeft, scores, round);
  }, [resolving, grid, resolveGrid, advanceTurn, turnsLeft, scores, round]);

  const handleGemClick = (r, c) => {
    if (turnOwner !== "user" || resolving) return;
    if (!selected) {
      setSelected({ r, c });
      return;
    }
    // Check adjacency
    const dr = Math.abs(r - selected.r), dc = Math.abs(c - selected.c);
    if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
      swapGems(selected.r, selected.c, r, c, "user");
    } else {
      setSelected({ r, c });
    }
  };

  // Character AI turn
  useEffect(() => {
    if (turnOwner !== "char" || resolving || charThinking) return;
    setCharThinking(true);
    const t = setTimeout(async () => {
      const { r1, c1, r2, c2 } = findAISwap(grid);
      await swapGems(r1, c1, r2, c2, "char");
      setCharThinking(false);
    }, 1000 + Math.random() * 800);
    return () => clearTimeout(t);
  }, [turnOwner, resolving, grid]);

  const timerPct = (timer / TURN_SECONDS) * 100;

  return (
    <div className="relative flex flex-col items-center select-none" style={{ minHeight: 480 }}>
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden rounded-t-3xl">
        {bgUrl ? (
          <img src={bgUrl} alt="" className="w-full h-full object-cover opacity-25" draggable={false} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-violet-950/60 to-indigo-900/40" />
        )}
        <div className="absolute inset-0 bg-card/55" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 py-4 px-3 w-full">
        {/* Header */}
        <div className="flex items-center justify-between w-full max-w-sm">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">You</p>
            <p className="text-xl font-bold text-primary">{scores.user}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Round {round}/{TOTAL_ROUNDS}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {turnsLeft.user}🧑 · {turnsLeft.char}🤖 left
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{character.name}</p>
            <p className="text-xl font-bold text-rose-400">{scores.char}</p>
          </div>
        </div>

        {/* Turn indicator + timer */}
        <div className="w-full max-w-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${turnOwner === "user" ? "text-primary" : "text-rose-400 animate-pulse"}`}>
              {resolving ? "💥 Resolving combos…" : charThinking ? `${character.name} is picking gems…` : turnOwner === "user" ? "⚡ Your turn — swap two gems" : `${character.name}'s turn`}
            </span>
            {turnOwner === "user" && !resolving && (
              <span className={`text-xs font-bold ${timer <= 5 ? "text-red-400 animate-pulse" : "text-muted-foreground"}`}>
                ⏱ {timer}s
              </span>
            )}
          </div>
          {turnOwner === "user" && !resolving && (
            <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
              <motion.div
                className={`h-full rounded-full transition-colors ${timer <= 5 ? "bg-red-400" : "bg-primary"}`}
                style={{ width: `${timerPct}%` }}
                animate={{ width: `${timerPct}%` }}
              />
            </div>
          )}
        </div>

        {/* Combo flash */}
        <AnimatePresence>
          {comboText && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 0 }}
              animate={{ scale: 1.2, opacity: 1, y: -10 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="absolute top-28 z-30 text-yellow-300 text-lg font-black drop-shadow-lg pointer-events-none"
            >
              {comboText}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gem Grid */}
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {grid.map((row, r) =>
            row.map((gem, c) => {
              const isSelected = selected?.r === r && selected?.c === c;
              const isFlash = flashCells.includes(`${r},${c}`);
              const colorClass = GEM_COLORS[gem] || "from-gray-400 to-gray-600";
              return (
                <motion.button
                  key={`${r},${c}`}
                  onClick={() => handleGemClick(r, c)}
                  whileTap={turnOwner === "user" ? { scale: 0.85 } : {}}
                  animate={isFlash ? { scale: [1, 1.3, 0], opacity: [1, 1, 0] } : isSelected ? { scale: 1.15, y: -4 } : { scale: 1, y: 0 }}
                  transition={{ duration: isFlash ? 0.3 : 0.15 }}
                  className={`w-9 h-9 rounded-lg bg-gradient-to-br ${colorClass} flex items-center justify-center text-base shadow-md
                    ${isSelected ? "ring-2 ring-white shadow-xl" : ""}
                    ${turnOwner === "user" && !resolving ? "cursor-pointer hover:scale-105" : "cursor-default"}
                  `}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{gem}</span>
                </motion.button>
              );
            })
          )}
        </div>

        {/* Legend */}
        <p className="text-[10px] text-muted-foreground/70 text-center">
          Tap a gem then tap adjacent gem to swap · match 3+ of the same
        </p>

        {bgLoading && <p className="text-[10px] text-muted-foreground/40 animate-pulse">Generating gems…</p>}
      </div>
    </div>
  );
}