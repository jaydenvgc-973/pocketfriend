import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Gamepad2, X } from "lucide-react";
import GameContainer from "./GameContainer";
import ChemistryGame from "./ChemistryGame";

const GAMES = [
  { id: "chemistry",    label: "Chemistry",      emoji: "🧪", desc: "Truth or Tension — 5 rounds, real stakes",  color: "from-pink-500/20 to-purple-600/10" },
  { id: "tictactoe",    label: "Tic-Tac-Toe",   emoji: "⭕", desc: "Classic 3×3 strategy — outsmart the AI",   color: "from-amber-500/20 to-yellow-600/10" },
  { id: "dotsandboxes", label: "Dots & Boxes",   emoji: "📦", desc: "Connect lines, claim boxes, score points", color: "from-blue-500/20 to-indigo-600/10" },
  { id: "pool",         label: "Pool",           emoji: "🎱", desc: "Aim & shoot — sink your balls first",      color: "from-green-500/20 to-emerald-700/10" },
  { id: "gemduel",      label: "Gem Duel",       emoji: "💎", desc: "Match gems, chain combos, score big",      color: "from-purple-500/20 to-violet-700/10" },
];

export default function GameLauncher({ character, conversationId, onGameEnd }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeGame, setActiveGame] = useState(null);

  const launchGame = (gameId) => {
    setPickerOpen(false);
    setTimeout(() => setActiveGame(gameId), 120);
  };

  const handleGameEnd = (outcome) => {
    onGameEnd?.(outcome);
  };

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.88 }}
        whileHover={{ scale: 1.08 }}
        onClick={() => setPickerOpen(true)}
        className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
        title="Play a game with this character"
      >
        <Gamepad2 className="w-4 h-4" />
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {pickerOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[75] flex items-end justify-center bg-black/65 p-4"
              onClick={() => setPickerOpen(false)}
            >
              <motion.div
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 60, opacity: 0 }}
                transition={{ type: "spring", damping: 26, stiffness: 300 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden shadow-2xl"
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <div>
                    <h3 className="text-base font-bold text-foreground">🎮 Play a Game</h3>
                    <p className="text-xs text-muted-foreground">with {character?.name} · they'll remember the result</p>
                  </div>
                  <button
                    onClick={() => setPickerOpen(false)}
                    className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-secondary transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-3 space-y-2">
                  {GAMES.map((game, i) => (
                    <motion.button
                      key={game.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => launchGame(game.id)}
                      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-gradient-to-r ${game.color} border border-border/60 hover:border-primary/40 hover:shadow-md transition-all text-left group`}
                    >
                      <span className="text-3xl group-hover:scale-110 transition-transform">{game.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground">{game.label}</p>
                        <p className="text-xs text-muted-foreground">{game.desc}</p>
                      </div>
                      <span className="text-muted-foreground/50 group-hover:text-primary transition-colors text-lg">›</span>
                    </motion.button>
                  ))}
                </div>

                <p className="text-[10px] text-muted-foreground/50 text-center pb-4 px-4">
                  🧠 {character?.name} reacts emotionally and remembers every game outcome
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {activeGame === 'chemistry' && (
        <AnimatePresence>
          <ChemistryGame
            key="chemistry-game"
            character={character}
            conversationId={conversationId}
            onEnd={() => {
              setActiveGame(null);
              handleGameEnd({ gameId: 'chemistry' });
            }}
          />
        </AnimatePresence>
      )}
      {activeGame && activeGame !== 'chemistry' && (
        <GameContainer
          isOpen={true}
          game={activeGame}
          character={character}
          conversationId={conversationId}
          onClose={() => setActiveGame(null)}
          onGameEnd={handleGameEnd}
        />
      )}
    </>
  );
}