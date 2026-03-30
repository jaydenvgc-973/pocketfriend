import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

const COLS = 7;
const ROWS = 7;
const TOTAL_ROUNDS = 5;
const TURNS_PER_PLAYER_PER_ROUND = 2;
const TURN_SECONDS = 20;

const GEM_TYPES = ["💎","🔴","🟡","🟢","🔵","🟣","🟠"];
const GEM_COLORS = {
  "💎": "from-cyan-400 to-blue-500",
  "🔴": "from-red-400 to-rose-600",
  "🟡": "from-yellow-300 to-amber-500",
  "🟢": "from-green-400 to-emerald-600",
  "🔵": "from-blue-400 to-indigo-600",
  "🟣": "from-purple-400 to-violet-600",
  "🟠": "from-orange-400 to-amber-600",
};

function randGem() {
  return GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
}

// Build board guaranteed to have no initial matches AND at least one valid move
function makeGrid() {
  let attempts = 0;
  while (attempts < 200) {
    attempts++;
    const grid = Array(ROWS).fill(null).map(() => Array(COLS).fill(null).map(() => randGem()));
    // Clear initial matches by replacing matched gems
    for (let pass = 0; pass < 10; pass++) {
      const matches = findMatches(grid);
      if (matches.length === 0) break;
      matches.forEach(key => {
        const [r, c] = key.split(",").map(Number);
        grid[r][c] = randGem();
      });
    }
    if (findMatches(grid).length === 0 && findAISwap(grid) !== null) return grid;
  }
  // Fallback: just return a random grid
  return Array(ROWS).fill(null).map(() => Array(COLS).fill(null).map(() => randGem()));
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

// Apply gravity: gems fall down, fill empty from top with new gems
function applyGravity(grid) {
  const g = grid.map(row => [...row]);
  for (let c = 0; c < COLS; c++) {
    // Collect non-null gems from bottom
    const gems = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][c] !== null) gems.push(g[r][c]);
    }
    // Fill from bottom up
    for (let r = ROWS - 1; r >= 0; r--) {
      g[r][c] = gems.length > 0 ? gems.shift() : randGem();
    }
  }
  return g;
}

// Guarantee all cells are filled — safety net
function fillBoard(grid) {
  const g = grid.map(row => [...row]);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!g[r][c]) g[r][c] = randGem();
    }
  }
  return g;
}

// Reshuffle if no moves available
function ensureValidMoves(grid) {
  let g = grid.map(row => [...row]);
  let attempts = 0;
  while (findAISwap(g) === null && attempts < 50) {
    // Shuffle in place
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        g[r][c] = randGem();
      }
    }
    // Clear any pre-existing matches
    for (let pass = 0; pass < 5; pass++) {
      const matches = findMatches(g);
      if (matches.length === 0) break;
      matches.forEach(key => {
        const [r, c] = key.split(",").map(Number);
        g[r][c] = randGem();
      });
    }
    attempts++;
  }
  return g;
}

function scoreMatches(count, combo) {
  return count * 10 * (1 + combo * 0.5);
}

// Returns null if no valid swap exists
function findAISwap(grid) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS) {
        const g = grid.map(row => [...row]);
        [g[r][c], g[r][c+1]] = [g[r][c+1], g[r][c]];
        if (findMatches(g).length > 0) return { r1:r, c1:c, r2:r, c2:c+1 };
      }
      if (r + 1 < ROWS) {
        const g = grid.map(row => [...row]);
        [g[r][c], g[r+1][c]] = [g[r+1][c], g[r][c]];
        if (findMatches(g).length > 0) return { r1:r, c1:c, r2:r+1, c2:c };
      }
    }
  }
  return null;
}

export default function GemDuel({ character, onGameEnd }) {
  const [grid, setGrid] = useState(makeGrid);
  const [selected, setSelected] = useState(null);
  const [scores, setScores] = useState({ user: 0, char: 0 });
  const [round, setRound] = useState(1);
  const [turnOwner, setTurnOwner] = useState("user");
  const [turnsLeft, setTurnsLeft] = useState({ user: TURNS_PER_PLAYER_PER_ROUND, char: TURNS_PER_PLAYER_PER_ROUND });
  const [timer, setTimer] = useState(TURN_SECONDS);
  const [resolving, setResolving] = useState(false);
  const [flashCells, setFlashCells] = useState([]);
  const [comboText, setComboText] = useState(null);
  const [charThinking, setCharThinking] = useState(false);
  const [reshuffling, setReshuffling] = useState(false);
  const timerRef = useRef(null);
  const resolvingRef = useRef(false);
  const turnsLeftRef = useRef({ user: TURNS_PER_PLAYER_PER_ROUND, char: TURNS_PER_PLAYER_PER_ROUND });
  const scoresRef = useRef({ user: 0, char: 0 });
  const roundRef = useRef(1);

  // Keep refs in sync
  useEffect(() => { turnsLeftRef.current = turnsLeft; }, [turnsLeft]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { roundRef.current = round; }, [round]);

  // Timer — only runs on user turn, not during resolving
  useEffect(() => {
    clearInterval(timerRef.current);
    if (resolving || turnOwner !== "user") return;
    setTimer(TURN_SECONDS);
    timerRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          // Time's up — advance turn without scoring
          advanceTurn("user");
          return TURN_SECONDS;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnOwner, resolving, round]);

  const advanceTurn = useCallback((owner) => {
    const tl = { ...turnsLeftRef.current };
    tl[owner] = Math.max(0, tl[owner] - 1);

    const nextRound = roundRef.current;
    const currentScores = scoresRef.current;

    if (tl.user <= 0 && tl.char <= 0) {
      // Round over
      const nr = nextRound + 1;
      if (nr > TOTAL_ROUNDS) {
        const outcome = currentScores.user > currentScores.char ? "user_win"
          : currentScores.char > currentScores.user ? "char_win" : "draw";
        setTimeout(() => onGameEnd(outcome), 600);
      } else {
        setRound(nr);
        const newTurns = { user: TURNS_PER_PLAYER_PER_ROUND, char: TURNS_PER_PLAYER_PER_ROUND };
        setTurnsLeft(newTurns);
        turnsLeftRef.current = newTurns;
        setGrid(makeGrid());
        setTurnOwner("user");
      }
    } else {
      setTurnsLeft(tl);
      // user goes first within a round, char second
      if (owner === "user" && tl.char > 0) {
        setTurnOwner("char");
      } else {
        setTurnOwner("user");
      }
    }
  }, [onGameEnd]);

  const resolveGrid = useCallback(async (startGrid, owner) => {
    resolvingRef.current = true;
    setResolving(true);

    let currentGrid = startGrid.map(row => [...row]);
    let totalScore = 0;
    let combo = 0;

    while (true) {
      const matches = findMatches(currentGrid);
      if (matches.length === 0) break;

      setFlashCells(matches);
      const points = Math.round(scoreMatches(matches.length, combo));
      totalScore += points;
      combo++;

      if (combo > 1) {
        setComboText(`Combo ×${combo}! +${points}`);
        setTimeout(() => setComboText(null), 900);
      }

      await new Promise(r => setTimeout(r, 380));
      setFlashCells([]);

      // Remove matched gems
      matches.forEach(key => {
        const [r, c] = key.split(",").map(Number);
        currentGrid[r][c] = null;
      });

      // Apply gravity (fills empty from top)
      currentGrid = applyGravity(currentGrid);

      // Safety: fill any remaining nulls
      currentGrid = fillBoard(currentGrid);

      setGrid(currentGrid.map(row => [...row]));
      await new Promise(r => setTimeout(r, 220));
    }

    // Check for valid moves — reshuffle if none
    if (findAISwap(currentGrid) === null) {
      setReshuffling(true);
      await new Promise(r => setTimeout(r, 600));
      currentGrid = ensureValidMoves(currentGrid);
      currentGrid = fillBoard(currentGrid);
      setGrid(currentGrid.map(row => [...row]));
      setReshuffling(false);
    }

    setScores(prev => {
      const next = { ...prev, [owner]: prev[owner] + totalScore };
      scoresRef.current = next;
      return next;
    });

    resolvingRef.current = false;
    setResolving(false);
    return currentGrid;
  }, []);

  const swapGems = useCallback(async (r1, c1, r2, c2, owner) => {
    if (resolvingRef.current) return;
    clearInterval(timerRef.current);

    const newGrid = grid.map(row => [...row]);
    [newGrid[r1][c1], newGrid[r2][c2]] = [newGrid[r2][c2], newGrid[r1][c1]];

    const matches = findMatches(newGrid);
    if (matches.length === 0 && owner === "user") {
      // Invalid swap for user — revert
      setSelected(null);
      return;
    }

    setGrid(newGrid.map(row => [...row]));
    setSelected(null);
    await resolveGrid(newGrid, owner);
    advanceTurn(owner);
  }, [grid, resolveGrid, advanceTurn]);

  const handleGemClick = (r, c) => {
    if (turnOwner !== "user" || resolving) return;
    if (!selected) { setSelected({ r, c }); return; }
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
      const swap = findAISwap(grid);
      if (swap) {
        await swapGems(swap.r1, swap.c1, swap.r2, swap.c2, "char");
      } else {
        advanceTurn("char");
      }
      setCharThinking(false);
    }, 900 + Math.random() * 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnOwner, resolving]);

  const timerPct = (timer / TURN_SECONDS) * 100;

  return (
    <div className="relative flex flex-col items-center select-none" style={{ minHeight: 480 }}>
      {/* Gem Duel themed background — pure CSS, no AI image */}
      <div className="absolute inset-0 overflow-hidden rounded-t-3xl bg-gradient-to-br from-violet-950 via-indigo-950 to-purple-950">
        {/* Decorative gem pattern */}
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "radial-gradient(circle at 20% 30%, #a855f7 0%, transparent 40%), radial-gradient(circle at 80% 70%, #3b82f6 0%, transparent 40%), radial-gradient(circle at 50% 10%, #06b6d4 0%, transparent 30%)"
        }} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 py-4 px-3 w-full">
        {/* Header scores */}
        <div className="flex items-center justify-between w-full max-w-sm">
          <div className="text-center">
            <p className="text-[10px] text-purple-300 uppercase tracking-wide">You</p>
            <p className="text-xl font-bold text-purple-200">{scores.user}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Round {round}/{TOTAL_ROUNDS}</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {turnsLeft.user}🧑 · {turnsLeft.char}🤖 left
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-rose-300 uppercase tracking-wide">{character.name}</p>
            <p className="text-xl font-bold text-rose-400">{scores.char}</p>
          </div>
        </div>

        {/* Turn indicator + timer */}
        <div className="w-full max-w-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${resolving ? "text-yellow-300" : reshuffling ? "text-orange-300" : charThinking ? "text-rose-400 animate-pulse" : turnOwner === "user" ? "text-purple-300" : "text-rose-400 animate-pulse"}`}>
              {reshuffling ? "🔀 Reshuffling board…" : resolving ? "💥 Resolving combos…" : charThinking ? `${character.name} is picking gems…` : turnOwner === "user" ? "⚡ Your turn — swap two gems" : `${character.name}'s turn`}
            </span>
            {turnOwner === "user" && !resolving && (
              <span className={`text-xs font-bold tabular-nums ${timer <= 5 ? "text-red-400 animate-pulse" : "text-muted-foreground"}`}>
                ⏱ {timer}s
              </span>
            )}
          </div>
          {turnOwner === "user" && !resolving && (
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${timer <= 5 ? "bg-red-400" : "bg-purple-400"}`}
                animate={{ width: `${timerPct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>

        {/* Combo flash */}
        <AnimatePresence>
          {comboText && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 0 }}
              animate={{ scale: 1.3, opacity: 1, y: -12 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="absolute top-28 z-30 text-yellow-300 text-xl font-black drop-shadow-lg pointer-events-none select-none"
            >
              {comboText}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gem Grid */}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {grid.map((row, r) =>
            row.map((gem, c) => {
              const isSelected = selected?.r === r && selected?.c === c;
              const isFlash = flashCells.includes(`${r},${c}`);
              const colorClass = GEM_COLORS[gem] || "from-gray-400 to-gray-600";
              return (
                <motion.button
                  key={`${r}-${c}`}
                  onClick={() => handleGemClick(r, c)}
                  whileTap={turnOwner === "user" && !resolving ? { scale: 0.8 } : {}}
                  animate={
                    isFlash
                      ? { scale: [1, 1.4, 0], opacity: [1, 1, 0] }
                      : isSelected
                      ? { scale: 1.18, y: -5 }
                      : { scale: 1, y: 0, opacity: 1 }
                  }
                  transition={{ duration: isFlash ? 0.32 : 0.12 }}
                  className={`w-9 h-9 rounded-xl bg-gradient-to-br ${colorClass} flex items-center justify-center shadow-lg
                    ${isSelected ? "ring-2 ring-white shadow-white/30" : ""}
                    ${turnOwner === "user" && !resolving ? "cursor-pointer" : "cursor-default"}
                  `}
                >
                  <span style={{ fontSize: 17, lineHeight: 1 }}>{gem || "❓"}</span>
                </motion.button>
              );
            })
          )}
        </div>

        <p className="text-[10px] text-white/30 text-center mt-1">
          Tap a gem · tap adjacent gem to swap · match 3+ to score
        </p>
      </div>
    </div>
  );
}