import React from "react";
import { Eye, Play, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ObserveStageControls
 *
 * The control strip for an observed character-to-character scene.
 * Whatever the observer types is direction for the moment — never speech or an
 * action by them — so it is labelled as such and never rendered as a user line.
 */
export default function ObserveStageControls({ value, onChange, onDirect, onContinue, isGenerating }) {
  const submit = () => { if (!isGenerating) onDirect(); };

  return (
    <div className="border-t border-border bg-card/60 flex-shrink-0">
      <div className="flex items-center gap-1.5 px-3 pt-2 text-[10px] text-muted-foreground">
        <Eye className="w-3 h-3" />
        <span>Watching only — you are not in the scene and no one can see or hear you.</span>
      </div>
      <div className="flex items-end gap-2 px-3 py-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Nudge the moment — this is direction, not something you say"
          className="flex-1 h-10 px-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
          disabled={isGenerating}
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={isGenerating || !value.trim()}
          className="h-10 w-10 rounded-xl flex-shrink-0"
          title="Direct the moment"
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