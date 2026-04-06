import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, UserPlus, Loader2, Check, Clock, HelpCircle, XCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

const DECISION_CONFIG = {
  coming_now: { icon: Check, color: "text-emerald-400", label: "On their way!" },
  coming_later: { icon: Clock, color: "text-amber-400", label: "Coming later" },
  maybe: { icon: HelpCircle, color: "text-yellow-400", label: "Maybe" },
  declined: { icon: XCircle, color: "text-red-400", label: "Can't make it" },
};

function InviteeRow({ person, isSelected, onToggle }) {
  return (
    <button
      onClick={() => onToggle(person)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary transition-colors text-left ${isSelected ? "bg-primary/10" : ""}`}
    >
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? "bg-primary border-primary" : "border-border"}`}>
        {isSelected && <Check className="w-3 h-3 text-white" />}
      </div>
      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
        {person.avatar_url
          ? <img src={person.avatar_url} alt={person.name} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-foreground">{person.name?.[0]}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{person.name}</p>
        {person.subtitle && <p className="text-[10px] text-muted-foreground">{person.subtitle}</p>}
      </div>
    </button>
  );
}

function InviteResult({ result }) {
  const config = DECISION_CONFIG[result.decision] || DECISION_CONFIG.declined;
  const Icon = config.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 items-start p-3 rounded-xl border border-border bg-secondary/30"
    >
      <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
        {result.avatar_url
          ? <img src={result.avatar_url} alt={result.inviteeName} className="w-full h-full object-cover" />
          : <span className="text-xs font-bold text-foreground">{result.inviteeName?.[0]}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-xs font-semibold text-foreground">{result.inviteeName}</p>
          <div className={`flex items-center gap-1 ${config.color}`}>
            <Icon className="w-3 h-3" />
            <span className="text-[10px] font-medium">{config.label}</span>
          </div>
          {result.delay_minutes > 0 && (
            <span className="text-[10px] text-muted-foreground">~{result.delay_minutes}min</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground italic">"{result.response_text}"</p>
      </div>
    </motion.div>
  );
}

export default function InviteToSceneModal({ isOpen, onClose, location, characters, userDisplayName, onCharacterArrived }) {
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);
  const [sent, setSent] = useState(false);

  if (!isOpen) return null;

  // Build eligible invitees: active characters + NPC family members from all characters
  const activeChars = (characters || []).filter(c =>
    c.status === 'active' || !c.status
  );

  // Collect NPC family members from all active characters
  const npcFamilyMap = new Map();
  activeChars.forEach(char => {
    (char.family_members || []).forEach(fm => {
      if (fm.name && !npcFamilyMap.has(fm.name.toLowerCase())) {
        npcFamilyMap.set(fm.name.toLowerCase(), {
          id: `npc_family_${fm.name.replace(/\s+/g, '_')}`,
          name: fm.name,
          avatar_url: fm.photo_url || null,
          inviteeType: 'npc_family',
          subtitle: fm.relationship_type || 'Family',
        });
      }
    });
  });

  // Fictional world people from fictional_relationships (named NPCs without a linked character)
  const worldPeopleMap = new Map();
  activeChars.forEach(char => {
    (char.fictional_relationships || []).forEach(rel => {
      if (rel.person_name && !rel.related_character_id && !worldPeopleMap.has(rel.person_name.toLowerCase())) {
        worldPeopleMap.set(rel.person_name.toLowerCase(), {
          id: `npc_world_${rel.person_name.replace(/\s+/g, '_')}`,
          name: rel.person_name,
          avatar_url: rel.avatar_url || null,
          inviteeType: 'npc_world',
          subtitle: rel.relationship_type || 'Fictional person',
        });
      }
    });
  });

  const eligiblePeople = [
    ...activeChars.map(c => ({
      id: c.id,
      name: c.name,
      avatar_url: c.avatar_url,
      inviteeType: 'character',
      subtitle: c.personality_summary?.split('.')[0] || c.character_type || 'Character',
      // carry full data for backend
      _raw: c,
    })),
    ...Array.from(npcFamilyMap.values()),
    ...Array.from(worldPeopleMap.values()),
  ];

  const togglePerson = (person) => {
    setSelected(prev =>
      prev.find(p => p.id === person.id)
        ? prev.filter(p => p.id !== person.id)
        : [...prev, person]
    );
  };

  const handleSendInvites = async () => {
    if (selected.length === 0 || sending) return;
    setSending(true);
    const inviteResults = [];

    for (const person of selected) {
      try {
        const res = await base44.functions.invoke('inviteCharacterToLocation', {
          inviteeId: person.inviteeType === 'character' ? person.id : null,
          inviteeName: person.name,
          inviteeType: person.inviteeType,
          locationId: location.id,
          locationName: location.name,
          locationCategory: location.category,
          userDisplayName,
        });
        const data = res?.data || {};
        inviteResults.push({
          inviteeName: person.name,
          avatar_url: person.avatar_url,
          decision: data.decision || 'declined',
          delay_minutes: data.delay_minutes || 0,
          response_text: data.response_text || `${person.name} doesn't respond.`,
          inviteeId: person.id,
        });

        // If coming now, notify parent so they can add to scene
        if (data.decision === 'coming_now' && person.inviteeType === 'character' && onCharacterArrived) {
          onCharacterArrived(person._raw || { id: person.id, name: person.name, avatar_url: person.avatar_url });
        }
      } catch {
        inviteResults.push({
          inviteeName: person.name,
          avatar_url: person.avatar_url,
          decision: 'declined',
          delay_minutes: 0,
          response_text: `${person.name} doesn't respond.`,
        });
      }
    }

    setResults(inviteResults);
    setSent(true);
    setSending(false);
  };

  const handleClose = () => {
    setSelected([]);
    setResults([]);
    setSent(false);
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  Invite someone here
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Ask them to come to {location?.name}</p>
              </div>
              <button onClick={handleClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Results view */}
            {sent ? (
              <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                <p className="text-xs text-muted-foreground mb-3">Here's how they responded:</p>
                {results.map((r, i) => <InviteResult key={i} result={r} />)}
              </div>
            ) : (
              <>
                {/* People list */}
                <div className="max-h-72 overflow-y-auto">
                  {eligiblePeople.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">No one available to invite</p>
                  ) : (
                    <>
                      {/* Active characters */}
                      {activeChars.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 border-b border-border/50">
                            <p className="text-[9px] font-semibold text-primary/70 uppercase tracking-wider">Characters</p>
                          </div>
                          {activeChars.map(c => (
                            <InviteeRow
                              key={c.id}
                              person={{ id: c.id, name: c.name, avatar_url: c.avatar_url, subtitle: c.personality_summary?.split('.')[0] || c.character_type, inviteeType: 'character', _raw: c }}
                              isSelected={!!selected.find(p => p.id === c.id)}
                              onToggle={togglePerson}
                            />
                          ))}
                        </>
                      )}
                      {/* NPC Family */}
                      {npcFamilyMap.size > 0 && (
                        <>
                          <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                            <p className="text-[9px] font-semibold text-purple-400/70 uppercase tracking-wider">Family</p>
                          </div>
                          {Array.from(npcFamilyMap.values()).map(p => (
                            <InviteeRow key={p.id} person={p} isSelected={!!selected.find(s => s.id === p.id)} onToggle={togglePerson} />
                          ))}
                        </>
                      )}
                      {/* World people */}
                      {worldPeopleMap.size > 0 && (
                        <>
                          <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                            <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">World people</p>
                          </div>
                          {Array.from(worldPeopleMap.values()).map(p => (
                            <InviteeRow key={p.id} person={p} isSelected={!!selected.find(s => s.id === p.id)} onToggle={togglePerson} />
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Send button */}
                <div className="border-t border-border p-4">
                  <button
                    onClick={handleSendInvites}
                    disabled={selected.length === 0 || sending}
                    className="w-full h-10 rounded-2xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
                  >
                    {sending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending invites...</>
                    ) : (
                      <><UserPlus className="w-4 h-4" /> Invite {selected.length > 0 ? `${selected.length} person${selected.length > 1 ? 's' : ''}` : 'someone'}</>
                    )}
                  </button>
                </div>
              </>
            )}

            {sent && (
              <div className="border-t border-border p-4">
                <button onClick={handleClose} className="w-full h-9 rounded-2xl bg-secondary text-foreground text-sm font-medium">
                  Done
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}