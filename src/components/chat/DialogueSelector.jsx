import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, Edit3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function DialogueSelector({ playingAs, targetCharacter, recentMessages, onSelect, onClose }) {
  const [options, setOptions] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState("");
  const [generated, setGenerated] = useState(false);

  const generateOptions = async () => {
    setIsGenerating(true);
    const history = recentMessages.slice(-10).map(m => {
      const speaker = m.sender_type === "user" ? "User" : m.character_name;
      return `${speaker}: ${m.content}`;
    }).join("\n");

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are generating dialogue options for a user who is PLAYING AS the character "${playingAs.name}".

CHARACTER PLAYING AS:
Name: ${playingAs.name}
Personality: ${playingAs.personality_summary || "unknown"}
Emotional state: ${playingAs.emotional_state || "calm"}
Traits: ${(playingAs.personality_traits || []).join(", ") || "unknown"}

TALKING TO: ${targetCharacter?.name || "the group"}
${targetCharacter?.personality_summary ? `Their personality: ${targetCharacter.personality_summary}` : ""}

RECENT CONVERSATION:
${history || "(no messages yet)"}

Generate 4 distinct dialogue response options that ${playingAs.name} might say next. Each should vary in tone (e.g. warm, guarded, playful, direct). Make them short and natural — how this character actually talks. Each option should have a brief tone label.

Return ONLY a JSON object with an "options" array. Each: { text: string, tone: string }`,
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
              }
            }
          }
        }
      }
    });

    setOptions(result?.options || []);
    setIsGenerating(false);
    setGenerated(true);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border-t border-border rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Playing as {playingAs.name}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        {!generated && !isGenerating && (
          <Button onClick={generateOptions} className="w-full gap-2 rounded-xl">
            <Sparkles className="w-4 h-4" /> Generate dialogue options
          </Button>
        )}

        {isGenerating && (
          <div className="text-center py-6">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Generating options for {playingAs.name}...</p>
          </div>
        )}

        <AnimatePresence>
          {options.map((opt, i) => (
            <motion.button
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              onClick={() => onSelect(opt.text)}
              className="w-full text-left p-3 rounded-xl bg-secondary border border-border hover:border-primary/40 transition-colors space-y-1"
            >
              <span className="text-[10px] uppercase tracking-wider text-primary font-medium">{opt.tone}</span>
              <p className="text-sm text-foreground leading-relaxed">"{opt.text}"</p>
            </motion.button>
          ))}
        </AnimatePresence>

        {generated && (
          <Button variant="outline" onClick={generateOptions} disabled={isGenerating} className="w-full gap-2 rounded-xl text-xs">
            <Sparkles className="w-3 h-3" /> Regenerate
          </Button>
        )}

        <div className="border-t border-border pt-3">
          {showCustom ? (
            <div className="space-y-2">
              <Textarea
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                placeholder={`Type as ${playingAs.name}...`}
                className="rounded-xl min-h-[80px] text-sm resize-none"
                autoFocus
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setShowCustom(false); setCustomText(""); }} className="flex-1 rounded-xl text-xs">Cancel</Button>
                <Button onClick={() => customText.trim() && onSelect(customText.trim())} disabled={!customText.trim()} className="flex-1 rounded-xl gap-1 text-xs">
                  <Send className="w-3 h-3" /> Send
                </Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowCustom(true)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Edit3 className="w-3 h-3" /> Type a custom response
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}