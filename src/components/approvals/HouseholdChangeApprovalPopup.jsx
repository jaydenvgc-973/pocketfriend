import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Home, ArrowRight, Users, AlertTriangle, HelpCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const MOVE_TYPE_LABELS = {
  move_in: "Moving In",
  move_out: "Moving Out",
  eviction: "Eviction / Being Removed",
  roommate_removal: "Removing a Roommate",
  household_merge: "Household Merge",
  temporary_stay: "Temporary Stay",
  cohabitation_proposal: "Cohabitation Proposal",
  unknown: "Household Change",
};

const MOVE_TYPE_COLORS = {
  move_in: "text-blue-400",
  move_out: "text-orange-400",
  eviction: "text-red-400",
  roommate_removal: "text-red-400",
  household_merge: "text-purple-400",
  temporary_stay: "text-amber-400",
  cohabitation_proposal: "text-emerald-400",
  unknown: "text-primary",
};

const CONFIDENCE_LABELS = {
  high: { label: "Confirmed in conversation", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  medium: { label: "Discussed in conversation", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  low: { label: "Possible — detected from context", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
};

/**
 * HouseholdChangeApprovalPopup
 *
 * Full-context household change approval popup.
 * Shows who is moving, from where, to where, move type, confidence,
 * affected residents, and the triggering conversation context.
 *
 * Props:
 *   analysis: {
 *     movingCharacterName: string,
 *     movingCharacterIsSubject: boolean, // false = someone else is moving
 *     moveType: 'move_in' | 'move_out' | 'eviction' | 'roommate_removal' | 'household_merge' | 'temporary_stay' | 'cohabitation_proposal' | 'unknown',
 *     currentResidence: string | null,
 *     destinationResidence: string | null,
 *     otherPeopleMovingWith: string[],
 *     peopleRemaining: string[],
 *     peopleBeingRemoved: string[],
 *     reasonSummary: string,
 *     triggeringSentence: string,
 *     confidence: 'high' | 'medium' | 'low',
 *   }
 *   character: Character object (conversation subject)
 *   onApprove: (analysis) => void
 *   onDeny: () => void
 */
export default function HouseholdChangeApprovalPopup({ analysis, character, onApprove, onDeny }) {
  const [approving, setApproving] = useState(false);

  if (!analysis) return null;

  const moveTypeLabel = MOVE_TYPE_LABELS[analysis.moveType] || MOVE_TYPE_LABELS.unknown;
  const moveTypeColor = MOVE_TYPE_COLORS[analysis.moveType] || MOVE_TYPE_COLORS.unknown;
  const confidence = CONFIDENCE_LABELS[analysis.confidence] || CONFIDENCE_LABELS.low;

  const handleApprove = async () => {
    setApproving(true);
    await onApprove(analysis);
    setApproving(false);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onDeny(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start gap-3 p-5 border-b border-border">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Home className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Household Change Detected</h3>
              <p className={`text-xs font-medium mt-0.5 ${moveTypeColor}`}>{moveTypeLabel}</p>
            </div>
            <button onClick={onDeny} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Confidence badge */}
          <div className={`mx-5 mt-4 px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${confidence.bg}`}>
            {analysis.confidence === 'high'
              ? <Check className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" />
              : <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
            }
            <span className={confidence.color}>{confidence.label}</span>
          </div>

          {/* Core move data */}
          <div className="p-5 space-y-4">

            {/* Who is moving */}
            <div className="rounded-xl bg-secondary/60 border border-border p-3 space-y-2.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Who Is Moving</p>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-primary">{(analysis.movingCharacterName || character?.name || '?')[0]}</span>
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {analysis.movingCharacterName || character?.name || 'Unknown'}
                </span>
                {!analysis.movingCharacterIsSubject && analysis.movingCharacterName !== character?.name && (
                  <span className="text-[10px] text-muted-foreground">(not {character?.name})</span>
                )}
              </div>

              {analysis.otherPeopleMovingWith?.length > 0 && (
                <div className="flex items-start gap-2 pt-1 border-t border-border/50">
                  <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Also moving</p>
                    <p className="text-xs text-foreground">{analysis.otherPeopleMovingWith.join(", ")}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Residence change */}
            <div className="rounded-xl bg-secondary/60 border border-border p-3 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Residence Change</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground">From</p>
                  <p className="text-xs text-foreground font-medium truncate">
                    {analysis.currentResidence || <span className="text-muted-foreground italic">Unknown</span>}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-[10px] text-muted-foreground">To</p>
                  <p className="text-xs text-foreground font-medium truncate">
                    {analysis.destinationResidence || <span className="text-muted-foreground italic">Unknown</span>}
                  </p>
                </div>
              </div>
            </div>

            {/* Affected residents */}
            {(analysis.peopleRemaining?.length > 0 || analysis.peopleBeingRemoved?.length > 0) && (
              <div className="rounded-xl bg-secondary/60 border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Other Residents Affected</p>
                {analysis.peopleRemaining?.length > 0 && (
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-1.5" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Staying behind</p>
                      <p className="text-xs text-foreground">{analysis.peopleRemaining.join(", ")}</p>
                    </div>
                  </div>
                )}
                {analysis.peopleBeingRemoved?.length > 0 && (
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Being removed</p>
                      <p className="text-xs text-foreground">{analysis.peopleBeingRemoved.join(", ")}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Reason / context */}
            {analysis.reasonSummary && (
              <div className="rounded-xl bg-secondary/60 border border-border p-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Context</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{analysis.reasonSummary}</p>
              </div>
            )}

            {/* Triggering sentence */}
            {analysis.triggeringSentence && (
              <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Detected from</p>
                <p className="text-xs text-muted-foreground italic leading-relaxed">
                  "{analysis.triggeringSentence.substring(0, 200)}"
                </p>
              </div>
            )}

            {/* Low confidence warning */}
            {analysis.confidence === 'low' && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-orange-400">This interpretation may be incorrect. Review carefully before approving.</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-5 pb-5 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDeny}
              className="flex-1 rounded-xl text-xs"
            >
              Not Accurate
            </Button>
            <Button
              size="sm"
              disabled={approving}
              onClick={handleApprove}
              className="flex-1 rounded-xl gap-1.5 text-xs"
            >
              <Check className="w-3.5 h-3.5" />
              {approving ? "Saving..." : "Log This Event"}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}