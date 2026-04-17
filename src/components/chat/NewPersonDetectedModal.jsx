import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, X, ChevronDown, Ban } from "lucide-react";
import { base44 } from "@/api/base44Client";

const RELATIONSHIP_TYPES = [
  "Friend", "Close Friend", "Coworker", "Acquaintance",
  "Romantic Interest", "Ex", "Family", "Mentor", "Rival", "Other"
];

export default function NewPersonDetectedModal({ people, characterId, characterName, onDone }) {
  const [pending, setPending] = useState(
    people.map(p => ({ ...p, confirmed: false, dismissed: false, saving: false }))
  );

  const updatePerson = (index, changes) => {
    setPending(prev => prev.map((p, i) => i === index ? { ...p, ...changes } : p));
  };

  const handleAdd = async (index) => {
    const person = pending[index];
    updatePerson(index, { saving: true });
    try {
      const res = await base44.functions.invoke("createFictionalRelationship", {
        characterId,
        person_name: person.name,
        relationship_type: person.relationship_type,
        context: person.context,
      });
      if (res?.data?.success) {
        updatePerson(index, { saving: false, confirmed: true });
      } else {
        console.error("Failed to add person:", res?.data?.error || "Unknown error");
        updatePerson(index, { saving: false });
      }
    } catch (error) {
      console.error("Error adding person:", error);
      updatePerson(index, { saving: false });
    }
  };

  const handleDismiss = (index) => {
    updatePerson(index, { dismissed: true });
  };

  const handleNonsense = async (index) => {
    const person = pending[index];
    updatePerson(index, { saving: true });
    // Record feedback so AI learns this was a bad detection
    base44.functions.invoke("createFictionalRelationship", {
      characterId,
      person_name: person.name,
      relationship_type: "__nonsense_feedback__",
      context: `User marked "${person.name}" as nonsense — the AI was matching sentence structure, not actual logic. Context was: "${person.context}". Do NOT suggest this person again.`,
      _feedback_only: true,
    }).catch(() => {});
    updatePerson(index, { saving: false, dismissed: true });
  };

  const allHandled = pending.every(p => p.confirmed || p.dismissed);

  if (allHandled) {
    onDone();
    return null;
  }

  const activePeople = pending.filter(p => !p.confirmed && !p.dismissed);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-24 left-4 right-4 z-50 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary/5">
          <UserPlus className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-sm font-semibold text-foreground flex-1">
            {characterName} mentioned someone new
          </p>
          <button onClick={onDone} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="divide-y divide-border max-h-72 overflow-y-auto">
          {activePeople.map((person, i) => {
            const originalIndex = pending.findIndex(p => p.name === person.name);
            return (
              <div key={person.name} className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{person.name}</p>
                    {person.context && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{person.context}</p>
                    )}
                  </div>
                </div>

                {/* Relationship type selector */}
                <div className="relative">
                  <select
                    value={person.relationship_type}
                    onChange={e => updatePerson(originalIndex, { relationship_type: e.target.value })}
                    className="w-full appearance-none bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground pr-8 outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    {RELATIONSHIP_TYPES.map(rt => (
                      <option key={rt} value={rt}>{rt}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleAdd(originalIndex)}
                    disabled={person.saving}
                    className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60 hover:bg-primary/90 transition-colors"
                  >
                    {person.saving ? "Adding..." : `Add to ${characterName}'s world`}
                  </button>
                  <button
                    onClick={() => handleDismiss(originalIndex)}
                    className="px-3 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-medium hover:text-foreground transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleNonsense(originalIndex)}
                    disabled={person.saving}
                    title="This is nonsense — the AI misread the dialogue"
                    className="px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors disabled:opacity-60"
                  >
                    <Ban className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}