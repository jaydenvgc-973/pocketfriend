import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import TicTacToe from "./TicTacToe";
import DotsAndBoxes from "./DotsAndBoxes";
import Pool from "./Pool";
import GemDuel from "./GemDuel";
import { base44 } from "@/api/base44Client";

const GAME_LABELS = {
  tictactoe: "Tic-Tac-Toe",
  dotsandboxes: "Dots & Boxes",
  pool: "Pool",
  gemduel: "Gem Duel",
};

export default function GameContainer({ isOpen, game, character, conversationId, onClose, onGameEnd }) {
  const [result, setResult] = useState(null);
  const [rematch, setRematch] = useState(0);

  const handleGameEnd = async (outcome) => {
    setResult(outcome);
    const gameName = GAME_LABELS[game] || game;
    const userWon = outcome === "user_win";
    const draw = outcome === "draw";

    const memoryDesc = draw
      ? `${character.name} played ${gameName} with the user — it ended in a draw.`
      : userWon
      ? `${character.name} played ${gameName} with the user and LOST. The user won fair and square.`
      : `${character.name} played ${gameName} with the user and WON. They felt great about the victory.`;

    await base44.entities.Memory.create({
      character_id: character.id,
      title: `${gameName} game with user`,
      description: memoryDesc,
      emotional_impact: draw ? "neutral, competitive" : userWon ? "competitive, a little salty about the loss" : "happy, proud, gloating",
      timestamp: new Date().toISOString(),
      source_context: `game_${game}`,
    }).catch(() => {});

    const narrativeText = draw
      ? `🎮 *${character.name} and you played ${gameName} — it was a draw!*`
      : userWon
      ? `🎮 *You beat ${character.name} at ${gameName}!*`
      : `🎮 *${character.name} beat you at ${gameName}!*`;

    if (conversationId) {
      await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "character",
        character_id: character.id,
        character_name: character.name,
        content: narrativeText,
        is_narrative: true,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    }

    if (conversationId) {
      const reactionPrompt = `You are ${character.name}. ${character.personality_summary || ""}
You just finished playing ${gameName} with the user. Result: ${draw ? "a draw" : userWon ? "you LOST" : "you WON"}.
Write a short in-character text message reaction (1-2 sentences, casual texting style). Be true to your personality.`;

      base44.integrations.Core.InvokeLLM({ prompt: reactionPrompt })
        .then(async (text) => {
          if (text?.trim() && conversationId) {
            await base44.entities.Message.create({
              conversation_id: conversationId,
              sender_type: "character",
              character_id: character.id,
              character_name: character.name,
              content: text.trim(),
              emotional_state: userWon ? "irritated" : "joyful",
              timestamp: new Date().toISOString(),
            });
          }
        }).catch(() => {});
    }

    onGameEnd?.(outcome);
  };

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  const handleRematch = () => {
    setResult(null);
    setRematch(r => r + 1);
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-card border border-border rounded-t-3xl overflow-hidden flex flex-col"
            style={{ maxHeight: "92vh" }}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0 bg-card/90 backdrop-blur-sm">
              <div>
                <h3 className="text-sm font-bold text-foreground">{GAME_LABELS[game]}</h3>
                <p className="text-xs text-muted-foreground">vs {character?.name}</p>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {result ? (
                <ResultScreen result={result} character={character} gameName={GAME_LABELS[game]} onClose={handleClose} onRematch={handleRematch} />
              ) : (
                <div key={rematch}>
                  {game === "tictactoe"    && <TicTacToe     character={character} onGameEnd={handleGameEnd} />}
                  {game === "dotsandboxes" && <DotsAndBoxes  character={character} onGameEnd={handleGameEnd} />}
                  {game === "pool"         && <Pool          character={character} onGameEnd={handleGameEnd} />}
                  {game === "gemduel"      && <GemDuel       character={character} onGameEnd={handleGameEnd} />}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function ResultScreen({ result, character, gameName, onClose, onRematch }) {
  const isWin  = result === "user_win";
  const isDraw = result === "draw";
  const emoji  = isDraw ? "🤝" : isWin ? "🏆" : "😤";
  const title  = isDraw ? "It's a Draw!" : isWin ? "You Won!" : `${character.name} Won!`;
  const sub    = isDraw ? "Evenly matched — good game!" : isWin ? `You beat ${character.name} at ${gameName}!` : `${character.name} got you this time.`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center gap-5 py-14 px-6"
    >
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", damping: 12, stiffness: 200, delay: 0.1 }}
        className="text-7xl drop-shadow-lg"
      >
        {emoji}
      </motion.span>
      <div className="text-center">
        <h2 className="text-2xl font-black text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{sub}</p>
        <p className="text-xs text-muted-foreground/60 mt-2">🧠 {character.name} will remember this</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onRematch} className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors">
          🔄 Rematch
        </button>
        <button onClick={onClose} className="px-6 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/70 transition-colors">
          Back to Chat
        </button>
      </div>
    </motion.div>
  );
}