import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Trash2, Check } from "lucide-react";
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

// "Characters They Know" editor — link active characters
function KnownCharactersEditor({ character, allCharacters }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
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

  const available = allCharacters.filter(
    c => c.id !== character.id && !existingLinkedIds.has(c.id) &&
    c.status !== "deleted" && c.status !== "soft_deleted" && c.status !== "merged"
  );

  const linked = (character.fictional_relationships || []).filter(r => r.related_character_id);

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
    setAdding(false);
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

export default function CharacterEditSettingsPanel({ isOpen, onClose, character, allCharacters }) {
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

              {/* Characters They Know */}
              <section className="space-y-3">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Characters They Know</p>
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