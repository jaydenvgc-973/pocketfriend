import React, { useRef, useCallback, memo } from "react";
import { Send, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

/**
 * SceneInputBar — stable input component for the Scene page.
 *
 * Layout matches Chat/Text page composer (bg-secondary rounded-2xl container,
 * resizing textarea, motion send button). Keyboard stability rules preserved:
 * - Mode toggle buttons use onMouseDown + preventDefault to avoid stealing focus
 * - Send button uses onMouseDown + preventDefault so input never loses focus on tap
 * - No onTouchStart/onTouchEnd on send (prevents double-fire on mobile)
 * - Draft text owned by parent via props; no remount on parent state changes
 */
function SceneInputBar({ inputText, setInputText, narratorMode, setNarratorMode, onSend }) {
  const inputRef = useRef(null);
  const inputTextRef = useRef(inputText);
  inputTextRef.current = inputText;

  const handleSend = useCallback(() => {
    const text = inputTextRef.current.trim();
    if (!text) return;
    onSend(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleModeSwitch = useCallback((mode) => (e) => {
    e.preventDefault();
    setNarratorMode(mode);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setNarratorMode]);

  return (
    <div className="border-t border-border flex-shrink-0 px-4 pb-4 pt-2">
      {/* Mode toggle — mouseDown prevents focus theft */}
      <div className="flex gap-1 pb-2">
        <button
          onMouseDown={handleModeSwitch(false)}
          onClick={(e) => e.preventDefault()}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${!narratorMode ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
        >
          <Send className="w-3 h-3" /> Dialogue
        </button>
        <button
          onMouseDown={handleModeSwitch(true)}
          onClick={(e) => e.preventDefault()}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${narratorMode ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
        >
          <BookOpen className="w-3 h-3" /> Narrate
        </button>
      </div>

      {/* Composer — matches Chat/Text layout exactly */}
      <div className="flex items-end gap-2 bg-secondary rounded-2xl p-2">
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={narratorMode ? "Describe the scene..." : "Say something..."}
          rows={1}
          className={`flex-1 bg-transparent text-foreground text-sm resize-none outline-none px-1 py-2 max-h-32 placeholder:text-muted-foreground${narratorMode ? " italic" : ""}`}
          style={{ minHeight: "40px" }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
        />
        <div className="flex items-center pb-1">
          <motion.div whileTap={{ scale: 0.9 }}>
            <Button
              size="icon"
              onMouseDown={(e) => { e.preventDefault(); handleSend(); }}
              onClick={(e) => { e.preventDefault(); handleSend(); }}
              disabled={!inputText.trim()}
              className="h-9 w-9 rounded-full bg-primary hover:bg-primary/90"
            >
              {narratorMode ? <BookOpen className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// memo prevents re-renders when Scene parent updates (e.g. messages, isTyping, sceneImage)
// Only re-renders when inputText, narratorMode, or callbacks actually change
export default memo(SceneInputBar);