import { useState } from "react";
import { AlertTriangle, Plus, RotateCw, X } from "lucide-react";
import { novelStageLabel } from "@/lib/novelGenerationError";

/**
 * Shown when a chapter generation attempt fails. It explains what happened to the
 * degree the failure actually identifies, reassures that nothing was changed, and
 * offers the practical next steps: retry, and leave material out of the next try.
 */
export default function NovelGenerationFailure({
  failure,
  exclusions = [],
  onExclude = null,
  onRemoveExclusion = null,
  onRetry,
  busy = false,
  onDismiss = null,
  retryLabel = "Try again",
}) {
  const [draft, setDraft] = useState("");
  if (!failure) return null;

  const stageText = novelStageLabel(failure.stage);
  // "Leave something out" is only offered once something has actually been
  // identified as the problem — otherwise it asks the reader to guess.
  const offerExclusions = !!onExclude && !!failure.canAdjust;

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onExclude?.(value);
    setDraft("");
  };

  return (
    <section className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{failure.title}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{failure.message}</p>

          {stageText && (
            <p className="mt-1.5 text-[11px] text-muted-foreground/80">
              Failed while {stageText.charAt(0).toLowerCase() + stageText.slice(1)}.
            </p>
          )}
          {!failure.determined && (
            <p className="mt-1.5 text-[11px] text-muted-foreground/80">
              The exact cause couldn&apos;t be determined from the response.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground/80">
            {failure.retryable
              ? "Trying again can help."
              : "Trying again is unlikely to help with this request."}
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {offerExclusions && (
        <div className="mt-3 pt-3 border-t border-destructive/20">
          <p className="text-[11px] font-medium text-foreground">Leave something out of the next attempt (optional)</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            A person, an event or a subject. This applies to this attempt only — no character or record is changed.
          </p>
          {exclusions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {exclusions.map((entry) => (
                <span
                  key={entry}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary border border-border text-[10px] text-foreground"
                >
                  {entry}
                  <button
                    onClick={() => onRemoveExclusion?.(entry)}
                    className="text-muted-foreground hover:text-foreground"
                    title={`Stop leaving out ${entry}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              placeholder="e.g. his brother, the funeral, the court case"
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-secondary/60 border border-border text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={add}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Add to the list"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onRetry}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <RotateCw className="w-3 h-3" />
          {busy ? "Working…" : retryLabel}
        </button>
        {failure.canAdjust && (
          <span className="text-[10px] text-muted-foreground">
            You can also change the focus{exclusions.length ? " or add more to the list" : ""} before retrying.
          </span>
        )}
      </div>

      {failure.technical && (
        <details className="mt-3">
          <summary className="text-[10px] text-muted-foreground/70 cursor-pointer select-none">
            Technical details
          </summary>
          <p className="mt-1 text-[10px] font-mono text-muted-foreground/70 break-words">{failure.technical}</p>
        </details>
      )}
    </section>
  );
}