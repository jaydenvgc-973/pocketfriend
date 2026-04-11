import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X, CheckCircle, Link as LinkIcon, XCircle, Briefcase, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PendingLifeEventApproval
 *
 * Polls for pending occupation/education changes for a specific character
 * and shows an approval card. The user can:
 *   Approve   → AI change is applied
 *   Link      → mark as already existing (user picks from list)
 *   Reject    → discard the change
 *
 * Props:
 *   characterId: string
 *   character: Character object (for existing occupation/education data)
 */
export default function PendingLifeEventApproval({ characterId, character }) {
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState(null); // pendingId being processed
  const [showLinkOptions, setShowLinkOptions] = useState(null); // pendingId showing link picker

  const { data: pendingEvents = [] } = useQuery({
    queryKey: ["pendingLifeEvents", characterId],
    queryFn: () => base44.entities.PendingLifeEvent.filter({ character_id: characterId, status: "pending" }),
    enabled: !!characterId,
    refetchInterval: 15000,
  });

  const visibleEvents = pendingEvents.filter(e => e.status === "pending");
  if (visibleEvents.length === 0) return null;

  const handleAction = async (pendingId, action, linkedToLabel = null) => {
    setResolving(pendingId);
    try {
      await base44.functions.invoke("approvePendingLifeEvent", { pendingId, action, linkedToLabel });
      queryClient.invalidateQueries({ queryKey: ["pendingLifeEvents", characterId] });
      queryClient.invalidateQueries({ queryKey: ["character", characterId] });
    } finally {
      setResolving(null);
      setShowLinkOptions(null);
    }
  };

  // Build list of existing occupation/education entries the user can link to
  const getExistingOptions = (event) => {
    if (event.change_type === "occupation_change") {
      const options = [];
      if (character?.work_details?.job_title) {
        options.push({ label: `${character.work_details.job_title}${character.occupation_location_name ? " @ " + character.occupation_location_name : ""}` });
      }
      (character?.additional_occupation_locations || []).forEach(loc => {
        options.push({ label: `${loc.job_title || "Worker"} @ ${loc.location_name}` });
      });
      return options;
    }
    if (event.change_type === "education_change" || event.change_type === "job_training_change") {
      const options = [];
      if (character?.current_education_activity && character.current_education_activity !== "none") {
        options.push({ label: character.education_details?.course_name || character.current_education_activity });
      }
      if (character?.current_job_training_activity && character.current_job_training_activity !== "none") {
        options.push({ label: character.job_training_details?.training_name || character.current_job_training_activity });
      }
      (character?.completed_education || []).forEach(e => {
        options.push({ label: `${e.course_name} (completed)` });
      });
      (character?.completed_job_training || []).forEach(t => {
        options.push({ label: `${t.training_name} (completed)` });
      });
      return options;
    }
    return [];
  };

  const typeIcon = (changeType) => {
    if (changeType === "occupation_change") return <Briefcase className="w-4 h-4 text-blue-400" />;
    return <GraduationCap className="w-4 h-4 text-amber-400" />;
  };

  const typeLabel = (changeType) => {
    if (changeType === "occupation_change") return "Occupation Change";
    if (changeType === "education_change") return "Education Change";
    return "Job Training Change";
  };

  return createPortal(
    <div className="fixed bottom-24 right-4 z-50 w-80 space-y-2 max-h-[60vh] overflow-y-auto">
      <AnimatePresence>
        {visibleEvents.map(event => {
          const existingOptions = getExistingOptions(event);
          const isLinking = showLinkOptions === event.id;

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-4 shadow-xl"
            >
              {/* Header */}
              <div className="flex items-start gap-2 mb-3">
                {typeIcon(event.change_type)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">{typeLabel(event.change_type)}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Requires your approval</p>
                </div>
              </div>

              {/* Summary */}
              <p className="text-xs text-foreground mb-1 font-medium">{event.human_summary}</p>
              {event.reasoning && (
                <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">{event.reasoning}</p>
              )}

              {/* Link picker */}
              {isLinking && existingOptions.length > 0 && (
                <div className="mb-3 space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">This is the same as:</p>
                  {existingOptions.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => handleAction(event.id, "link", opt.label)}
                      disabled={!!resolving}
                      className="w-full text-left text-xs px-3 py-2 rounded-xl bg-secondary hover:bg-primary/10 text-foreground border border-border hover:border-primary/40 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button onClick={() => setShowLinkOptions(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
                    ← Back
                  </button>
                </div>
              )}

              {/* Actions */}
              {!isLinking && (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(event.id, "reject")}
                    disabled={!!resolving}
                    className="flex-1 h-8 text-[10px] rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10 gap-1"
                  >
                    <XCircle className="w-3 h-3" /> Reject
                  </Button>
                  {existingOptions.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowLinkOptions(event.id)}
                      disabled={!!resolving}
                      className="flex-1 h-8 text-[10px] rounded-xl gap-1"
                    >
                      <LinkIcon className="w-3 h-3" /> Already exists
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleAction(event.id, "approve")}
                    disabled={!!resolving}
                    className="flex-1 h-8 text-[10px] rounded-xl gap-1"
                  >
                    <CheckCircle className="w-3 h-3" />
                    {resolving === event.id ? "..." : "Approve"}
                  </Button>
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}