import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2, Check, Link, AlertTriangle, Cake } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { EditableTextField, EditableSelectField, EditableEthnicityField } from "@/components/character/ProfileFieldEditor";
import { calculateBirthdateFromZodiac } from "@/lib/zodiacUtils";

const NEEDS_DEF = [
  { label: "Hunger",    key: "hunger_value",        dbKey: "hunger",    emoji: "🍽️" },
  { label: "Energy",    key: "energy_value",         dbKey: "energy",    emoji: "⚡" },
  { label: "Social",    key: "social_value",         dbKey: "social",    emoji: "👥" },
  { label: "Health",    key: "health_value",         dbKey: "health",    emoji: "❤️" },
  { label: "Mental",    key: "mental_value",         dbKey: "mental",    emoji: "🧠" },
  { label: "Financial", key: "financial_need_value", dbKey: "financial", emoji: "💰" },
  { label: "Hygiene",   key: "hygiene_value",        dbKey: "hygiene",   emoji: "🚿" },
  { label: "Comfort",   key: "comfort_value",        dbKey: "comfort",   emoji: "🛋️" },
];

function getBarColor(value) {
  if (value >= 76) return { bar: "bg-green-600",  text: "text-green-500",  label: "Strong"   };
  if (value >= 51) return { bar: "bg-blue-500",   text: "text-blue-400",   label: "Stable"   };
  if (value >= 26) return { bar: "bg-amber-500",  text: "text-amber-500",  label: "Low"      };
  return               { bar: "bg-destructive",   text: "text-destructive",label: "Critical" };
}

function NeedsEditor({ character }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => {
    const init = {};
    for (const n of NEEDS_DEF) init[n.dbKey] = Math.round(character[n.key] ?? 70);
    return init;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.functions.invoke("manualOverrideNeeds", {
        characterId: character.id,
        action: "custom",
        needs: values,
      });
      await base44.functions.invoke("simulateActiveCharacterNeeds", { characterId: character.id });
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {NEEDS_DEF.map(({ label, dbKey, emoji }) => {
        const val = values[dbKey];
        const { bar, text, label: statusLabel } = getBarColor(val);
        return (
          <div key={dbKey}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium text-foreground">{emoji} {label}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground">{val}</span>
                <span className={`text-[10px] font-semibold ${text}`}>{statusLabel}</span>
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden mb-1">
              <div className={`h-full ${bar} transition-all duration-150`} style={{ width: `${val}%` }} />
            </div>
            <input
              type="range" min={0} max={100} value={val}
              onChange={e => setValues(prev => ({ ...prev, [dbKey]: Number(e.target.value) }))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: val >= 51 ? '#22c55e' : val >= 26 ? '#f59e0b' : '#ef4444' }}
            />
          </div>
        );
      })}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 mt-2"
      >
        {saved ? <><Check className="w-3.5 h-3.5" /> Saved!</> : isSaving ? "Saving…" : "Save Needs"}
      </button>
    </div>
  );
}

const RELATIONSHIP_TYPES = [
  "friend", "best friend", "close friend", "acquaintance",
  "coworker", "colleague", "boss", "employee",
  "classmate", "teammate", "roommate",
  "romantic interest", "significant other", "ex",
  "mentor", "mentee", "case manager", "client", "enemy", "rival", "other"
];

const GENDER_OPTIONS = ["male", "female", "non-binary", "other"];
const SEXUAL_ORIENTATION_OPTIONS = ["straight", "gay", "lesbian", "bisexual", "pansexual", "asexual", "queer", "Other"];
const SOCIAL_ENERGY_OPTIONS = ["introvert", "mostly_introvert", "ambivert", "mostly_extrovert", "extrovert"];

function FieldRow({ label, children }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      {children}
    </div>
  );
}

function TextareaField({ character, field, label, placeholder }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(character[field] || "");
  useEffect(() => { setValue(character[field] || ""); }, [character[field]]);

  const save = async () => {
    if (value === (character[field] || "")) return;
    await base44.entities.Character.update(character.id, { [field]: value });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  return (
    <FieldRow label={label}>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        placeholder={placeholder || "Not set"}
        rows={3}
        className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground resize-none"
      />
    </FieldRow>
  );
}

// ── Fuzzy name match: score similarity between two names ──────────────────────
function nameSimilarity(a, b) {
  const norm = s => s.toLowerCase().trim();
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  // First name match
  const fa = na.split(" ")[0], fb = nb.split(" ")[0];
  if (fa === fb) return 0.7;
  return 0;
}

// Returns active characters that are possible matches for an NPC name
function findPossibleMatches(npcName, allCharacters) {
  return allCharacters
    .filter(c =>
      c.status !== "deleted" && c.status !== "soft_deleted" && c.status !== "merged"
    )
    .map(c => ({ char: c, score: nameSimilarity(npcName, c.name) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.char);
}

// ── Ghost Link Modal — shown when user clicks "Link to character" on an NPC ──
function GhostLinkModal({ npc, allCharacters, character, onConfirm, onCancel }) {
  const matches = findPossibleMatches(npc.person_name, allCharacters.filter(c => c.id !== character.id));
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const candidates = showAll
    ? allCharacters.filter(c => c.id !== character.id && c.status !== "deleted" && c.status !== "soft_deleted" && c.status !== "merged")
    : matches;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xs bg-card border border-border rounded-2xl overflow-hidden shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Who is "{npc.person_name}"?</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select the real character this NPC is a ghost of. They'll be linked and removed from "People in Their World".
          </p>
        </div>

        {matches.length > 0 && (
          <div className="px-3 pt-2 pb-1">
            <p className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Possible matches
            </p>
          </div>
        )}

        <div className="max-h-56 overflow-y-auto">
          {candidates.length === 0 && (
            <p className="text-xs text-muted-foreground italic px-4 py-3">No active characters found.</p>
          )}
          {candidates.map(c => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-secondary transition-colors text-left ${selected?.id === c.id ? "bg-primary/10" : ""}`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${selected?.id === c.id ? "bg-primary border-primary" : "border-border"}`}>
                {selected?.id === c.id && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              {c.avatar_url
                ? <img src={c.avatar_url} alt={c.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                : <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-xs font-bold text-primary">{c.name?.[0]}</span></div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                {c.personality_summary && <p className="text-[10px] text-muted-foreground truncate">{c.personality_summary.split(".")[0]}</p>}
              </div>
            </button>
          ))}
        </div>

        {!showAll && matches.length < allCharacters.filter(c => c.id !== character.id).length && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full text-xs text-muted-foreground hover:text-foreground py-2 border-t border-border transition-colors"
          >
            Show all characters…
          </button>
        )}

        <div className="flex gap-2 p-3 border-t border-border">
          <button
            onClick={onCancel}
            className="flex-1 text-xs text-muted-foreground bg-secondary rounded-xl py-2 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!selected}
            onClick={() => selected && onConfirm(selected)}
            className="flex-1 text-xs text-primary-foreground bg-primary rounded-xl py-2 hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
          >
            <Link className="w-3 h-3" /> Link
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

// ── People In Their World Editor ──────────────────────────────────────────────
function WorldPeopleEditor({ character, allCharacters, onMoveToKnown, currentUser }) {
  const queryClient = useQueryClient();
  const [linkingNpc, setLinkingNpc] = useState(null);
  const [linkError, setLinkError] = useState(null);

  // Routing rule: People in Their World = catch-all for everything that is NOT
  // active_created_character and NOT this character's own family_members entry.
  // Do NOT filter by specific type strings — use exclusion of active_created_character only.
  // People in Their World = catch-all: everything that is NOT active_created_character
  // and NOT this character's own family_members entry.
  const ownFamilyNames = new Set((character.family_members || []).map(m => m.name?.toLowerCase()));
  const npcRels = (character.fictional_relationships || []).filter(r => {
    if (r._from_family || ownFamilyNames.has(r.person_name?.toLowerCase())) return false;
    if (!r.related_character_id) return true; // unlinked → always here
    const linked = allCharacters.find(c => c.id === r.related_character_id);
    if (!linked) return true; // ID not found in scope → show here
    return linked.character_type !== "active_created_character";
  });

  const seen = new Set();
  const deduped = npcRels.filter(r => {
    const key = r.person_name?.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const deleteNpc = async (personName) => {
    const updated = (character.fictional_relationships || []).filter(
      r => r.person_name?.toLowerCase() !== personName.toLowerCase()
    );
    await base44.entities.Character.update(character.id, { fictional_relationships: updated });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  const linkNpcToCharacter = async (npc, targetChar) => {
    setLinkError(null);

    // Ownership diagnostic log — verify update target before attempting write
    console.log('[linkNpcToCharacter] OWNERSHIP CHECK:', {
      editedCharacterId: character.id,
      editedCharacterName: character.name,
      editedCharacterOwnerEmail: character.owner_email,
      currentUserEmail: currentUser?.email,
      targetNpcId: targetChar.id,
      targetNpcName: targetChar.name,
      targetNpcOwnerEmail: targetChar.owner_email,
    });

    const updated = (character.fictional_relationships || []).map(r => {
      if (r.person_name?.toLowerCase() === npc.person_name?.toLowerCase() && !r.related_character_id) {
        return { ...r, person_name: targetChar.name, related_character_id: targetChar.id, avatar_url: targetChar.avatar_url || r.avatar_url || null };
      }
      return r;
    });
    const linkedToTarget = updated.filter(r => r.related_character_id === targetChar.id);
    let finalRels = updated;
    if (linkedToTarget.length > 1) {
      let kept = false;
      finalRels = updated.filter(r => {
        if (r.related_character_id === targetChar.id) {
          if (!kept) { kept = true; return true; }
          return false;
        }
        return true;
      });
    }

    // Only update the character the user owns. Include owner_email explicitly so
    // RLS can match it even if the local object has a stale or stripped value.
    const updatePayload = { fictional_relationships: finalRels };
    if (character.owner_email) {
      updatePayload.owner_email = character.owner_email;
    } else if (currentUser?.email) {
      // owner_email is missing from local state — supply it from current session to satisfy RLS
      console.warn('[linkNpcToCharacter] owner_email missing from character object — using currentUser.email as fallback for RLS');
      updatePayload.owner_email = currentUser.email;
    }

    try {
      await base44.entities.Character.update(character.id, updatePayload);
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      setLinkingNpc(null);
    } catch (err) {
      console.error('[linkNpcToCharacter] Update FAILED:', {
        characterId: character.id,
        ownerEmailUsed: updatePayload.owner_email,
        error: err.message,
      });
      setLinkError(`Relationship could not be saved because the app was blocked from updating this character record. (${err.message})`);
      // Do NOT close modal — user must see the failure
    }
  };

  // Move an NPC fictitious character to "Characters They Know" by setting related_character_id to an active char
  // For now, "Move to Characters They Know" just opens the link modal (which links to an active char)
  // OR if the rel already has a related_character_id that is an NPC-type — it stays here unless user moves it

  return (
    <div className="space-y-2">
      {deduped.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No people in their world yet.</p>
      )}
      {deduped.map((rel, i) => {
        const possibleMatches = !rel.related_character_id
          ? findPossibleMatches(rel.person_name, allCharacters.filter(c => c.id !== character.id))
          : [];
        const isGhost = possibleMatches.length > 0;
        const linkedNpc = rel.related_character_id ? allCharacters.find(c => c.id === rel.related_character_id) : null;

        return (
          <div key={i} className={`rounded-xl border px-3 py-2.5 space-y-1.5 ${isGhost ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-secondary/30"}`}>
            <div className="flex items-center gap-2">
              {rel.avatar_url || rel.photo_url || linkedNpc?.avatar_url
                ? <img src={rel.avatar_url || rel.photo_url || linkedNpc?.avatar_url} alt={rel.person_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                : <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{rel.person_name?.[0]?.toUpperCase()}</span></div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{rel.person_name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{rel.relationship_type}{linkedNpc ? ` · NPC` : ""}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Move to Characters They Know */}
                <button
                  onClick={() => onMoveToKnown(rel)}
                  title="Move to Characters They Know"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors text-[10px] font-medium"
                >
                  → Known
                </button>
                {/* Link to active character (for unlinked) */}
                {!rel.related_character_id && (
                  <button
                    onClick={() => setLinkingNpc(rel)}
                    title="Link to active character"
                    className={`p-1.5 rounded-lg transition-colors ${isGhost ? "text-amber-400 hover:bg-amber-500/20" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
                  >
                    <Link className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => deleteNpc(rel.person_name)}
                  title="Remove from world"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {isGhost && (
              <p className="text-[10px] text-amber-400/80 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Possible ghost of: {possibleMatches.map(c => c.name).join(", ")}
              </p>
            )}
          </div>
        );
      })}

      {linkError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive leading-relaxed">
          {linkError}
        </div>
      )}

      <AnimatePresence>
        {linkingNpc && (
          <GhostLinkModal
            npc={linkingNpc}
            allCharacters={allCharacters}
            character={character}
            onConfirm={(targetChar) => linkNpcToCharacter(linkingNpc, targetChar)}
            onCancel={() => { setLinkingNpc(null); setLinkError(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Characters They Know Editor ───────────────────────────────────────────────
function KnownCharactersEditor({ character, allCharacters, onMoveToWorld }) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const existingLinkedIds = new Set(
    (character.fictional_relationships || [])
      .filter(r => r.related_character_id)
      .map(r => r.related_character_id)
  );

  // Only active_created_character records can be added here
  const available = allCharacters.filter(
    c => c.id !== character.id && !existingLinkedIds.has(c.id) &&
    c.status !== "deleted" && c.status !== "soft_deleted" && c.status !== "merged" &&
    c.character_type === "active_created_character"
  );

  // Characters They Know: ONLY active_created_character records with a related_character_id
  const linked = (character.fictional_relationships || []).filter(r => {
    if (!r.related_character_id) return false;
    const lc = allCharacters.find(c => c.id === r.related_character_id);
    if (!lc) return false; // if not found, don't show in either section
    return lc.character_type === "active_created_character";
  });

  const addCharacter = async (char, relType) => {
    const newRel = {
      person_name: char.name,
      related_character_id: char.id,
      relationship_type: relType || "friend",
      description: "",
      current_status: "",
      emotional_impact: "",
      history_summary: "",
      last_interaction_summary: "",
      avatar_url: char.avatar_url || null,
      user_respect_level: 50,
      friendship_level: 75,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 0,
    };
    const updated = [...(character.fictional_relationships || []), newRel];
    await base44.entities.Character.update(character.id, { fictional_relationships: updated });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setPickerOpen(false);
  };

  const removeLinked = async (charId) => {
    const updated = (character.fictional_relationships || []).filter(r => r.related_character_id !== charId);
    await base44.entities.Character.update(character.id, { fictional_relationships: updated });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  return (
    <div className="space-y-2">
      {linked.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No linked characters yet.</p>
      )}
      <div className="space-y-2">
        {linked.map((rel, i) => {
          const char = allCharacters.find(c => c.id === rel.related_character_id);
          return (
            <div key={i} className="flex items-center gap-2 bg-secondary/50 rounded-xl px-3 py-2">
              {char?.avatar_url
                ? <img src={char.avatar_url} alt={rel.person_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{rel.person_name?.[0]}</span></div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{rel.person_name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{rel.relationship_type}</p>
              </div>
              {onMoveToWorld && (
                <button
                  onClick={() => onMoveToWorld(rel)}
                  title="Move to People In Their World"
                  className="text-[10px] font-medium text-muted-foreground hover:text-primary transition-colors flex-shrink-0 px-1"
                >
                  → World
                </button>
              )}
              <button
                onClick={() => removeLinked(rel.related_character_id)}
                className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Add picker */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setPickerOpen(v => !v)}
          disabled={available.length === 0}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Add character
        </button>
        {pickerOpen && (
          <CharacterPickerDropdown
            characters={available}
            onSelect={addCharacter}
          />
        )}
      </div>
    </div>
  );
}

function CharacterPickerDropdown({ characters, onSelect }) {
  const [selectedChar, setSelectedChar] = useState(null);
  const [relType, setRelType] = useState("friend");

  return (
    <div className="absolute left-0 top-full mt-1 w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
      {!selectedChar ? (
        <div className="max-h-56 overflow-y-auto">
          {characters.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedChar(c)}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-secondary transition-colors text-left"
            >
              {c.avatar_url
                ? <img src={c.avatar_url} alt={c.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{c.name?.[0]}</span></div>
              }
              <span className="text-sm text-foreground">{c.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">How do they know {selectedChar.name}?</p>
          <select
            value={relType}
            onChange={e => setRelType(e.target.value)}
            className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 capitalize"
          >
            {RELATIONSHIP_TYPES.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedChar(null)}
              className="flex-1 text-xs text-muted-foreground bg-secondary rounded-xl py-1.5 hover:text-foreground transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => onSelect(selectedChar, relType)}
              className="flex-1 text-xs text-primary-foreground bg-primary rounded-xl py-1.5 hover:bg-primary/90 transition-colors flex items-center justify-center gap-1"
            >
              <Check className="w-3 h-3" /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Birthday + Zodiac Editor (profile only) ───────────────────────────────────
const ZODIAC_SIGNS = ["aries","taurus","gemini","cancer","leo","virgo","libra","scorpio","sagittarius","capricorn","aquarius","pisces"];
const ZODIAC_EMOJI = { aries:"♈", taurus:"♉", gemini:"♊", cancer:"♋", leo:"♌", virgo:"♍", libra:"♎", scorpio:"♏", sagittarius:"♐", capricorn:"♑", aquarius:"♒", pisces:"♓" };

function BirthdayZodiacEditor({ character }) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const currentBirthday = character.birthday || '';
  const currentZodiac = character.zodiac_sign || '';

  const handleBirthdayChange = async (e) => {
    const val = e.target.value;
    setIsSaving(true);
    try {
      await base44.entities.Character.update(character.id, { birthday: val || null });
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setIsSaving(false); }
  };

  const handleZodiacSelect = async (sign) => {
    setIsSaving(true);
    try {
      const birthdate = calculateBirthdateFromZodiac(sign, character.age_range);
      const update = { zodiac_sign: sign };
      if (birthdate && !currentBirthday) update.birthday = birthdate;
      await base44.entities.Character.update(character.id, update);
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setIsSaving(false); }
  };

  const handleAutoGenerate = async () => {
    if (!currentZodiac && !character.age_range) return;
    const sign = currentZodiac || 'leo';
    const birthdate = calculateBirthdateFromZodiac(sign, character.age_range);
    if (!birthdate) return;
    setIsSaving(true);
    try {
      await base44.entities.Character.update(character.id, { birthday: birthdate });
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setIsSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Cake className="w-3 h-3" /> Birthday & Zodiac
        </p>
        {saved && <span className="text-[10px] text-green-400">Saved</span>}
        {isSaving && !saved && <span className="text-[10px] text-muted-foreground">Saving…</span>}
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">Birthday</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={currentBirthday}
              onChange={handleBirthdayChange}
              className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary/50"
            />
            {!currentBirthday && character.age_range && (
              <button
                onClick={handleAutoGenerate}
                disabled={isSaving}
                className="px-2 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                Auto
              </button>
            )}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">Zodiac Sign</p>
          <div className="grid grid-cols-6 gap-1">
            {ZODIAC_SIGNS.map(sign => (
              <button
                key={sign}
                onClick={() => handleZodiacSelect(sign)}
                disabled={isSaving}
                title={sign}
                className={`flex flex-col items-center py-1.5 rounded-lg transition-colors disabled:opacity-50 text-[10px] ${
                  currentZodiac === sign
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
                }`}
              >
                <span className="text-base leading-none">{ZODIAC_EMOJI[sign]}</span>
              </button>
            ))}
          </div>
          {currentZodiac && (
            <p className="text-[10px] text-muted-foreground mt-1 capitalize">{currentZodiac}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const LEARNING_MODES = [
  { value: 'on_demand', label: 'Online / On-Demand', desc: 'Anytime, anywhere' },
  { value: 'remote_scheduled', label: 'Remote Scheduled', desc: 'Fixed schedule, no travel' },
  { value: 'in_person', label: 'In-Person', desc: 'Must attend location' },
];

// All possible education statuses (manual override + date-inferred)
const EDU_STATUSES = [
  { value: 'enrolled', label: 'Currently Enrolled' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'paused', label: 'Paused / On Hold' },
  { value: 'planned', label: 'Planned / Not Started' },
];

// Infer status from date range when no manual status is set
function inferEduStatus(item) {
  if (item.status && item.status !== 'active' && item.status !== 'at_risk') return item.status;
  const now = new Date();
  const start = item.start_date ? new Date(item.start_date) : null;
  const end = item.completion_date ? new Date(item.completion_date) : null;
  if (start && start > now) return 'planned';
  if (end && end < now) return 'completed';
  if (start && start <= now && end && end >= now) return 'enrolled';
  return item.status === 'active' ? 'enrolled' : (item.status || 'enrolled');
}

// ── Education Editor ─────────────────────────────────────────────────────────
function EducationEditor({ character }) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState(character.completed_education || []);
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState({ course_name: '', institution: '', completion_date: '', start_date: '', mode: 'on_demand', enrollment_type: 'course', status: 'enrolled', progress: 0 });
  const [dateError, setDateError] = useState('');

  useEffect(() => { setEntries(character.completed_education || []); }, [character.completed_education]);

  const save = async (updated) => {
    await base44.entities.Character.update(character.id, { completed_education: updated });
    queryClient.invalidateQueries({ queryKey: ['character', character.id] });
  };

  const addEntry = async () => {
    setDateError('');
    if (newEntry.start_date && newEntry.completion_date && newEntry.completion_date < newEntry.start_date) {
      setDateError('Completion date cannot be earlier than start date.');
      return;
    }
    if (!newEntry.course_name.trim()) return;
    const updated = [...entries, { ...newEntry }];
    setEntries(updated);
    await save(updated);
    setNewEntry({ course_name: '', institution: '', completion_date: '', start_date: '', mode: 'on_demand', status: 'active', progress: 0 });
    setShowAdd(false);
  };

  const removeEntry = async (idx) => {
    const updated = entries.filter((_, i) => i !== idx);
    setEntries(updated);
    await save(updated);
  };

  const updateAndSave = async (idx, field, value) => {
    const updated = entries.map((e, i) => i === idx ? { ...e, [field]: value } : e);
    setEntries(updated);
    await save(updated);
  };

  const activeProgramName = character.education_details?.course_name || character.current_education_activity;
  const hasActive = activeProgramName && activeProgramName !== 'none';

  return (
    <div className="space-y-3">
      {hasActive && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-xs font-semibold text-primary">Currently Enrolled</p>
          <p className="text-sm text-foreground">{activeProgramName}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase">Start Date</p>
              <input type="date" value={character.education_start_date?.slice(0, 10) || ''}
                onChange={async (e) => {
                  await base44.entities.Character.update(character.id, { education_start_date: e.target.value });
                  queryClient.invalidateQueries({ queryKey: ['character', character.id] });
                }}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase">Expected Completion</p>
              <input type="date" value={character.education_expected_completion_date?.slice(0, 10) || ''}
                onChange={async (e) => {
                  await base44.entities.Character.update(character.id, { education_expected_completion_date: e.target.value });
                  queryClient.invalidateQueries({ queryKey: ['character', character.id] });
                }}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {entries.map((edu, idx) => (
        <div key={idx} className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground truncate">{edu.course_name || 'Untitled'}</p>
            <button onClick={() => removeEntry(idx)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <input value={edu.course_name || ''} placeholder="Program / Course name"
            onChange={e => updateAndSave(idx, 'course_name', e.target.value)}
            className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
          />
          <input value={edu.institution || ''} placeholder="Institution"
            onChange={e => updateAndSave(idx, 'institution', e.target.value)}
            className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
          />
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase">Learning Mode</p>
            <select value={edu.mode || 'on_demand'}
              onChange={e => updateAndSave(idx, 'mode', e.target.value)}
              className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
            >
              {LEARNING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Status</p>
              {(() => {
                const inferred = inferEduStatus(edu);
                const isInferred = !edu.status || edu.status === 'active' || edu.status === 'at_risk';
                return (
                  <div className="space-y-0.5">
                    <select value={edu.status && edu.status !== 'active' && edu.status !== 'at_risk' ? edu.status : inferred}
                      onChange={e => updateAndSave(idx, 'status', e.target.value)}
                      className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
                    >
                      {EDU_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    {isInferred && <p className="text-[9px] text-muted-foreground/60 italic">Auto-inferred from dates</p>}
                  </div>
                );
              })()}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Progress %</p>
              <input type="number" min="0" max="100" value={edu.progress ?? 0}
                onChange={e => updateAndSave(idx, 'progress', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Start Date</p>
              <input type="date" value={edu.start_date?.slice(0,10) || ''}
                onChange={e => updateAndSave(idx, 'start_date', e.target.value)}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Completion Date</p>
              <input type="date" value={edu.completion_date?.slice(0,10) || ''}
                onChange={e => updateAndSave(idx, 'completion_date', e.target.value)}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              />
            </div>
          </div>
        </div>
      ))}

      {showAdd ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
          <input value={newEntry.course_name} placeholder="Program / Course name *"
            onChange={e => setNewEntry(p => ({ ...p, course_name: e.target.value }))}
            className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
          />
          <input value={newEntry.institution} placeholder="Institution (optional)"
            onChange={e => setNewEntry(p => ({ ...p, institution: e.target.value }))}
            className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase">Type</p>
              <select value={newEntry.enrollment_type}
                onChange={e => setNewEntry(p => ({ ...p, enrollment_type: e.target.value }))}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              >
                <option value="course">Course</option>
                <option value="certification">Certification</option>
                <option value="full_school">Full School</option>
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase">Status</p>
              <select value={newEntry.status}
                onChange={e => setNewEntry(p => ({ ...p, status: e.target.value }))}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              >
                {EDU_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase">Learning Mode</p>
            <select value={newEntry.mode}
              onChange={e => setNewEntry(p => ({ ...p, mode: e.target.value }))}
              className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
            >
              {LEARNING_MODES.map(m => <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Start Date</p>
              <input type="date" value={newEntry.start_date}
                onChange={e => setNewEntry(p => ({ ...p, start_date: e.target.value }))}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Completion Date</p>
              <input type="date" value={newEntry.completion_date}
                onChange={e => setNewEntry(p => ({ ...p, completion_date: e.target.value }))}
                className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none"
              />
            </div>
          </div>
          {dateError && <p className="text-xs text-destructive">{dateError}</p>}
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="flex-1 text-xs text-muted-foreground bg-secondary rounded-xl py-1.5">Cancel</button>
            <button onClick={addEntry} className="flex-1 text-xs text-primary-foreground bg-primary rounded-xl py-1.5">Add</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 text-xs text-primary font-medium">
          <Plus className="w-3.5 h-3.5" /> Add education entry
        </button>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function CharacterEditSettingsPanel({ isOpen, onClose, character, allCharacters, currentUser }) {
  const queryClient = useQueryClient();

  // Move a relationship from "People In Their World" → "Characters They Know"
  // (sets a placeholder related_character_id removal — just clears the npc flag by opening the link modal;
  //  here we just toggle: remove related_character_id so it becomes an unlinked NPC under World,
  //  and "Move to Known" will open the ghost link picker)
  // Actually: "Move to Known" means: if unlinked, let user pick an active char to link.
  //           "Move to World" means: strip related_character_id so it becomes an unlinked NPC.
  const handleMoveToWorld = async (rel) => {
    if (!rel.related_character_id) return; // already unlinked
    const updated = (character.fictional_relationships || []).map(r => {
      if (r.related_character_id === rel.related_character_id && r.person_name === rel.person_name) {
        const { related_character_id, avatar_url, ...rest } = r;
        return { ...rest, avatar_url: avatar_url || null }; // keep avatar but strip link
      }
      return r;
    });
    await base44.entities.Character.update(character.id, { fictional_relationships: updated });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  // "Move to Known" — promotes an NPC-type Character to active so it appears in Characters They Know.
  // NEVER strips related_character_id — doing so would create an orphan name entry.
  // If the entry has no related_character_id, the ghost link modal in WorldPeopleEditor handles it.
  const handleMoveToKnown = async (rel) => {
    if (!rel.related_character_id) return; // handled by ghost link modal in WorldPeopleEditor
    try {
      const linkedChars = await base44.entities.Character.filter({ id: rel.related_character_id });
      const linked = linkedChars[0];
      if (linked && linked.character_type !== 'active_created_character') {
        await base44.entities.Character.update(linked.id, {
          character_type: 'active_created_character',
          is_active_character: true,
          exclude_from_homepage: false,
        });
      }
    } catch (err) {
      console.warn('[CharacterEditSettingsPanel] Could not promote NPC to active:', err.message);
    }
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    queryClient.invalidateQueries({ queryKey: ["accountCharacters"] });
  };

  if (!isOpen || !character) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex justify-end"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border-l border-border h-full overflow-y-auto flex flex-col"
          >
            {/* Header */}
            <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3 z-10">
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">Edit {character.name}</h3>
                <p className="text-[10px] text-muted-foreground">Changes save automatically</p>
              </div>
            </div>

            {/* Fields */}
            <div className="flex-1 px-4 py-5 space-y-5">

              {/* Identity */}
              <section className="space-y-4">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Identity</p>
                <EditableTextField character={character} field="name" label="Name" placeholder="Name" />
                <EditableTextField character={character} field="occupation" label="Occupation" placeholder="e.g. Software Engineer" />
                <EditableSelectField character={character} field="gender" label="Gender" options={GENDER_OPTIONS} />
                <EditableSelectField character={character} field="sexual_orientation" label="Orientation" options={SEXUAL_ORIENTATION_OPTIONS} />
                <EditableSelectField character={character} field="social_energy" label="Social Energy" options={SOCIAL_ENERGY_OPTIONS} />
                <EditableEthnicityField character={character} />
                <EditableTextField character={character} field="city" label="City" placeholder="City" />
                <EditableTextField character={character} field="state" label="State" placeholder="State" />
                <BirthdayZodiacEditor character={character} />
              </section>

              {/* Personality */}
              <section className="space-y-4">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Personality</p>
                <TextareaField character={character} field="personality_summary" label="Personality Summary" placeholder="Describe their personality..." />
                <TextareaField character={character} field="communication_style" label="Communication Style" placeholder="How do they talk and communicate..." />
                <TextareaField character={character} field="archetype" label="Archetype" placeholder="e.g. The Protector, The Dreamer..." />
              </section>

              {/* Background */}
              <section className="space-y-4">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Background</p>
                <TextareaField character={character} field="background_story" label="Background Story" placeholder="Their backstory..." />
                <TextareaField character={character} field="current_situation" label="Current Situation" placeholder="What's going on in their life right now..." />
                <TextareaField character={character} field="family_history" label="Family History" placeholder="Family background..." />
                <TextareaField character={character} field="criminal_record" label="Criminal Record" placeholder="None" />
              </section>

              {/* Occupation */}
              <section className="space-y-4">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Occupation</p>
                <EditableTextField character={character} field="occupation" label="Job Title" placeholder="e.g. Nurse, Barista, Software Engineer" />
              </section>

              {/* Needs */}
              <section className="space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Needs Status</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Drag sliders then hit Save Needs to apply.</p>
                </div>
                <NeedsEditor character={character} />
              </section>

              {/* Education */}
              <section className="space-y-4">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Education</p>
                <EducationEditor character={character} />
              </section>

              {/* People In Their World */}
              <section className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">People In Their World</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Unlinked NPCs and NPC fictitious people they know. Use "→ Known" to move someone to active character relationships, or link them.</p>
                </div>
                <WorldPeopleEditor character={character} allCharacters={allCharacters} onMoveToKnown={handleMoveToKnown} currentUser={currentUser} />
              </section>

              {/* Characters They Know */}
              <section className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Characters They Know</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Active characters with a direct link. Use "→ World" to move someone to People In Their World.</p>
                </div>
                <KnownCharactersEditor character={character} allCharacters={allCharacters} onMoveToWorld={handleMoveToWorld} />
              </section>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}