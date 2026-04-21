import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Search, ChevronDown, ChevronUp, Check, AlertCircle, User, Users, Heart, Star, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { motion, AnimatePresence } from "framer-motion";

// Type definitions matching the actual Character entity enum
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

// Normalize name for duplicate detection
function normalizeName(name) {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Find strong and potential matches
function findMatches(query, characters) {
  if (!query.trim()) return { strong: [], weak: [] };
  const normalized = normalizeName(query);
  const strong = [];
  const weak = [];

  for (const char of characters) {
    if (char.status === "deleted") continue;

    const charNorm = normalizeName(char.name);
    // Exact match
    if (charNorm === normalized) {
      strong.push(char);
    }
    // Contains match
    else if (charNorm.includes(normalized) || normalized.includes(charNorm)) {
      weak.push(char);
    }
    // Check aliases
    else if ((char.aliases || []).some(a => normalizeName(a.text || a).includes(normalized))) {
      weak.push(char);
    }
  }

  return { strong, weak };
}

export default function EditCharacterType({ characters = [], currentUser }) {
  const queryClient = useQueryClient();

  // Re-fetch all characters and filter client-side by owner_email OR created_by
  const { data: userCharacters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const allChars = await base44.entities.Character.list("-created_date", 200);
      return allChars.filter(c => (c.owner_email === currentUser.email || c.created_by === currentUser.email));
    },
    enabled: !!currentUser?.email,
  });

  // ONLY use freshly fetched characters filtered by owner_email or created_by
  const scopedCharacters = userCharacters.filter(c => (c.owner_email === currentUser?.email || c.created_by === currentUser?.email));

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChar, setSelectedChar] = useState(null);
  const [selectedType, setSelectedType] = useState("");
  const [linkedCharId, setLinkedCharId] = useState("");
  const [relationshipType, setRelationshipType] = useState("");
  const [familyTitle, setFamilyTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCharName, setNewCharName] = useState("");
  const [showMatchWarning, setShowMatchWarning] = useState(false);
  const [potentialMatches, setPotentialMatches] = useState([]);

  // CRITICAL: Only show characters that belong to the current user
  const activeChars = useMemo(
    () => scopedCharacters.filter(c => 
      c.character_type === "active_created_character" && 
      c.status !== "deleted" && 
      (c.owner_email === currentUser?.email || c.created_by === currentUser?.email)
    ),
    [scopedCharacters, currentUser?.email]
  );

  const { strong: strongMatches, weak: weakMatches } = useMemo(
    () => findMatches(searchQuery, scopedCharacters),
    [searchQuery, scopedCharacters]
  );

  const selectedTypeDef = CHARACTER_TYPES.find(t => t.value === selectedType);

  const canSave = () => {
    if (!selectedChar && !isCreatingNew) return false;
    if (!selectedType) return false;
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
    setShowMatchWarning(false);
    setIsCreatingNew(false);
    setNewCharName("");
  };

  const handleProceedToCreate = (name) => {
    setIsCreatingNew(true);
    setNewCharName(name);
    setSelectedType("");
    setLinkedCharId("");
    setRelationshipType("");
    setFamilyTitle("");
    setSaveResult(null);
    setShowMatchWarning(false);
  };

  const handleSaveExisting = async () => {
    if (!selectedChar || !selectedType || !canSave()) return;
    setIsSaving(true);
    setSaveResult(null);

    try {
      const oldType = selectedChar.character_type;
      const updatePayload = { character_type: selectedType };

      // Update the character record
      await base44.entities.Character.update(selectedChar.id, updatePayload);

      // Handle relationship cascades based on new type
      if (selectedType === "npc_family_member" && linkedCharId && familyTitle) {
        const linkedChar = characters.find(c => c.id === linkedCharId);
        if (linkedChar) {
          const existingFamily = linkedChar.family_members || [];
          const alreadyThere = existingFamily.some(m => normalizeName(m.name) === normalizeName(selectedChar.name));
          if (!alreadyThere) {
            await base44.entities.Character.update(linkedCharId, {
              family_members: [...existingFamily, { name: selectedChar.name, relationship_type: familyTitle }]
            });
          }
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
      } else if (selectedType === "npc_fictitious" && linkedCharId && relationshipType) {
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
      }

      // Invalidate all character caches
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
      if (linkedCharId) queryClient.invalidateQueries({ queryKey: ["character", linkedCharId] });

      setSaveResult({
        success: true,
        message: `✓ ${selectedChar.name} reclassified as ${typeLabel(selectedType)}. All lists updated.`
      });

      setTimeout(() => {
        setSelectedChar(null);
        setSelectedType("");
        setLinkedCharId("");
        setRelationshipType("");
        setFamilyTitle("");
        setSearchQuery("");
      }, 2000);

    } catch (err) {
      setSaveResult({ success: false, message: `Save failed: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNew = async () => {
    if (!newCharName.trim() || !selectedType || !canSave()) return;
    setIsSaving(true);
    setSaveResult(null);

    try {
      const charData = {
        name: newCharName.trim(),
        character_type: selectedType,
        status: "active",
        created_by: currentUser?.email,
        owner_email: currentUser?.email,
        owner_user_id: currentUser?.id,
        created_by_role: currentUser?.role || "user",
      };

      const created = await base44.entities.Character.create(charData);

      // Set up relationships immediately
      if (linkedCharId) {
        const linkedChar = characters.find(c => c.id === linkedCharId);
        if (linkedChar) {
          if (selectedType === "npc_family_member" && familyTitle) {
            const existingFamily = linkedChar.family_members || [];
            await base44.entities.Character.update(linkedCharId, {
              family_members: [...existingFamily, { name: created.name, relationship_type: familyTitle }]
            });
            const existingRels = linkedChar.fictional_relationships || [];
            await base44.entities.Character.update(linkedCharId, {
              fictional_relationships: [
                ...existingRels,
                {
                  person_name: created.name,
                  related_character_id: created.id,
                  relationship_type: "family",
                  description: `${familyTitle} — ${created.name}`,
                  current_status: "active",
                  emotional_impact: "neutral",
                  last_interaction_summary: "",
                  history_summary: "",
                }
              ]
            });
          } else if (selectedType === "npc_fictitious" && relationshipType) {
            const existingRels = linkedChar.fictional_relationships || [];
            await base44.entities.Character.update(linkedCharId, {
              fictional_relationships: [
                ...existingRels,
                {
                  person_name: created.name,
                  related_character_id: created.id,
                  relationship_type: relationshipType.toLowerCase(),
                  description: `${relationshipType} — ${created.name}`,
                  current_status: "active",
                  emotional_impact: "neutral",
                  last_interaction_summary: "",
                  history_summary: "",
                }
              ]
            });
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["characters"] });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      if (linkedCharId) queryClient.invalidateQueries({ queryKey: ["character", linkedCharId] });

      setSaveResult({
        success: true,
        message: `✓ Created ${newCharName} as ${typeLabel(selectedType)}. All lists updated.`
      });

      setTimeout(() => {
        setIsCreatingNew(false);
        setNewCharName("");
        setSearchQuery("");
        setSelectedType("");
        setLinkedCharId("");
        setRelationshipType("");
        setFamilyTitle("");
      }, 2000);

    } catch (err) {
      setSaveResult({ success: false, message: `Creation failed: ${err.message}` });
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
          <p className="text-xs text-muted-foreground">Correct character classification, update relationships, reassign to proper lists</p>
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
                    {saveResult.success ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                    <p>{saveResult.message}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Create new mode */}
              {isCreatingNew && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Creating New Character</p>
                    <div className="p-3 rounded-xl bg-secondary/60 border border-border">
                      <p className="text-sm font-semibold text-foreground">{newCharName}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 1 — Select Type</p>
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
                            <p className="text-sm font-medium">{type.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{type.desc}</p>
                          </div>
                          {isSelected && <Check className={`w-4 h-4 flex-shrink-0 mt-1 ${type.color}`} />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Required fields for new character */}
                  {selectedType && selectedTypeDef && (selectedTypeDef.requiresLinkedChar || selectedTypeDef.requiresRelType || selectedTypeDef.requiresFamilyTitle) && (
                    <div className="space-y-3 pt-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 2 — Required Relationship Info</p>

                      {selectedTypeDef.requiresLinkedChar && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Link to Active Creative Character <span className="text-destructive">*</span></label>
                          {activeChars.length === 0 ? (
                            <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">No active creative characters. Create one first.</p>
                          ) : (
                            <select value={linkedCharId} onChange={e => setLinkedCharId(e.target.value)} className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none">
                              <option value="">— Select character (own account only) —</option>
                              {activeChars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                        </div>
                      )}

                      {selectedTypeDef.requiresRelType && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Relationship type <span className="text-destructive">*</span></label>
                          <select value={relationshipType} onChange={e => setRelationshipType(e.target.value)} className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none">
                            <option value="">— Select relationship —</option>
                            {NPC_REL_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      )}

                      {selectedTypeDef.requiresFamilyTitle && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Family title <span className="text-destructive">*</span></label>
                          <select value={familyTitle} onChange={e => setFamilyTitle(e.target.value)} className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none">
                            <option value="">— Select title —</option>
                            {FAMILY_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {!canSave() && selectedType && (
                    <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      Fill in all required fields to create
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={() => { setIsCreatingNew(false); setNewCharName(""); setSelectedType(""); setSearchQuery(""); }} variant="outline" className="flex-1 rounded-xl h-11">Cancel</Button>
                    <Button onClick={handleCreateNew} disabled={!canSave() || isSaving} className="flex-1 rounded-xl h-11">
                      {isSaving ? "Creating..." : "Create Character"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Search and select mode */}
              {!selectedChar && !isCreatingNew && (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 1 — Find or Create Character</p>
                  <p className="text-xs text-muted-foreground">Search across all your characters — active, NPCs, family, contacts.</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setShowMatchWarning(false); }} placeholder="Type a name..." className="pl-9 rounded-xl" />
                  </div>

                  {searchQuery.length >= 2 && (
                    <div className="space-y-1.5">
                      {strongMatches.length > 0 ? (
                        <>
                          {strongMatches.map(char => (
                            <button key={char.id} onClick={() => handleSelectChar(char)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-left">
                              <CharacterAvatar character={char} size="sm" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{char.name}</p>
                                <p className="text-xs text-muted-foreground">{typeLabel(char.character_type)}</p>
                              </div>
                            </button>
                          ))}
                        </>
                      ) : weakMatches.length > 0 ? (
                        <>
                          <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            Possible matches found
                          </p>
                          {weakMatches.map(char => (
                            <button key={char.id} onClick={() => handleSelectChar(char)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors text-left opacity-75">
                              <CharacterAvatar character={char} size="sm" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{char.name}</p>
                                <p className="text-xs text-muted-foreground">{typeLabel(char.character_type)}</p>
                              </div>
                            </button>
                          ))}
                          <button onClick={() => handleProceedToCreate(searchQuery)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                            <Star className="w-3.5 h-3.5" />
                            Create new as "{searchQuery}"
                          </button>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground text-center py-2">No exact match for "{searchQuery}".</p>
                          <button onClick={() => handleProceedToCreate(searchQuery)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                            <Star className="w-3.5 h-3.5" />
                            Create new character "{searchQuery}"
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Edit existing character mode */}
              {selectedChar && !isCreatingNew && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Editing</p>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/60 border border-border">
                      <CharacterAvatar character={selectedChar} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{selectedChar.name}</p>
                        <p className="text-xs text-muted-foreground">Type: <span className="text-foreground font-medium">{typeLabel(selectedChar.character_type)}</span></p>
                      </div>
                      <button onClick={() => { setSelectedChar(null); setSelectedType(""); setLinkedCharId(""); setSaveResult(null); setSearchQuery(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Change</button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 2 — Select New Type</p>
                    {CHARACTER_TYPES.map(type => {
                      const Icon = type.icon;
                      const isSelected = selectedType === type.value;
                      return (
                        <button key={type.value} onClick={() => { setSelectedType(type.value); setLinkedCharId(""); setRelationshipType(""); setFamilyTitle(""); }} className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-colors text-left ${isSelected ? `${type.bg} ${type.border}` : "bg-secondary border-border hover:border-primary/30"}`}>
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${isSelected ? type.bg : "bg-card"}`}>
                            <Icon className={`w-4 h-4 ${isSelected ? type.color : "text-muted-foreground"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{type.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{type.desc}</p>
                          </div>
                          {isSelected && <Check className={`w-4 h-4 flex-shrink-0 mt-1 ${type.color}`} />}
                        </button>
                      );
                    })}
                  </div>

                  {selectedTypeDef && (selectedTypeDef.requiresLinkedChar || selectedTypeDef.requiresRelType || selectedTypeDef.requiresFamilyTitle) && (
                    <div className="space-y-3 pt-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Step 3 — Required Relationship Info</p>

                      {selectedTypeDef.requiresLinkedChar && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Link to Active Creative Character <span className="text-destructive">*</span></label>
                          {activeChars.length === 0 ? (
                            <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">No active creative characters found.</p>
                          ) : (
                            <select value={linkedCharId} onChange={e => setLinkedCharId(e.target.value)} className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none">
                              <option value="">— Select a character —</option>
                              {activeChars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                        </div>
                      )}

                      {selectedTypeDef.requiresRelType && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Relationship type <span className="text-destructive">*</span></label>
                          <select value={relationshipType} onChange={e => setRelationshipType(e.target.value)} className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none">
                            <option value="">— Select relationship —</option>
                            {NPC_REL_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      )}

                      {selectedTypeDef.requiresFamilyTitle && (
                        <div className="space-y-1.5">
                          <label className="text-xs text-muted-foreground">Family title <span className="text-destructive">*</span></label>
                          <select value={familyTitle} onChange={e => setFamilyTitle(e.target.value)} className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 border border-border focus:border-primary/50 outline-none">
                            <option value="">— Select title —</option>
                            {FAMILY_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedType && !canSave() && (
                    <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {selectedTypeDef?.requiresLinkedChar && !linkedCharId ? "A linked active character is required for this type." : selectedTypeDef?.requiresRelType && !relationshipType ? "A relationship type is required." : selectedTypeDef?.requiresFamilyTitle && !familyTitle ? "A family title is required." : "Fill in all required fields to save."}
                    </p>
                  )}

                  <Button onClick={handleSaveExisting} disabled={!canSave() || isSaving} className="w-full rounded-xl h-11">
                    {isSaving ? "Saving & updating lists..." : `Apply — Reclassify as ${selectedType ? typeLabel(selectedType) : "selected type"}`}
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