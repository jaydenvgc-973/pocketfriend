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
  const [resolving, setResolving] = useState(null);
  const [showLinkOptions, setShowLinkOptions] = useState(null);
  const [editedDates, setEditedDates] = useState({}); // { [pendingId]: { education_start_date, education_expected_completion_date } }
  const [editedNames, setEditedNames] = useState({}); // { [pendingId]: string }

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
    const overrideDates = editedDates[pendingId] || {};
    try {
      const overrideName = editedNames[pendingId];
      await base44.functions.invoke("approvePendingLifeEvent", { pendingId, action, linkedToLabel, overrideDates, overrideName });
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

  const currentEvent = visibleEvents[0]; // Show one at a time as a modal

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <AnimatePresence mode="wait">
        {currentEvent && (() => {
          const event = currentEvent;
          const existingOptions = getExistingOptions(event);
          const isLinking = showLinkOptions === event.id;

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              className="relative z-10 bg-card border border-border rounded-2xl p-5 shadow-2xl w-full max-w-sm"
            >
              {/* Queue indicator */}
              {visibleEvents.length > 1 && (
                <div className="mb-3 flex items-center gap-1.5">
                  {visibleEvents.map((_, i) => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full ${i === 0 ? 'bg-primary' : 'bg-border'}`} />
                  ))}
                </div>
              )}

              {/* Header */}
              <div className="flex items-start gap-2 mb-3">
                {typeIcon(event.change_type)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{typeLabel(event.change_type)}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Requires your approval</p>
                </div>
                {visibleEvents.length > 1 && (
                  <span className="text-xs text-muted-foreground">{visibleEvents.length} pending</span>
                )}
              </div>

              {/* Summary */}
              <p className="text-xs text-foreground mb-1 font-medium">{event.human_summary}</p>
              {event.reasoning && (
                <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">{event.reasoning}</p>
              )}

              {/* Editable course/training name */}
              {(event.change_type === "education_change" || event.change_type === "job_training_change") && (
                <div className="mb-3 bg-secondary/40 rounded-xl p-3">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                    {event.change_type === "education_change" ? "Course Name" : "Training Name"}
                  </label>
                  <input
                    type="text"
                    defaultValue={
                      event.proposed_data?.education_details?.course_name ||
                      event.proposed_data?.current_education_activity ||
                      event.proposed_data?.job_training_details?.training_name ||
                      event.proposed_data?.current_job_training_activity ||
                      ''
                    }
                    onChange={e => setEditedNames(prev => ({ ...prev, [event.id]: e.target.value }))}
                    placeholder="Enter course name..."
                    className="w-full h-8 px-2 rounded-lg bg-input border border-border text-foreground text-xs outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              )}

              {/* Editable dates for education changes */}
              {(event.change_type === "education_change" || event.change_type === "job_training_change") && (
                <div className="mb-3 space-y-2 bg-secondary/40 rounded-xl p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Edit dates before approving</p>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Enrollment / Start Date</label>
                    <input
                      type="date"
                      defaultValue={(event.proposed_data?.education_start_date || event.proposed_data?.job_training_start_date || '').split('T')[0]}
                      onChange={e => setEditedDates(prev => ({ ...prev, [event.id]: { ...prev[event.id], [event.change_type === 'education_change' ? 'education_start_date' : 'job_training_start_date']: e.target.value ? new Date(e.target.value).toISOString() : undefined } }))}
                      className="w-full h-8 px-2 rounded-lg bg-input border border-border text-foreground text-xs outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Expected Completion Date</label>
                    <input
                      type="date"
                      defaultValue={(event.proposed_data?.education_expected_completion_date || event.proposed_data?.job_training_expected_completion_date || '').split('T')[0]}
                      onChange={e => setEditedDates(prev => ({ ...prev, [event.id]: { ...prev[event.id], [event.change_type === 'education_change' ? 'education_expected_completion_date' : 'job_training_expected_completion_date']: e.target.value ? new Date(e.target.value).toISOString() : undefined } }))}
                      className="w-full h-8 px-2 rounded-lg bg-input border border-border text-foreground text-xs outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  </div>
                </div>
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
                <div className="flex gap-1.5 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(event.id, "reject")}
                    disabled={!!resolving}
                    className="flex-1 h-9 text-xs rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10 gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </Button>
                  {existingOptions.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowLinkOptions(event.id)}
                      disabled={!!resolving}
                      className="flex-1 h-9 text-xs rounded-xl gap-1"
                    >
                      <LinkIcon className="w-3.5 h-3.5" /> Already exists
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleAction(event.id, "approve")}
                    disabled={!!resolving}
                    className="flex-1 h-9 text-xs rounded-xl gap-1"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {resolving === event.id ? "..." : "Approve"}
                  </Button>
                </div>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>,
    document.body
  );
}