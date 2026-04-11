import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Link, AlertTriangle, Briefcase, GraduationCap, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

const CATEGORY_ICONS = {
  occupation: Briefcase,
  education: GraduationCap,
  job_training: Wrench,
};

const CATEGORY_LABELS = {
  occupation: "Occupation Change",
  education: "Education Change",
  job_training: "Job Training Change",
};

export default function OccupationEducationApprovalModal({ character }) {
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState(null);
  const [showLinkInput, setShowLinkInput] = useState(null);
  const [linkText, setLinkText] = useState("");

  const { data: pendingEvents = [] } = useQuery({
    queryKey: ["pendingLifeEvents", character?.id],
    queryFn: () => base44.entities.PendingLifeEvent.filter({ character_id: character.id, status: "pending" }),
    enabled: !!character?.id,
    refetchInterval: 30000,
  });

  const resolve = async (eventId, action, linkTarget) => {
    setResolving(eventId);
    await base44.functions.invoke("resolvePendingLifeEvent", { pendingEventId: eventId, action, linkTarget });
    queryClient.invalidateQueries({ queryKey: ["pendingLifeEvents", character?.id] });
    queryClient.invalidateQueries({ queryKey: ["character", character?.id] });
    setResolving(null);
    setShowLinkInput(null);
    setLinkText("");
  };

  if (pendingEvents.length === 0) return null;

  // Build existing occupation/education options for "Link to Existing"
  const existingOccupations = [
    character?.work_details?.job_title,
    character?.occupation_location_name,
    ...(character?.additional_occupation_locations || []).map(l => l.job_title || l.location_name),
    ...(character?.completed_job_training || []).map(t => t.training_name),
    character?.current_job_training_activity !== "none" && character?.current_job_training_activity,
  ].filter(Boolean);

  const existingEducation = [
    character?.education_details?.course_name,
    character?.education_location_name,
    ...(character?.additional_education_locations || []).map(l => l.program_name || l.location_name),
    ...(character?.completed_education || []).map(e => e.course_name),
    character?.current_education_activity !== "none" && character?.current_education_activity,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
          Pending AI-Proposed Changes ({pendingEvents.length})
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        The AI has proposed the following changes. Review and approve, link to an existing entry, or reject each one.
      </p>

      <AnimatePresence>
        {pendingEvents.map((event) => {
          const Icon = CATEGORY_ICONS[event.event_category] || Briefcase;
          const existingOptions = event.event_category === "education" ? existingEducation : existingOccupations;
          const isLinking = showLinkInput === event.id;

          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">{CATEGORY_LABELS[event.event_category]}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{event.description}</p>
                  {event.source_context && (
                    <p className="text-[10px] text-muted-foreground/60 mt-1 italic">Context: {event.source_context}</p>
                  )}
                </div>
              </div>

              {isLinking ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Select an existing entry this maps to, or type one:</p>
                  {existingOptions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {existingOptions.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setLinkText(opt)}
                          className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                            linkText === opt
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    placeholder="Or describe the existing entry..."
                    className="w-full h-9 px-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-xl text-xs"
                      onClick={() => { setShowLinkInput(null); setLinkText(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 rounded-xl text-xs"
                      disabled={!linkText.trim() || resolving === event.id}
                      onClick={() => resolve(event.id, "link", linkText)}
                    >
                      Confirm Link
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolving === event.id}
                    onClick={() => resolve(event.id, "reject")}
                    className="flex-1 rounded-xl text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="w-3 h-3" /> Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolving === event.id}
                    onClick={() => setShowLinkInput(event.id)}
                    className="flex-1 rounded-xl text-xs gap-1"
                  >
                    <Link className="w-3 h-3" /> Already Exists
                  </Button>
                  <Button
                    size="sm"
                    disabled={resolving === event.id}
                    onClick={() => resolve(event.id, "approve")}
                    className="flex-1 rounded-xl text-xs gap-1"
                  >
                    <CheckCircle className="w-3 h-3" />
                    {resolving === event.id ? "Applying..." : "Approve"}
                  </Button>
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}