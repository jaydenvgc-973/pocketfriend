import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Search, ChevronDown, ChevronUp, Check, AlertCircle, User, Users, Heart, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { motion, AnimatePresence } from "framer-motion";

const CHARACTER_TYPES = [
  {
    value: "active_created_character",
    label: "Active Creative Character",
    desc: "A primary character in your world — fully interactive, complex, relationship anchor.",
    icon: Star,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/40",
  },
  {
    value: "npc_fictitious",
    label: "NPC Fictitious",
    desc: "A fictional NPC tied to an active character's world. Requires a linked active character + relationship type.",
    icon: User,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/40",
    requiresLinkedChar: true,
    requiresRelType: true,
  },
  {
    value: "npc_family_member",
    label: "NPC Family Member",
    desc: "A family member NPC. Requires a linked active character + family title.",
    icon: Heart,
    color: "text-rose-400",
    bg: "bg-rose-400/10",
    border: "border-rose-400/40",
    requiresLinkedChar: true,
    requiresFamilyTitle: true,
  },
  {
    value: "npc_regular",
    label: "NPC Regular",
    desc: "A standard non-family NPC in the world — contacts list, people in their world.",
    icon: Users,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/40",
  },
];

const FAMILY_TITLES = [
  "mother", "father", "brother", "sister", "grandmother", "grandfather",
  "aunt", "uncle", "cousin", "daughter", "son", "niece", "nephew",
  "stepmother", "stepfather", "stepbrother", "stepsister", "half-brother",
  "half-sister", "great-grandmother", "great-grandfather", "child", "spouse", "other"
];

const NPC_REL_TYPES = [
  "Friend", "Coworker", "Boss", "Neighbor", "Acquaintance", "Rival",
  "Ex", "Mentor", "Student", "Partner", "Member", "Other"
];

function typeLabel(type) {
  return CHARACTER_TYPES.find(t => t.value === type)?.label || type || "Unclassified";
}

export default function EditCharacterType({ characters = [], currentUser }) {
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChar, setSelectedChar] = useState(null);
  const [selectedType, setSelectedType] = useState("");
  const [linkedCharId, setLinkedCharId] = useState("");
  const [relationshipType, setRelationshipType] = useState("");
  const [familyTitle, setFamilyTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // { success, message }

  // Active characters for linking (NPC must link to an active_created_character)
  const activeChars = useMemo(
    () => characters.filter(c => c.character_type === "active_created_character" && c.status !== "deleted"),
    [characters]
  );

  // Search all characters in the user's account
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return characters.filter(c =>
      c.status !== "deleted" &&
      (
        c.name?.toLowerCase().includes(q) ||
        (c.aliases || []).some(a => (a.text || a).toLowerCase?.().includes(q))
      )
    ).slice(0, 8);
  }, [searchQuery, characters]);

  const selectedTypeDef = CHARACTER_TYPES.find(t => t.value === selectedType);

  const canSave = () => {
    if (!selectedChar || !selectedType) return false;
    if (selectedTypeDef?.requiresLinkedChar && !linkedCharId) return false;
    if (selectedTypeDef?.requiresRelType && !relationshipType) return false;
    if (selectedTypeDef?.requiresFamilyTitle && !familyTitle) return false;
    return true;
  };

  const handleSelectChar = (char) => {
    setSelectedChar(char);
    setSelectedType(char.character_type || "");
    setLinkedCharId("");
    setRelationshipType("");
    setFamilyTitle("");
    setSaveResult(null);
    setSearchQuery("");
  };

  const handleSave = async () => {
    if (!canSave()) return;
    setIsSaving(true);
    setSaveResult(null);

    try {
      const updatePayload = { character_type: selectedType };

      // 1. Update the character's type in the backend
      await base44.entities.Character.update(selectedChar.id, updatePayload);

      // 2. Handle relationship cascades based on new type
      if (selectedType === "npc_family_member" && linkedCharId && familyTitle) {
        // Add this NPC to the linked active character's family_members list
        const linkedChar = characters.find(c => c.id === linkedCharId);
        if (linkedChar) {
          const existingFamily = linkedChar.family_members || [];
          const alreadyThere = existingFamily.some(m => m.name?.toLowerCase() === selectedChar.name?.toLowerCase());
          if (!alreadyThere) {
            await base44.entities.Character.update(linkedCharId, {
              family_members: [
                ...existingFamily,
                { name: selectedChar.name, relationship_type: familyTitle }
              ]
            });
          }
          // Also update fictional_relationships on the linked char
          const existingRels = linkedChar.fictional_relationships || [];
          const relExists = existingRels.some(r => r.related_character_id === selectedChar.id);
          if (!relExists) {
            await base44.entities.Character.update(linkedCharId, {
              fictional_relationships: [
                ...existingRels,
                {
                  person_name: selectedChar.name,
                  related_character_id: selectedChar.id,
                  relationship_type: "family",
                  description: `${familyTitle} — ${selectedChar.name}`,
                  current_status: "active",
                  emotional_impact: "neutral",
                  last_interaction_summary: "",
                  history_summary: "",
                }
              ]
            });
          }
        }
        // Store the linked char reference on the NPC itself
        await base44.entities.Character.update(selectedChar.id, {
          character_type: selectedType,
          data_scope: "private_user",
        });

      } else if (selectedType === "npc_fictitious" && linkedCharId && relationshipType) {
        // Add this NPC to the linked active character's fictional_relationships
        const linkedChar = characters.find(c => c.id === linkedCharId);
        if (linkedChar) {
          const existingRels = linkedChar.fictional_relationships || [];
          const relExists = existingRels.some(r => r.related_character_id === selectedChar.id);
          if (!relExists) {
            await base44.entities.Character.update(linkedCharId, {
              fictional_relationships: [
                ...existingRels,
                {
                  person_name: selectedChar.name,
                  related_character_id: selectedChar.id,
                  relationship_type: relationshipType.toLowerCase(),
                  description: `${relationshipType} — ${selectedChar.name}`,
                  current_status: "active",
                  emotional_impact: "neutral",
                  last_interaction_summary: "",
                  history_summary: "",
                }
              ]
            });
          }
        }

      } else if (selectedType === "active_created_character") {
        // Ensure active chars have proper status
        await base44.entities.Character.update(selectedChar.id, {
          character_type: "active_created_character",
          status: selectedChar.status === "deleted" ? "active" : (selectedChar.status || "active"),
        });
      }

      // Invalidate all character caches to cascade changes everywhere
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
      if (linkedCharId) queryClient.invalidateQueries({ queryKey: ["character", linkedCharId] });

      setSaveResult({
        success: true,
        message: `${selectedChar.name} has been reclassified as ${typeLabel(selectedType)}. All lists updated.`
      });

      // Reset form
      setSelectedChar(null);
      setSelectedType("");
      setLinkedCharId("");
      setRelationshipType("");
      setFamilyTitle("");

    } catch (err) {
      setSaveResult({ success: false, message: `Save failed: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Star className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Edit Character Type</p>
          <p className="text-xs text-muted-foreground">Reclassify any character — fix type, reassign lists, update relationships</p>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-4 rounded-xl bg-card border border-border space-y-5">

              {/* Success/Error banner */}
              <AnimatePresence>
                {saveResult && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`flex items-start gap-2 p-3 rounded-xl text-sm ${saveResult.success ? "bg-green-500/10 border border-green-500/30 text-green-400" : "bg-destructive/10 border border-destructive/30 text-destructive"}`}
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <p>{saveResult.message}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Step 1: Search */}
              {!selectedChar && (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 1 — Find a Character</p>
                  <p className="text-xs text-muted-foreground">Search all characters on your account — active, NPCs, family, contacts.</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Type a name to search..."
                      className="pl-9 rounded-xl"
                    />
                  </div>

                  {searchQuery.length >= 2 && (
                    <div className="space-y-1.5">
                      {searchResults.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-3">No characters found matching "{searchQuery}".</p>
                      ) : (
                        searchResults.map(char => (
                          <button
                            key={char.id}
                            onClick={() => handleSelectChar(char)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-left"
                          >
                            <CharacterAvatar character={char} size="sm" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{char.name}</p>
                              <p className="text-xs text-muted-foreground">{typeLabel(char.character_type)}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Selected char + type picker */}
              {selectedChar && (
                <div className="space-y-4">
                  {/* Selected character card */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Editing</p>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/60 border border-border">
                      <CharacterAvatar character={selectedChar} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{selectedChar.name}</p>
                        <p className="text-xs text-muted-foreground">Current type: <span className="text-foreground font-medium">{typeLabel(selectedChar.character_type)}</span></p>
                      </div>
                      <button
                        onClick={() => { setSelectedChar(null); setSelectedType(""); setLinkedCharId(""); setSaveResult(null); }}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Change
                      </button>
                    </div>
                  </div>

                  {/* Type selector */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 2 — Select New Type</p>
                    {CHARACTER_TYPES.map(type => {
                      const Icon = type.icon;
                      const isSelected = selectedType === type.value;
                      return (
                        <button
                          key={type.value}
                          onClick={() => { setSelectedType(type.value); setLinkedCharId(""); setRelationshipType(""); setFamilyTitle(""); }}
                          className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-colors text-left ${isSelected ? `${type.bg} ${type.border}` : "bg-secondary border-border hover:border-primary/30"}`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${isSelected ? type.bg : "bg-card"}`}>
                            <Icon className={`w-4 h-4 ${isSelected ? type.color : "text-muted-foreground"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-foreground"}`}>{type.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{type.desc}</p>
                          </div>
                          {isSelected && <Check className={`w-4 h-4 flex-shrink-0 mt-1 ${type.color}`} />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Step 3: Required relationship fields */}
                  {selectedTypeDef && (selectedTypeDef.requiresLinkedChar || selectedTypeDef.requiresRelType || selectedTypeDef.requiresFamilyTitle) && (
                    <div className="space-y-3 pt-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 3 — Required Relationship Info</p>

                      {/* Linked active character */}
                      {selectedTypeDef.requiresLinkedChar && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Link to Active Creative Character <span className="text-destructive">*</span></label>
                          {activeChars.length === 0 ? (
                            <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">No active creative characters found on this account. Create one first.</p>
                          ) : (
                            <select
                              value={linkedCharId}
                              onChange={e => setLinkedCharId(e.target.value)}
                              className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none"
                            >
                              <option value="">— Select a character —</option>
                              {activeChars.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}

                      {/* Relationship type (NPC Fictitious) */}
                      {selectedTypeDef.requiresRelType && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Relationship to that character <span className="text-destructive">*</span></label>
                          <select
                            value={relationshipType}
                            onChange={e => setRelationshipType(e.target.value)}
                            className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none"
                          >
                            <option value="">— Select relationship type —</option>
                            {NPC_REL_TYPES.map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Family title (NPC Family Member) */}
                      {selectedTypeDef.requiresFamilyTitle && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Family title <span className="text-destructive">*</span></label>
                          <select
                            value={familyTitle}
                            onChange={e => setFamilyTitle(e.target.value)}
                            className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none"
                          >
                            <option value="">— Select family title —</option>
                            {FAMILY_TITLES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Validation warning */}
                  {selectedType && !canSave() && (
                    <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {selectedTypeDef?.requiresLinkedChar && !linkedCharId
                        ? "A linked active character is required for this type."
                        : selectedTypeDef?.requiresRelType && !relationshipType
                        ? "A relationship type is required."
                        : selectedTypeDef?.requiresFamilyTitle && !familyTitle
                        ? "A family title is required."
                        : "Fill in all required fields to continue."}
                    </p>
                  )}

                  {/* Save button */}
                  <Button
                    onClick={handleSave}
                    disabled={!canSave() || isSaving}
                    className="w-full rounded-xl h-11"
                  >
                    {isSaving ? "Saving & updating all lists..." : `Apply — Reclassify as ${selectedType ? typeLabel(selectedType) : "selected type"}`}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}