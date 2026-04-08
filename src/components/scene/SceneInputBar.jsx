import React, { useRef, useCallback, memo } from "react";
import { Send, BookOpen } from "lucide-react";

/**
 * SceneInputBar — stable input component for the Scene page.
 *
 * Keyboard stability rules enforced here:
 * - The input element itself never remounts (no key changes, no conditional rendering)
 * - Mode toggle buttons use onMouseDown + preventDefault to avoid stealing focus from input
 * - Send button uses onMouseDown + preventDefault so the input never loses focus on tap
 * - No onTouchStart/onTouchEnd on the send button (prevents double-fire on mobile)
 * - Input className is stable — only border/italic changes, not the element itself
 * - Draft text is owned here via props; parent state updates don't remount this component
 */
function SceneInputBar({ inputText, setInputText, narratorMode, setNarratorMode, onSend }) {
  const inputRef = useRef(null);

  const handleSend = useCallback(() => {
    const text = inputTextRef.current.trim();
    if (!text) return;
    onSend(text);
    // Re-focus input after send so keyboard stays open
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [inputText, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleModeSwitch = useCallback((mode) => (e) => {
    // preventDefault stops the button from stealing focus from the input
    e.preventDefault();
    setNarratorMode(mode);
    // Re-focus input after mode switch
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [setNarratorMode]);

  // Sync inputText to a ref so handleSend always uses the latest value
  // without needing inputText in its dependency array (which would cause re-renders)
  const inputTextRef = useRef(inputText);
  inputTextRef.current = inputText;

  return (
    <div className="border-t border-border flex-shrink-0">
      {/* Mode toggle — mouseDown prevents focus theft */}
      <div className="flex gap-1 px-3 pt-2 pb-1">
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

      <div className="flex gap-2 px-3 pb-2">
        <input
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={narratorMode ? "Describe the scene, set the atmosphere..." : "Say something..."}
          className={`flex-1 h-11 px-3 rounded-xl bg-secondary border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${narratorMode ? "border-primary/40 italic" : "border-border"}`}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
        />
        <button
          // onMouseDown + preventDefault keeps focus on the input (no blur on tap)
          onMouseDown={(e) => {
            e.preventDefault();
            handleSend();
          }}
          // Fallback for devices where mouseDown doesn't fire
          onClick={(e) => {
            e.preventDefault();
            handleSend();
          }}
          disabled={!inputText.trim()}
          className={`w-11 h-11 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all active:scale-95 ${narratorMode ? "bg-primary/70 text-primary-foreground hover:bg-primary/80" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
        >
          {narratorMode ? <BookOpen className="w-4 h-4" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// memo prevents re-renders when Scene parent updates (e.g. messages, isTyping, sceneImage)
// Only re-renders when inputText, narratorMode, or callbacks actually change
export default memo(SceneInputBar);