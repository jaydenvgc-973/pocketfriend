import React, { useState } from "react";
import { Eye, Play, Send, MessageSquare, Wand2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import ObserveCastPicker from "@/components/scene/ObserveCastPicker";

/**
 * ObserveStageControls
 *
 * The control strip for an observed character-to-character scene.
 * The observer is never in the scene. They can write narrative for the scene,
 * direct the moment as circumstance, or speak AS one of the characters present —
 * those words belong to that character, not to the observer.
 */
export default function ObserveStageControls({ candidates, castIds, onToggleCast, onDirect, onNarrate, onVoice, onContinue, isGenerating, blockedSpeakIds = [] }) {
  const [mode, setMode] = useState("narrate");
  const [text, setText] = useState("");
  const [speakAsId, setSpeakAsId] = useState(null);

  const cast = (candidates || []).filter((c) => castIds.includes(c.id));
  // Speak belongs to an established character only. Background people of the venue
  // take part through the scene itself and are never spoken for by the observer.
  // A child below speaking age cannot be made to speak, and the temporary caregiver
  // answers for themselves — neither is ever puppeted through Speak.
  const speakable = cast.filter((c) =>
    !c.isNpc && c.id && !String(c.id).startsWith("npc_") && !(blockedSpeakIds || []).includes(c.id)
  );
  const speaker = speakable.find((c) => c.id === speakAsId) || speakable[0] || null;
  const speaking = mode === "speak" && !!speaker;

  const submit = () => {
    const body = text.trim();
    if (!body || isGenerating) return;
    if (speaking) onVoice(speaker, body);
    else if (mode === "direct") onDirect(body);
    else onNarrate(body);
    setText("");
  };

  const placeholder = speaking
    ? `What ${speaker?.name?.split(" ")[0]} says`
    : mode === "direct"
      ? "What happens next — played out now, including any quoted words"
      : "What already happened — past events the characters already lived";

  return (
    <div className="border-t border-border bg-card/60 flex-shrink-0">
      <div className="flex items-center gap-1.5 px-3 pt-2 text-[10px] text-muted-foreground">
        <Eye className="w-3 h-3" />
        <span>You are not in the scene. No one here can see or hear you.</span>
      </div>

      <ObserveCastPicker candidates={candidates} castIds={castIds} onToggle={onToggleCast} disabled={isGenerating} />

      <div className="flex items-center gap-1.5 px-3 pt-1.5">
        <button
          onClick={() => setMode("narrate")}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${mode === "narrate" ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-muted-foreground"}`}
        >
          <BookOpen className="w-3 h-3" /> Narrative
        </button>
        <button
          onClick={() => setMode("direct")}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${mode === "direct" ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-muted-foreground"}`}
        >
          <Wand2 className="w-3 h-3" /> Direct
        </button>
        <button
          onClick={() => setMode("speak")}
          disabled={speakable.length === 0}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors disabled:opacity-40 ${speaking ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-muted-foreground"}`}
        >
          <MessageSquare className="w-3 h-3" /> Speak as
        </button>
        {speaking && speakable.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {speakable.map((c) => (
              <button
                key={c.id}
                onClick={() => setSpeakAsId(c.id)}
                className={`text-[10px] px-2 py-1 rounded-lg border flex-shrink-0 transition-colors ${speaker?.id === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-border text-muted-foreground"}`}
              >
                {c.name?.split(" ")[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 px-3 py-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={placeholder}
          className="flex-1 h-10 px-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
          disabled={isGenerating}
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={isGenerating || !text.trim() || (mode === "speak" && !speaker)}
          className="h-10 w-10 rounded-xl flex-shrink-0"
          title={speaking ? `Say it as ${speaker?.name}` : mode === "direct" ? "Play this out next" : "Record this as already happened"}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>

      <div className="px-3 pb-3">
        <Button
          variant="outline"
          onClick={onContinue}
          disabled={isGenerating}
          className="w-full h-9 rounded-xl gap-2 text-xs"
        >
          <Play className="w-3.5 h-3.5" />
          {isGenerating ? "They're talking..." : "Let them continue"}
        </Button>
      </div>
    </div>
  );
}