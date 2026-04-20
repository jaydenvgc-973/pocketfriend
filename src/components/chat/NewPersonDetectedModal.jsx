import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, X, ChevronDown, Ban, Link2, Users, User } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

const NPC_RELATIONSHIP_TYPES = [
  "Friend", "Close Friend", "Coworker", "Acquaintance",
  "Romantic Interest", "Ex", "Mentor", "Rival", "Neighbor", "Other"
];

const FAMILY_RELATIONSHIP_TYPES = [
  "Mother", "Father", "Sister", "Brother", "Grandmother", "Grandfather",
  "Aunt", "Uncle", "Cousin", "Stepmother", "Stepfather", "Stepsister", "Stepbrother",
  "Daughter", "Son", "Niece", "Nephew", "Partner", "Spouse", "Other Family"
];

// Step 1: Choose Family or NPC
function RelationTypeChooser({ personName, onChoose }) {
  return (
    <div className="px-4 py-3 space-y-3">
      <p className="text-sm font-semibold text-foreground">{personName}</p>
      <p className="text-xs text-muted-foreground">Is this person a family member or someone in their social world?</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onChoose('family')}
          className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
        >
          <Users className="w-5 h-5 text-amber-400" />
          <span className="text-xs font-semibold text-amber-400">Family Member</span>
          <span className="text-[10px] text-muted-foreground text-center">Added to family list only</span>
        </button>
        <button
          onClick={() => onChoose('npc')}
          className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors"
        >
          <User className="w-5 h-5 text-primary" />
          <span className="text-xs font-semibold text-primary">Person in World</span>
          <span className="text-[10px] text-muted-foreground text-center">NPC, lives at VGC Towers</span>
        </button>
      </div>
    </div>
  );
}

export default function NewPersonDetectedModal({ people, characterId, characterName, onDone }) {
  const [pending, setPending] = useState(
    people.map(p => ({
      ...p,
      confirmed: false,
      dismissed: false,
      saving: false,
      relationKind: null, // 'family' | 'npc' | null (not chosen yet)
      relationship_type: NPC_RELATIONSHIP_TYPES[0],
    }))
  );
  const [linkingPerson, setLinkingPerson] = useState(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const chars = await base44.entities.Character.filter({ created_by: currentUser.email });
      return chars.filter(c => c.id !== characterId && c.character_type === "active");
    },
    enabled: !!currentUser?.email,
  });

  const updatePerson = (index, changes) => {
    setPending(prev => prev.map((p, i) => i === index ? { ...p, ...changes } : p));
  };

  // ── ADD AS NPC (full character record at VGC Towers) ─────────────────────
  const handleAddAsNPC = async (index) => {
    const person = pending[index];
    updatePerson(index, { saving: true });
    try {
      await base44.functions.invoke("createNPCCharacter", {
        name: person.name,
        relationship_type: person.relationship_type,
        speaking_character_id: characterId,
        context: person.context,
      });
      updatePerson(index, { saving: false, confirmed: true });
    } catch (err) {
      console.error('[NewPersonDetectedModal] createNPCCharacter failed:', err);
      updatePerson(index, { saving: false });
    }
  };

  // ── ADD AS FAMILY (internal family record only, no NPC) ──────────────────
  const handleAddAsFamily = async (index) => {
    const person = pending[index];
    updatePerson(index, { saving: true });
    try {
      await base44.functions.invoke("createFictionalRelationship", {
        characterId,
        person_name: person.name,
        relationship_type: person.relationship_type,
        context: person.context,
        is_family: true,
      });
      updatePerson(index, { saving: false, confirmed: true });
    } catch (err) {
      console.error('[NewPersonDetectedModal] createFictionalRelationship (family) failed:', err);
      updatePerson(index, { saving: false });
    }
  };

  const handleDismiss = (index) => updatePerson(index, { dismissed: true });

  const handleNonsense = async (index) => {
    const person = pending[index];
    updatePerson(index, { saving: true });
    base44.functions.invoke("createFictionalRelationship", {
      characterId,
      person_name: person.name,
      relationship_type: "__nonsense_feedback__",
      context: `User marked "${person.name}" as nonsense. Context: "${person.context}". Do NOT suggest again.`,
      _feedback_only: true,
    }).catch(() => {});
    updatePerson(index, { saving: false, dismissed: true });
  };

  const handleLinkToExisting = async () => {
    if (!linkingPerson || !selectedCharacterId) return;
    const index = pending.findIndex(p => p.name === linkingPerson.name);
    updatePerson(index, { saving: true });
    const targetChar = allCharacters.find(c => c.id === selectedCharacterId);
    await base44.functions.invoke("createFictionalRelationship", {
      characterId,
      person_name: linkingPerson.name,
      relationship_type: linkingPerson.relationship_type,
      related_character_id: selectedCharacterId,
      context: `${characterName} was referring to ${targetChar?.name}`,
    });
    updatePerson(index, { saving: false, confirmed: true });
    setLinkingPerson(null);
    setSelectedCharacterId(null);
  };

  const allHandled = pending.every(p => p.confirmed || p.dismissed);
  if (allHandled) { onDone(); return null; }

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

        <div className="divide-y divide-border max-h-80 overflow-y-auto">
          {activePeople.map((person) => {
            const originalIndex = pending.findIndex(p => p.name === person.name);
            const relationTypes = person.relationKind === 'family' ? FAMILY_RELATIONSHIP_TYPES : NPC_RELATIONSHIP_TYPES;

            return (
              <div key={person.name} className="space-y-2">
                {/* Step 1: Choose family vs NPC */}
                {!person.relationKind ? (
                  <RelationTypeChooser
                    personName={person.name}
                    onChoose={(kind) => updatePerson(originalIndex, {
                      relationKind: kind,
                      relationship_type: kind === 'family' ? FAMILY_RELATIONSHIP_TYPES[0] : NPC_RELATIONSHIP_TYPES[0],
                    })}
                  />
                ) : (
                  <div className="px-4 py-3 space-y-2">
                    {/* Header with back button */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{person.name}</p>
                        {person.context && (
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{person.context}</p>
                        )}
                      </div>
                      <button
                        onClick={() => updatePerson(originalIndex, { relationKind: null })}
                        className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg bg-secondary"
                      >
                        Back
                      </button>
                    </div>

                    {/* Relationship type picker */}
                    <div className="relative">
                      <select
                        value={person.relationship_type}
                        onChange={e => updatePerson(originalIndex, { relationship_type: e.target.value })}
                        className="w-full appearance-none bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground pr-8 outline-none focus:ring-1 focus:ring-primary/50"
                      >
                        {relationTypes.map(rt => (
                          <option key={rt} value={rt}>{rt}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => person.relationKind === 'family' ? handleAddAsFamily(originalIndex) : handleAddAsNPC(originalIndex)}
                        disabled={person.saving}
                        className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60 hover:bg-primary/90 transition-colors"
                      >
                        {person.saving
                          ? "Adding..."
                          : person.relationKind === 'family'
                          ? `Add to family list`
                          : `Add to ${characterName}'s world`
                        }
                      </button>
                      {person.relationKind === 'npc' && allCharacters.length > 0 && (
                        <button
                          onClick={() => setLinkingPerson(person)}
                          title="Link to an existing character"
                          className="px-3 py-2 rounded-xl bg-blue-500/10 text-blue-400 text-xs font-medium hover:bg-blue-500/20 transition-colors"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDismiss(originalIndex)}
                        className="px-3 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-medium hover:text-foreground transition-colors"
                      >
                        Skip
                      </button>
                      <button
                        onClick={() => handleNonsense(originalIndex)}
                        disabled={person.saving}
                        title="This is nonsense — AI misread the dialogue"
                        className="px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors disabled:opacity-60"
                      >
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Link to existing character sheet */}
      {linkingPerson && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/40 flex items-end"
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="w-full bg-card rounded-t-3xl border-t border-border p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Link "{linkingPerson.name}" to</h3>
              <button onClick={() => setLinkingPerson(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {allCharacters.map(char => (
                <button
                  key={char.id}
                  onClick={() => setSelectedCharacterId(char.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                    selectedCharacterId === char.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground hover:bg-secondary/80"
                  }`}
                >
                  <p className="text-sm font-medium">{char.name}</p>
                  <p className="text-xs text-muted-foreground">{char.personality_summary?.substring(0, 50) || "No description"}</p>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleLinkToExisting}
                disabled={!selectedCharacterId}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                Link
              </button>
              <button
                onClick={() => setLinkingPerson(null)}
                className="flex-1 py-2.5 rounded-xl bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}