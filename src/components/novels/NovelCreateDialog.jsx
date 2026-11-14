import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen, User, Users } from "lucide-react";
import NovelFocusPicker from "./NovelFocusPicker";

export default function NovelCreateDialog({
  open, onOpenChange, character, characters = [], worldName = "", onSubmit, busy = false, error = null,
}) {
  const [title, setTitle] = useState("");
  const [focus, setFocus] = useState("");
  const [premise, setPremise] = useState("");
  const [perspective, setPerspective] = useState("character");
  const [focusIds, setFocusIds] = useState([]);
  const [includeUser, setIncludeUser] = useState(false);
  const [localError, setLocalError] = useState(null);

  const reset = () => {
    setTitle(""); setFocus(""); setPremise(""); setPerspective("character");
    setFocusIds([]); setIncludeUser(false); setLocalError(null);
  };

  const handleOpenChange = (next) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!premise.trim()) { setLocalError("Describe what the novel should explore."); return; }
    setLocalError(null);
    onSubmit({ title: title.trim(), focus: focus.trim(), premise: premise.trim(), perspective, focusCharacterIds: focusIds, includeUser });
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
            <NovelFocusPicker
              characters={others}
              selectedIds={focusIds}
              onToggle={(id) => setFocusIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
            />
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

          {(localError || error) && <p className="text-xs text-destructive">{localError || error}</p>}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Writing chapter one…" : "Write chapter one"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}