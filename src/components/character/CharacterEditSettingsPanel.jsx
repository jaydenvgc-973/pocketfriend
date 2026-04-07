import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2, Check, Link, AlertTriangle, GripVertical } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { EditableTextField, EditableSelectField, EditableEthnicityField } from "@/components/character/ProfileFieldEditor";

const RELATIONSHIP_TYPES = [
  "friend", "best friend", "close friend", "acquaintance",
  "coworker", "colleague", "boss", "employee",
  "classmate", "teammate", "roommate",
  "romantic interest", "significant other", "ex",
  "mentor", "mentee", "enemy", "rival", "other"
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
function WorldPeopleEditor({ character, allCharacters, onDropCharacter, isDragOver, onDragOver, onDragLeave }) {
  const queryClient = useQueryClient();
  const [linkingNpc, setLinkingNpc] = useState(null);

  const familyNames = new Set((character.family_members || []).map(m => m.name?.toLowerCase()));

  // Include: unlinked NPCs + NPC fictitious characters (non-active)
  const worldRels = (character.fictional_relationships || []).filter(r => {
    if (r._from_family || familyNames.has(r.person_name?.toLowerCase())) return false;
    if (!r.related_character_id) return true; // unlinked NPC
    const linked = allCharacters.find(c => c.id === r.related_character_id);
    return linked && linked.character_type !== "active"; // NPC fictitious
  });

  const seen = new Set();
  const deduped = worldRels.filter(r => {
    const key = (r.related_character_id || r.person_name)?.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const deleteRel = async (rel) => {
    let updated;
    if (rel.related_character_id) {
      updated = (character.fictional_relationships || []).filter(r => r.related_character_id !== rel.related_character_id);
    } else {
      updated = (character.fictional_relationships || []).filter(r => r.person_name?.toLowerCase() !== rel.person_name?.toLowerCase());
    }
    await base44.entities.Character.update(character.id, { fictional_relationships: updated });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  const linkNpcToCharacter = async (npc, targetChar) => {
    const updated = (character.fictional_relationships || []).map(r => {
      if (r.person_name?.toLowerCase() === npc.person_name?.toLowerCase() && !r.related_character_id) {
        return {
          ...r,
          person_name: targetChar.name,
          related_character_id: targetChar.id,
          avatar_url: targetChar.avatar_url || r.avatar_url || null,
        };
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
    await base44.entities.Character.update(character.id, { fictional_relationships: finalRels });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setLinkingNpc(null);
  };

  return (
    <div
      className={`space-y-2 min-h-[40px] rounded-xl transition-colors ${isDragOver ? "bg-primary/10 ring-2 ring-primary/40 ring-dashed" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropCharacter}
    >
      {deduped.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No people in their world yet. Drag from "Characters They Know" below.</p>
      )}
      {deduped.map((rel, i) => {
        const linkedChar = rel.related_character_id ? allCharacters.find(c => c.id === rel.related_character_id) : null;
        const avatarUrl = linkedChar?.avatar_url || rel.avatar_url || rel.photo_url;
        const possibleMatches = !rel.related_character_id
          ? findPossibleMatches(rel.person_name, allCharacters.filter(c => c.id !== character.id && c.character_type === "active"))
          : [];
        const isGhost = possibleMatches.length > 0;
        const isNPCFictitious = !!rel.related_character_id && linkedChar && linkedChar.character_type !== "active";

        return (
          <div key={i} className={`rounded-xl border px-3 py-2.5 space-y-1.5 ${isGhost ? "border-amber-500/40 bg-amber-500/5" : isNPCFictitious ? "border-primary/30 bg-primary/5" : "border-border bg-secondary/30"}`}>
            <div className="flex items-center gap-2">
              {avatarUrl
                ? <img src={avatarUrl} alt={rel.person_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                : <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{rel.person_name?.[0]?.toUpperCase()}</span></div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{rel.person_name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{rel.relationship_type}{isNPCFictitious ? " · NPC" : ""}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Only show link button for unlinked NPCs */}
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
                  onClick={() => deleteRel(rel)}
                  title="Remove"
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

      <AnimatePresence>
        {linkingNpc && (
          <GhostLinkModal
            npc={linkingNpc}
            allCharacters={allCharacters}
            character={character}
            onConfirm={(targetChar) => linkNpcToCharacter(linkingNpc, targetChar)}
            onCancel={() => setLinkingNpc(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Characters They Know Editor ───────────────────────────────────────────────
function KnownCharactersEditor({ character, allCharacters, onDragStart }) {
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

  // Only show truly active characters in "Characters They Know"
  const available = allCharacters.filter(
    c => c.id !== character.id && !existingLinkedIds.has(c.id) &&
    c.character_type === "active" &&
    c.status !== "deleted" && c.status !== "soft_deleted" && c.status !== "merged"
  );

  // Only show active characters here (NPCs belong in "People In Their World")
  const linked = (character.fictional_relationships || []).filter(r => {
    if (!r.related_character_id) return false;
    const char = allCharacters.find(c => c.id === r.related_character_id);
    return char && char.character_type === "active";
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
        <p className="text-xs text-muted-foreground italic">No active character relationships yet.</p>
      )}
      <div className="space-y-2">
        {linked.map((rel, i) => {
          const char = allCharacters.find(c => c.id === rel.related_character_id);
          return (
            <div
              key={i}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("relCharId", rel.related_character_id);
                if (onDragStart) onDragStart(rel);
              }}
              className="flex items-center gap-2 bg-secondary/50 rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing select-none"
              title="Drag to 'People In Their World' above"
            >
              {char?.avatar_url
                ? <img src={char.avatar_url} alt={rel.person_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{rel.person_name?.[0]}</span></div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{rel.person_name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{rel.relationship_type}</p>
              </div>
              <span className="text-[10px] text-muted-foreground/50 mr-1 hidden sm:block">drag ↑</span>
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

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function CharacterEditSettingsPanel({ isOpen, onClose, character, allCharacters }) {
  const queryClient = useQueryClient();
  const [worldDragOver, setWorldDragOver] = useState(false);

  const handleDropOnWorld = async (e) => {
    e.preventDefault();
    setWorldDragOver(false);
    const charId = e.dataTransfer.getData("relCharId");
    if (!charId || !character) return;

    // Find the existing relationship for this character
    const existingRel = (character.fictional_relationships || []).find(r => r.related_character_id === charId);
    if (!existingRel) return;

    // Move it: keep the relationship data but change the linked character's display group
    // by marking it so it appears in "People In Their World" — we do this by keeping
    // the related_character_id but ensuring the linked character record is set to NPC type.
    // Actually the display is based on character_type of the linked character.
    // Instead, we convert the rel to an unlinked NPC entry so it shows in "People In Their World".
    const updatedRels = (character.fictional_relationships || []).map(r => {
      if (r.related_character_id === charId) {
        // Remove the related_character_id so it moves to "People In Their World" as an unlinked NPC
        const { related_character_id, ...rest } = r;
        return rest;
      }
      return r;
    });
    await base44.entities.Character.update(character.id, { fictional_relationships: updatedRels });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
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

              {/* People In Their World */}
              <section className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">People In Their World</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Unlinked NPCs and NPC fictitious people. Drag active characters here to move them to this section.</p>
                </div>
                <WorldPeopleEditor
                  character={character}
                  allCharacters={allCharacters}
                  isDragOver={worldDragOver}
                  onDragOver={(e) => { e.preventDefault(); setWorldDragOver(true); }}
                  onDragLeave={() => setWorldDragOver(false)}
                  onDropCharacter={handleDropOnWorld}
                />
              </section>

              {/* Characters They Know */}
              <section className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Characters They Know</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Active characters. Drag any person up to "People In Their World" to move them there.</p>
                </div>
                <KnownCharactersEditor character={character} allCharacters={allCharacters} />
              </section>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}