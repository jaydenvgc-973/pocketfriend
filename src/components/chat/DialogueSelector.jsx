import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Send } from "lucide-react";

export default function DialogueSelector({ playingAs, targetCharacter, recentMessages, onSelect }) {
  const [options, setOptions] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [customText, setCustomText] = useState("");
  const textareaRef = useRef(null);

  // Find the relationship entry between the two characters
  const relEntry = (targetCharacter?.fictional_relationships || []).find(
    r => r.related_character_id === playingAs?.id
  );
  const friendshipLevel = relEntry?.friendship_level ?? 75;
  const romanticLevel = relEntry?.romantic_level ?? 0;
  const respectLevel = relEntry?.user_respect_level ?? 50;

  const generateOptions = async () => {
    setIsGenerating(true);
    setOptions([]);

    // Label history correctly — "user" messages ARE the playing-as character
    const history = recentMessages.slice(-10).map(m => {
      const speaker = m.sender_type === "user" ? playingAs.name : (m.character_name || targetCharacter?.name || "Character");
      return `${speaker}: ${m.content || "(image)"}`;
    }).join("\n");

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are generating dialogue options for the character "${playingAs.name}" who is speaking to "${targetCharacter?.name || "another character"}".

SPEAKER — ${playingAs.name}:
Personality: ${playingAs.personality_summary || "unknown"}
Emotional state: ${playingAs.emotional_state || "calm"}
Traits: ${(playingAs.personality_traits || []).join(", ") || "none"}
Archetype: ${playingAs.archetype || "unknown"}
Communication style: ${playingAs.communication_style || "unknown"}

RECIPIENT — ${targetCharacter?.name || "Character"}:
Personality: ${targetCharacter?.personality_summary || "unknown"}
Emotional state: ${targetCharacter?.emotional_state || "calm"}

RELATIONSHIP (${targetCharacter?.name}'s feelings toward ${playingAs.name}):
- Respect: ${respectLevel}/100
- Friendship: ${friendshipLevel}/100
- Romantic: ${romanticLevel}/100

RECENT CONVERSATION:
${history || "(conversation just started)"}

Generate EXACTLY 3 dialogue options that ${playingAs.name} would realistically say next. Each option must:
- Match ${playingAs.name}'s personality, voice, and emotional state
- Be appropriate given the relationship and conversation context
- Vary in tone (e.g. warm, direct, guarded — pick tones that make sense for this character)
- Be short and natural — how this person actually texts

Return ONLY valid JSON: { "options": [{ "text": string, "tone": string }, ...] } with exactly 3 items.`,
      response_json_schema: {
        type: "object",
        properties: {
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                tone: { type: "string" }
              },
              required: ["text", "tone"]
            }
          }
        },
        required: ["options"]
      }
    });

    const generated = (result?.options || []).slice(0, 3);
    setOptions(generated);
    setIsGenerating(false);
  };

  // Auto-generate on mount
  useEffect(() => {
    generateOptions();
  }, []);

  return (
    <div className="border-t border-border bg-card/95 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            Playing as {playingAs.name}
          </span>
        </div>
        <button
          onClick={generateOptions}
          disabled={isGenerating}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${isGenerating ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Options — scrollable, max height so it doesn't take over the page */}
      <div className="px-3 pb-2 overflow-y-auto max-h-[140px] space-y-2">
        {isGenerating && options.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
            <span className="text-xs">Generating what {playingAs.name} would say...</span>
          </div>
        )}

        <AnimatePresence>
          {options.map((opt, i) => (
            <motion.button
              key={`${opt.text}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => onSelect(opt.text)}
              className="w-full text-left px-3 py-2.5 rounded-xl bg-secondary border border-border hover:border-primary/50 hover:bg-secondary/80 transition-all space-y-0.5 active:scale-[0.99]"
            >
              <span className="text-[10px] uppercase tracking-wider text-primary/80 font-semibold">{opt.tone}</span>
              <p className="text-sm text-foreground leading-relaxed">"{opt.text}"</p>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {/* Custom input */}
      <div className="px-3 pb-4 pt-1">
        <div className="flex items-end gap-2 bg-secondary rounded-2xl p-2 border border-border/50">
          <textarea
            ref={textareaRef}
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (customText.trim()) {
                  onSelect(customText.trim());
                  setCustomText("");
                }
              }
            }}
            placeholder={`Type as ${playingAs.name}...`}
            rows={1}
            className="flex-1 bg-transparent text-foreground text-sm resize-none outline-none px-1 py-1.5 max-h-24 placeholder:text-muted-foreground"
            style={{ minHeight: "36px" }}
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              if (customText.trim()) {
                onSelect(customText.trim());
                setCustomText("");
              }
            }}
            disabled={!customText.trim()}
            className="h-8 w-8 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5 text-primary-foreground" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}