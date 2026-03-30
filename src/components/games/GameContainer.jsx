import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import TicTacToe from "./TicTacToe";
import DotsAndBoxes from "./DotsAndBoxes";
import Pool from "./Pool";
import { base44 } from "@/api/base44Client";

const GAME_LABELS = {
  tictactoe: "Tic-Tac-Toe",
  dotsandboxes: "Dots & Boxes",
  pool: "Pool",
};

export default function GameContainer({ isOpen, game, character, conversationId, onClose, onGameEnd }) {
  const [result, setResult] = useState(null); // null | "user_win" | "char_win" | "draw"

  const handleGameEnd = async (outcome) => {
    // outcome: "user_win" | "char_win" | "draw"
    setResult(outcome);

    const gameName = GAME_LABELS[game] || game;
    const userWon = outcome === "user_win";
    const draw = outcome === "draw";

    // Build memory description
    const memoryDesc = draw
      ? `${character.name} played ${gameName} with the user and it ended in a draw. They both laughed about it.`
      : userWon
      ? `${character.name} played ${gameName} with the user and LOST. The user beat them fair and square.`
      : `${character.name} played ${gameName} with the user and WON. They felt great about it.`;

    // Store in character memory
    await base44.entities.Memory.create({
      character_id: character.id,
      title: `${gameName} game with user`,
      description: memoryDesc,
      emotional_impact: draw ? "neutral" : userWon ? "competitive, a little salty" : "happy, proud",
      timestamp: new Date().toISOString(),
      source_context: `game_${game}`,
    }).catch(() => {});

    // Post a narrative message in the conversation so it appears in chat
    const narrativeText = draw
      ? `📲 *${character.name} and you finished a game of ${gameName} — it was a draw!*`
      : userWon
      ? `📲 *You beat ${character.name} at ${gameName}!*`
      : `📲 *${character.name} beat you at ${gameName}!*`;

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

    // Trigger a short character reaction via LLM (fire-and-forget)
    if (conversationId) {
      const reactionPrompt = `You are ${character.name}. ${character.personality_summary || ""}
You just finished playing ${gameName} with the user and the result was: ${draw ? "a draw" : userWon ? "you LOST" : "you WON"}.
Write a short, in-character text message reaction (1-2 sentences, casual texting style). Be natural to your personality — e.g. if competitive, you might be salty about losing. If playful, joke about it.`;

      base44.integrations.Core.InvokeLLM({ prompt: reactionPrompt })
        .then(async (reactionText) => {
          if (reactionText?.trim()) {
            await base44.entities.Message.create({
              conversation_id: conversationId,
              sender_type: "character",
              character_id: character.id,
              character_name: character.name,
              content: reactionText.trim(),
              emotional_state: character.emotional_state || "calm",
              timestamp: new Date().toISOString(),
            });
          }
        })
        .catch(() => {});
    }

    onGameEnd?.(outcome);
  };

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-card border border-border rounded-t-3xl overflow-hidden flex flex-col"
            style={{ maxHeight: "90vh" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{GAME_LABELS[game]}</h3>
                <p className="text-xs text-muted-foreground">Playing with {character?.name}</p>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Game area */}
            <div className="flex-1 overflow-y-auto">
              {result ? (
                <ResultScreen result={result} character={character} gameName={GAME_LABELS[game]} onClose={handleClose} />
              ) : (
                <>
                  {game === "tictactoe" && <TicTacToe character={character} onGameEnd={handleGameEnd} />}
                  {game === "dotsandboxes" && <DotsAndBoxes character={character} onGameEnd={handleGameEnd} />}
                  {game === "pool" && <Pool character={character} onGameEnd={handleGameEnd} />}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function ResultScreen({ result, character, gameName, onClose }) {
  const emoji = result === "draw" ? "🤝" : result === "user_win" ? "🏆" : "😤";
  const title = result === "draw" ? "It's a Draw!" : result === "user_win" ? "You Won!" : `${character.name} Won!`;
  const sub = result === "draw"
    ? "Evenly matched!"
    : result === "user_win"
    ? `You beat ${character.name} at ${gameName}!`
    : `${character.name} got you this time.`;

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-12 px-6">
      <span className="text-6xl">{emoji}</span>
      <div className="text-center">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{sub}</p>
        <p className="text-xs text-muted-foreground/60 mt-2">{character.name} will remember this 🧠</p>
      </div>
      <button
        onClick={onClose}
        className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
      >
        Back to Chat
      </button>
    </div>
  );
}