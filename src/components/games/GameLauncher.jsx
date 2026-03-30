import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Gamepad2, X } from "lucide-react";
import GameContainer from "./GameContainer";

const GAMES = [
  { id: "tictactoe", label: "Tic-Tac-Toe", emoji: "⭕", desc: "Classic 3×3 strategy" },
  { id: "dotsandboxes", label: "Dots & Boxes", emoji: "📦", desc: "Connect lines, claim boxes" },
  { id: "pool", label: "Pool", emoji: "🎱", desc: "Billiards — sink your balls first" },
];

export default function GameLauncher({ character, conversationId, onGameEnd }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeGame, setActiveGame] = useState(null);

  const launchGame = (gameId) => {
    setPickerOpen(false);
    setActiveGame(gameId);
  };

  const handleGameEnd = (outcome) => {
    onGameEnd?.(outcome);
    // Keep GameContainer open to show ResultScreen; it calls its own onClose
  };

  return (
    <>
      {/* Trigger button */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setPickerOpen(true)}
        className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="Play a game"
      >
        <Gamepad2 className="w-4 h-4" />
      </motion.button>

      {/* Game picker */}
      {createPortal(
        <AnimatePresence>
          {pickerOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4"
              onClick={() => setPickerOpen(false)}
            >
              <motion.div
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 60, opacity: 0 }}
                transition={{ type: "spring", damping: 26, stiffness: 300 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-sm bg-card border border-border rounded-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Play a Game</h3>
                    <p className="text-xs text-muted-foreground">with {character?.name}</p>
                  </div>
                  <button onClick={() => setPickerOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-3 space-y-2">
                  {GAMES.map(game => (
                    <motion.button
                      key={game.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => launchGame(game.id)}
                      className="w-full flex items-center gap-4 px-4 py-3 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-left"
                    >
                      <span className="text-2xl">{game.emoji}</span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{game.label}</p>
                        <p className="text-xs text-muted-foreground">{game.desc}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground/60 text-center pb-4">
                  {character?.name} will remember the result 🧠
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Active game */}
      <GameContainer
        isOpen={!!activeGame}
        game={activeGame}
        character={character}
        conversationId={conversationId}
        onClose={() => setActiveGame(null)}
        onGameEnd={handleGameEnd}
      />
    </>
  );
}