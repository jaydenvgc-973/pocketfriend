import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen, User, Users } from "lucide-react";
import NovelFocusPicker from "./NovelFocusPicker";
import NovelGenerationFailure from "./NovelGenerationFailure";
import useNovelCharacterCandidates from "@/hooks/useNovelCharacterCandidates";

export default function NovelCreateDialog({
  open, onOpenChange, character, characters = [], worldName = "", onSubmit, busy = false, failure = null,
}) {
  const [title, setTitle] = useState("");
  const [focus, setFocus] = useState("");
  const [premise, setPremise] = useState("");
  const [perspective, setPerspective] = useState("character");
  const [focusIds, setFocusIds] = useState([]);
  const [focusMode, setFocusMode] = useState("selected");
  const [includeUser, setIncludeUser] = useState(false);
  const [exclusions, setExclusions] = useState([]);
  const [localError, setLocalError] = useState(null);

  const { connectedIds, crossAccountCharacters, isLoading: loadingCandidates } =
    useNovelCharacterCandidates(character?.id, open);

  const reset = () => {
    setTitle(""); setFocus(""); setPremise(""); setPerspective("character");
    setFocusIds([]); setFocusMode("selected"); setIncludeUser(false);
    setExclusions([]); setLocalError(null);
  };

  const handleOpenChange = (next) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const payload = () => ({
    title: title.trim(),
    focus: focus.trim(),
    premise: premise.trim(),
    perspective,
    focusCharacterIds: focusMode === "known" ? [] : focusIds,
    focusMode,
    includeUser,
    exclusions,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!premise.trim()) { setLocalError("Describe what the novel should explore."); return; }
    setLocalError(null);
    onSubmit(payload());
  };

  // Retrying keeps everything the reader typed, including what they chose to leave out.
  const handleRetry = () => {
    if (!premise.trim()) { setLocalError("Describe what the novel should explore."); return; }
    setLocalError(null);
    onSubmit(payload());
  };

  const others = characters.filter((c) => c.id !== character?.id);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" /> New novel
          </DialogTitle>
          <DialogDescription>
            Written from {character?.name}&apos;s established life — background, family, journal, memories, relationships and recorded conversations.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave empty to have one written for it"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground">Novel focus</label>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Her whole life, her family history, one relationship, certain years…"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground">Premise</label>
            <textarea
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              rows={4}
              placeholder="What should this novel explore?"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground">Narrative perspective</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPerspective("character")}
                className={`p-2.5 rounded-lg border text-left transition-colors ${perspective === "character" ? "border-primary/60 bg-primary/10" : "border-border bg-secondary/40"}`}
              >
                <User className="w-3.5 h-3.5 text-primary mb-1" />
                <p className="text-xs font-medium text-foreground">Their own voice</p>
                <p className="text-[10px] text-muted-foreground leading-tight">First person, from {character?.name}</p>
              </button>
              <button
                type="button"
                onClick={() => setPerspective("outside_narrator")}
                className={`p-2.5 rounded-lg border text-left transition-colors ${perspective === "outside_narrator" ? "border-primary/60 bg-primary/10" : "border-border bg-secondary/40"}`}
              >
                <Users className="w-3.5 h-3.5 text-primary mb-1" />
                <p className="text-xs font-medium text-foreground">Outside narrator</p>
                <p className="text-[10px] text-muted-foreground leading-tight">Third person, sees into everyone</p>
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground">Focus characters</label>
            <p className="text-[10px] text-muted-foreground mb-1.5">{character?.name} is always the centre. Add anyone who should be central.</p>

            <button
              type="button"
              onClick={() => setFocusMode((m) => (m === "known" ? "selected" : "known"))}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors mb-2 ${
                focusMode === "known" ? "border-primary/60 bg-primary/10" : "border-border bg-secondary/40"
              }`}
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                focusMode === "known" ? "bg-primary border-primary" : "border-border"
              }`}>
                {focusMode === "known" && <span className="text-[9px] text-primary-foreground font-bold">✓</span>}
              </span>
              <span className="flex-1">
                <span className="block text-xs text-foreground">Anyone the Character Knows</span>
                <span className="block text-[10px] text-muted-foreground leading-tight">
                  Let the novel draw on every established connection instead of picking people yourself.
                </span>
              </span>
            </button>

            {focusMode === "known" ? (
              <p className="text-[10px] text-muted-foreground italic px-1">
                Everyone {character?.name} has a relationship, memory, conversation or shared scene with may appear — only those the premise needs.
              </p>
            ) : (
              <NovelFocusPicker
                characters={others}
                crossAccount={crossAccountCharacters}
                connectedIds={connectedIds}
                centralName={character?.name || "them"}
                selectedIds={focusIds}
                isLoading={loadingCandidates}
                onToggle={(id) => setFocusIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => setIncludeUser((v) => !v)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${includeUser ? "border-primary/60 bg-primary/10" : "border-border bg-secondary/40"}`}
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${includeUser ? "bg-primary border-primary" : "border-border"}`}>
              {includeUser && <span className="text-[9px] text-primary-foreground font-bold">✓</span>}
            </span>
            <span className="text-xs text-foreground">
              Include me in the novel{worldName ? ` as ${worldName}` : ""}
            </span>
          </button>

          {localError && <p className="text-xs text-destructive">{localError}</p>}

          <NovelGenerationFailure
            failure={failure}
            exclusions={exclusions}
            onExclude={(value) => setExclusions((prev) => (prev.includes(value) ? prev : [...prev, value]))}
            onRemoveExclusion={(value) => setExclusions((prev) => prev.filter((v) => v !== value))}
            onRetry={handleRetry}
            busy={busy}
            retryLabel="Write chapter one"
          />

          {!failure && (
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Writing chapter one…" : "Write chapter one"}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}