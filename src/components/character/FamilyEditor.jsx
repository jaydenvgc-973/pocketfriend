import React, { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Camera, Loader2, ZoomIn, Lock, Unlock, User } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import ImageLightbox from "@/components/ui/ImageLightbox";

/**
 * Calculate the current age of a family member.
 * age_at_creation: the age set when the member was added
 * created_date: ISO string of when the family member was added/saved
 * index: position in list — used to stagger each member's "birthday" by 1 month
 *
 * Each member ages up on their annual "birthday" which is:
 *   (created_date month + index months), same day each year
 */
export function calcFamilyMemberAge(member, characterCreatedDate, index = 0) {
  const ageAtCreation = member.age_at_creation;
  const savedDate = member.age_set_date || characterCreatedDate;
  if (ageAtCreation == null || !savedDate) return null;

  const base = new Date(savedDate);
  // Stagger: each member's birthday is (index) months after the base date
  const birthdayMonth = (base.getMonth() + index) % 12;
  const birthdayDay = base.getDate();
  // Determine if the year rolled over due to month addition
  const extraYears = Math.floor((base.getMonth() + index) / 12);

  const today = new Date();
  const thisYear = today.getFullYear();
  const baseYear = base.getFullYear() + extraYears;

  // Find the most recent birthday in the past
  let birthday = new Date(thisYear, birthdayMonth, birthdayDay);
  if (birthday > today) birthday.setFullYear(thisYear - 1);

  const yearsPassed = birthday.getFullYear() - baseYear;
  return ageAtCreation + yearsPassed;
}

const RELATIONSHIP_TYPES = [
  "mother", "father", "grandmother", "grandfather",
  "great-grandmother", "great-grandfather", "aunt", "uncle",
  "mother-in-law", "father-in-law", "sister-in-law", "brother-in-law",
  "sister", "brother", "half-sister", "half-brother",
  "step-mother", "step-father", "step-sister", "step-brother",
  "cousin", "niece", "nephew", "daughter", "son", "spouse",
  "significant other", "romantic interest", "other",
];

// Default relationship bars based on family role
function defaultLevels(relationshipType) {
  const close = ["mother", "father", "sister", "brother", "daughter", "son", "spouse"];
  const isClose = close.includes(relationshipType);
  return {
    user_respect_level: isClose ? 75 : 60,
    friendship_level: isClose ? 80 : 65,
    romantic_level: relationshipType === "spouse" ? 70 : 0,
    attraction_level: 0,
    chosen_family_level: isClose ? 85 : 50,
  };
}

// Sync family members into fictional_relationships so they appear in the world list
async function syncFamilyToRelationships(character, familyMembers) {
  const existing = character.fictional_relationships || [];

  // Remove old family-sourced entries, keep non-family ones
  const nonFamily = existing.filter(r => !r._from_family);

  // Build new entries from family members
  const familyEntries = familyMembers
    .filter(m => m.name?.trim())
    .map(m => ({
      person_name: m.name,
      relationship_type: m.relationship_type || "family",
      description: `${m.name} is ${character.name}'s ${m.relationship_type || "family member"}.`,
      current_status: "part of the family",
      emotional_impact: "",
      history_summary: "",
      last_interaction_summary: "",
      photo_url: m.photo_url || null,
      _from_family: true,
      ...defaultLevels(m.relationship_type),
    }));

  return [...nonFamily, ...familyEntries];
}

export default function FamilyEditor({ character, readOnly = false, allCharacters = [], currentUser = null, userSettings = null }) {
  const queryClient = useQueryClient();
  const [members, setMembers] = useState(character.family_members || []);
  const [saving, setSaving] = useState(false);
  const [generatingIdx, setGeneratingIdx] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  // Master lock: prevents ANY new additions to the family list
  const [masterLocked, setMasterLocked] = useState(character.family_list_locked || false);
  // Per-member locks: stored as a set of member names (lowercased)
  const [lockedMembers, setLockedMembers] = useState(new Set((character.family_locked_members || []).map(n => n.toLowerCase())));

  const saveLocks = async (newMasterLocked, newLockedMembersSet) => {
    await base44.entities.Character.update(character.id, {
      family_list_locked: newMasterLocked,
      family_locked_members: [...newLockedMembersSet],
    }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  const toggleMasterLock = () => {
    const next = !masterLocked;
    setMasterLocked(next);
    saveLocks(next, lockedMembers);
  };

  const toggleMemberLock = (memberName) => {
    const key = memberName?.toLowerCase();
    const next = new Set(lockedMembers);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setLockedMembers(next);
    saveLocks(masterLocked, next);
  };

  const isMemberLocked = (name) => lockedMembers.has(name?.toLowerCase());

  // Helper: get avatar URL for a family member if they're an active character
  const getFamilyMemberAvatar = (memberName) => {
    const activeChar = allCharacters.find(c =>
      c.name?.trim().toLowerCase() === memberName?.trim().toLowerCase()
    );
    return activeChar?.avatar_url || null;
  };

  // Keep local state in sync if the character prop changes (e.g. after re-fetch)
  useEffect(() => {
    if (!saving) {
      setMembers(character.family_members || []);
    }
  }, [character.id, JSON.stringify(character.family_members)]);

  const addMember = () => {
    if (masterLocked) return; // master lock blocks new additions
    setMembers(prev => [...prev, { name: "", relationship_type: "mother", photo_url: null, age_at_creation: null, age_set_date: null }]);
  };

  const updateMember = (idx, field, value) => {
    setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const removeMember = (idx) => {
    const member = members[idx];
    if (isMemberLocked(member?.name)) return; // individual lock blocks removal
    setMembers(prev => prev.filter((_, i) => i !== idx));
  };

  const generatePhoto = async (idx) => {
    const member = members[idx];
    if (!member.name?.trim()) return;
    setGeneratingIdx(idx);

    const isChild = ["daughter", "son"].includes(member.relationship_type);
    const currentAge = member.age_at_creation != null ? calcFamilyMemberAge(member, character.created_date, idx) : null;
    const isBaby = currentAge !== null && currentAge < 1;

    // Check if another active character already has a photo for this same child — reuse it
    if (isChild && allCharacters.length > 0) {
      for (const otherChar of allCharacters) {
        if (otherChar.id === character.id) continue;
        const match = (otherChar.family_members || []).find(
          fm => fm.name?.trim().toLowerCase() === member.name.trim().toLowerCase() &&
               ["daughter", "son"].includes(fm.relationship_type) &&
               fm.photo_url
        );
        if (match?.photo_url) {
          // Reuse existing photo from the other parent and store as reference
          const updatedMembers = members.map((m, i) => i === idx ? { ...m, photo_url: match.photo_url } : m);
          setMembers(updatedMembers);
          const valid = updatedMembers.filter(m => m.name?.trim());
          const updatedRelationships = await syncFamilyToRelationships(character, valid);
          const systemPrompt = buildSystemPrompt({ ...character, family_members: valid });
          let updateData = { family_members: valid, fictional_relationships: updatedRelationships };
          if (systemPrompt) {
            const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            updateData.system_prompt_url = file_url;
          }
          const existingRefs = character.reference_image_urls || [];
          updateData.reference_image_urls = existingRefs.includes(match.photo_url) ? existingRefs : [...existingRefs, match.photo_url];
          
          await base44.entities.Character.update(character.id, updateData);
          queryClient.invalidateQueries({ queryKey: ["character", character.id] });
          queryClient.invalidateQueries({ queryKey: ["characters"] });
          setGeneratingIdx(null);
          return;
        }
      }
    }

    // Collect parent reference images for face blending
    const parentRefs = [];
    if (character.avatar_url) parentRefs.push(character.avatar_url);
    (character.reference_image_urls || []).slice(0, 2).forEach(u => {
      if (!parentRefs.includes(u)) parentRefs.push(u);
    });
    // Also include the other parent's avatar if available
    if (isChild && allCharacters.length > 0) {
      for (const otherChar of allCharacters) {
        if (otherChar.id === character.id) continue;
        const hasChild = (otherChar.family_members || []).some(
          fm => fm.name?.trim().toLowerCase() === member.name.trim().toLowerCase() &&
               ["daughter", "son"].includes(fm.relationship_type)
        );
        if (hasChild && otherChar.avatar_url && !parentRefs.includes(otherChar.avatar_url)) {
          parentRefs.push(otherChar.avatar_url);
          break;
        }
      }
    }

    try {
      const isParent = ["mother", "father"].includes(member.relationship_type);
      const isSibling = ["sister", "brother", "half-sister", "half-brother"].includes(member.relationship_type);
      
      const isSlowAgingEthnicity = character.ethnicities?.some(e => {
        const eth = e.toLowerCase();
        return eth.includes("african american") ||
               eth.includes("black") ||
               eth.includes("afro-caribbean") ||
               eth.includes("african") ||
               eth.includes("latino") ||
               eth.includes("latina") ||
               eth.includes("hispanic") ||
               eth.includes("asian") ||
               eth.includes("east asian") ||
               eth.includes("south asian") ||
               eth.includes("southeast asian");
      });

      let ageNote = "";
      if (isSlowAgingEthnicity && currentAge) {
        if (currentAge <= 20) {
          ageNote = `Note: This person is ${currentAge} years old and looks approximately their age.`;
        } else if (currentAge <= 35) {
          ageNote = `Note: This person is ${currentAge} years old but may appear to be in their early 20s.`;
        } else if (currentAge <= 45) {
          ageNote = `Note: This person is ${currentAge} years old but may appear to be in their mid-20s to early 30s.`;
        } else {
          ageNote = `Note: This person is ${currentAge} years old but may appear to be in their 30s or early 40s.`;
        }
      }

      let prompt;
      if (isBaby) {
        prompt = `A realistic, candid photo of ${member.name}, a newborn baby (under 1 year old), who is ${character.name}'s ${member.relationship_type}.
${character.ethnicities?.length > 0 ? `Ethnic background: ${character.ethnicities.join(", ")}.` : ""}
Adorable infant, soft natural lighting, like a real family photo. NOT a cartoon, NOT illustrated. Photorealistic. Baby features — round face, chubby cheeks. Show family resemblance to the parents.`;
      } else {
        let resemblanceNote = "";
        if (isChild) resemblanceNote = `This person is ${character.name}'s ${member.relationship_type}. Blend facial features to show clear family resemblance with the parent.`;
        else if (isParent) resemblanceNote = `This person is ${character.name}'s ${member.relationship_type}. They should look like they could be the parent — similar bone structure, eyes, coloring.`;
        else if (isSibling) resemblanceNote = `This person is ${character.name}'s ${member.relationship_type}. They should look clearly related — similar features, coloring, and bone structure.`;

        prompt = `A realistic, candid-style portrait photo of ${member.name}, who is ${character.name}'s ${member.relationship_type || "family member"}.
${character.ethnicities?.length > 0 ? `Ethnic background: ${character.ethnicities.join(", ")}.` : ""}
${resemblanceNote}
Natural lighting, unposed, like a real person's photo. NOT a cartoon, NOT illustrated. Photorealistic. ${ageNote}`;
      }

      const result = await base44.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: parentRefs.length > 0 ? parentRefs : undefined,
      });
      if (result?.url) {
        const updatedMembers = members.map((m, i) => i === idx ? { ...m, photo_url: result.url } : m);
        setMembers(updatedMembers);

        // Auto-save to this character
        const valid = updatedMembers.filter(m => m.name?.trim());
        const updatedRelationships = await syncFamilyToRelationships(character, valid);
        const systemPrompt = buildSystemPrompt({ ...character, family_members: valid });
        let updateData = { family_members: valid, fictional_relationships: updatedRelationships };
        if (systemPrompt) {
          const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          updateData.system_prompt_url = file_url;
        }
        await base44.entities.Character.update(character.id, updateData);

        // Store family member photo as reference image for other characters who share this child
        if (isChild && allCharacters.length > 0) {
          for (const otherChar of allCharacters) {
            if (otherChar.id === character.id) continue;
            const otherIdx = (otherChar.family_members || []).findIndex(
              fm => fm.name?.trim().toLowerCase() === members[idx].name.trim().toLowerCase() &&
                   ["daughter", "son"].includes(fm.relationship_type)
            );
            if (otherIdx !== -1) {
              const existingRefs = otherChar.reference_image_urls || [];
              const updatedRefs = existingRefs.includes(result.url) ? existingRefs : [...existingRefs, result.url];
              await base44.entities.Character.update(otherChar.id, { reference_image_urls: updatedRefs });
            }
          }
        }

        // Propagate to other active characters who share this child
        if (isChild && allCharacters.length > 0) {
          for (const otherChar of allCharacters) {
            if (otherChar.id === character.id) continue;
            const otherIdx = (otherChar.family_members || []).findIndex(
              fm => fm.name?.trim().toLowerCase() === member.name.trim().toLowerCase() &&
                   ["daughter", "son"].includes(fm.relationship_type)
            );
            if (otherIdx !== -1) {
              const otherUpdated = otherChar.family_members.map((fm, i) =>
                i === otherIdx ? { ...fm, photo_url: result.url } : fm
              );
              const otherRelationships = await syncFamilyToRelationships(otherChar, otherUpdated.filter(m => m.name?.trim()));
              await base44.entities.Character.update(otherChar.id, {
                family_members: otherUpdated,
                fictional_relationships: otherRelationships,
              });
            }
          }
        }

        queryClient.invalidateQueries({ queryKey: ["character", character.id] });
        queryClient.invalidateQueries({ queryKey: ["characters"] });
      }
    } catch {
      // silently fail
    }
    setGeneratingIdx(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Preserve _is_user entries; only validate/save non-user members
      const userEntry = members.find(m => m._is_user);
      const valid = members.filter(m => m.name?.trim() && !m._is_user);
      if (userEntry) valid.push(userEntry); // keep user entry intact
      const updatedRelationships = await syncFamilyToRelationships(character, valid);
      const updated = { ...character, family_members: valid };
      const systemPrompt = buildSystemPrompt(updated);

      // Upload system prompt as a file if it's too large
      let updateData = {
        family_members: valid,
        fictional_relationships: updatedRelationships,
      };

      if (systemPrompt) {
        const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        updateData.system_prompt_url = file_url;
      }
      await base44.entities.Character.update(character.id, updateData);
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    } finally {
      setSaving(false);
    }
  };

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef(null);

  // Close add menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) { setShowAddMenu(false); setShowCharacterPicker(false); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [showCharacterPicker, setShowCharacterPicker] = useState(false);
  const alreadyAddedSelf = members.some(m => m._is_user);

  // Characters available to add: active characters, NPC fictitious people, and family NPCs (all status=active)
  const ALLOWED_TYPES = new Set(['active', 'npc', 'family_npc']);
  const typeOrder = (t) => t === 'active' ? 0 : t === 'npc' ? 1 : t === 'family_npc' ? 2 : 3;
  const availableCharacters = allCharacters
    .filter(c =>
      c.status === 'active' &&
      ALLOWED_TYPES.has(c.character_type) &&
      c.id !== character.id &&
      !members.some(m => m.name?.trim().toLowerCase() === c.name?.trim().toLowerCase())
    )
    .sort((a, b) => typeOrder(a.character_type) - typeOrder(b.character_type));

  // Also collect embedded family members from other active characters' family_members arrays
  // (people who exist only as entries, not as full Character entities)
  const characterEntityNames = new Set(allCharacters.map(c => c.name?.trim().toLowerCase()));
  const embeddedFamilyNpcs = [];
  const seenEmbedded = new Set();
  allCharacters
    .filter(c => c.status === 'active' && c.id !== character.id)
    .forEach(c => {
      (c.family_members || []).forEach(fm => {
        if (!fm.name?.trim()) return;
        const key = fm.name.trim().toLowerCase();
        // Skip if already a Character entity, already in the member list, or already seen
        if (characterEntityNames.has(key)) return;
        if (members.some(m => m.name?.trim().toLowerCase() === key)) return;
        if (seenEmbedded.has(key)) return;
        seenEmbedded.add(key);
        embeddedFamilyNpcs.push(fm);
      });
    });

  const addCharacterAsMember = (char) => {
    setShowCharacterPicker(false);
    setShowAddMenu(false);
    setMembers(prev => [...prev, {
      name: char.name,
      relationship_type: "other",
      photo_url: char.avatar_url || null,
      age_at_creation: char.age ?? null,
      age_set_date: new Date().toISOString(),
      _linked_character_id: char.id,
    }]);
  };

  const addSelf = () => {
    if (masterLocked || alreadyAddedSelf) return;
    setShowAddMenu(false);
    // Pull age from user birthday
    const birthday = userSettings?.user_birthday;
    let age = null;
    if (birthday) {
      const today = new Date();
      const bd = new Date(birthday);
      age = today.getFullYear() - bd.getFullYear();
      if (today < new Date(today.getFullYear(), bd.getMonth(), bd.getDate())) age--;
    }
    const userAvatar = currentUser?.selected_avatar_url
      || currentUser?.user_avatar_url
      || currentUser?.generated_avatar_urls?.[0]
      || currentUser?.reference_image_urls?.[0]
      || null;
    const worldName = userSettings?.fictional_world_name || currentUser?.full_name || "Me";
    setMembers(prev => [...prev, {
      name: worldName,
      relationship_type: "other",
      photo_url: userAvatar,
      age_at_creation: age,
      age_set_date: new Date().toISOString(),
      _is_user: true,
    }]);
  };

  const nonUserMembers = members.filter(m => !m._is_user);
  const originalNonUser = (character.family_members || []).filter(m => !m._is_user);
  const hasChanges = JSON.stringify(nonUserMembers) !== JSON.stringify(originalNonUser);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <ImageLightbox src={lightboxSrc} alt="Family member" onClose={() => setLightboxSrc(null)} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Family</p>
          {/* Master lock — blocks all new additions */}
          {!readOnly && (
            <button
              onClick={toggleMasterLock}
              title={masterLocked ? "Family list locked — click to allow additions" : "Click to lock family list (no new additions)"}
              className={`p-1 rounded-lg transition-colors ${masterLocked ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground hover:text-foreground"}`}
            >
              {masterLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        {!readOnly && !masterLocked && (
          <div className="relative" ref={addMenuRef}>
            <button
              onClick={() => setShowAddMenu(v => !v)}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
            {showAddMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                <button
                  onClick={() => { addMember(); setShowAddMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-foreground hover:bg-secondary transition-colors text-left"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                  Add family member
                </button>
                {(availableCharacters.length > 0 || embeddedFamilyNpcs.length > 0) && (
                  <button
                    onClick={() => { setShowCharacterPicker(v => !v); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-foreground hover:bg-secondary transition-colors text-left border-t border-border"
                  >
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    Add a character
                  </button>
                )}
                {showCharacterPicker && (
                  <div className="border-t border-border max-h-56 overflow-y-auto">
                    {/* Active characters */}
                    {availableCharacters.filter(c => c.character_type === 'active').length > 0 && (
                      <>
                        <p className="px-3 pt-2 pb-1 text-[9px] font-semibold text-primary/70 uppercase tracking-wider">Active Characters</p>
                        {availableCharacters.filter(c => c.character_type === 'active').map(char => (
                          <button key={char.id} onClick={() => addCharacterAsMember(char)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors text-left">
                            {char.avatar_url
                              ? <img src={char.avatar_url} alt={char.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                              : <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{char.name?.[0]}</span></div>
                            }
                            <span className="truncate">{char.name}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {/* NPC fictitious people */}
                    {availableCharacters.filter(c => c.character_type === 'npc').length > 0 && (
                      <>
                        <p className="px-3 pt-2 pb-1 text-[9px] font-semibold text-amber-400/70 uppercase tracking-wider">NPC Fictitious People</p>
                        {availableCharacters.filter(c => c.character_type === 'npc').map(char => (
                          <button key={char.id} onClick={() => addCharacterAsMember(char)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors text-left">
                            {char.avatar_url
                              ? <img src={char.avatar_url} alt={char.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                              : <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-amber-400">{char.name?.[0]}</span></div>
                            }
                            <span className="truncate">{char.name}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {/* Family NPC characters (Character entities with character_type=family_npc) */}
                    {availableCharacters.filter(c => c.character_type === 'family_npc').length > 0 && (
                      <>
                        <p className="px-3 pt-2 pb-1 text-[9px] font-semibold text-blue-400/70 uppercase tracking-wider">Family NPCs</p>
                        {availableCharacters.filter(c => c.character_type === 'family_npc').map(char => (
                          <button key={char.id} onClick={() => addCharacterAsMember(char)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors text-left">
                            {char.avatar_url
                              ? <img src={char.avatar_url} alt={char.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                              : <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-blue-400">{char.name?.[0]}</span></div>
                            }
                            <span className="truncate">{char.name}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {/* Embedded family members from other characters' family lists */}
                    {embeddedFamilyNpcs.length > 0 && (
                      <>
                        <p className="px-3 pt-2 pb-1 text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Family Members on File</p>
                        {embeddedFamilyNpcs.map((fm, i) => (
                          <button key={`embedded-${i}`} onClick={() => { addCharacterAsMember({ name: fm.name, avatar_url: fm.photo_url || null, id: `embedded_${fm.name}`, age: fm.age_at_creation ?? null }); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors text-left">
                            {fm.photo_url
                              ? <img src={fm.photo_url} alt={fm.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                              : <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-muted-foreground">{fm.name?.[0]}</span></div>
                            }
                            <span className="truncate">{fm.name}</span>
                            {fm.relationship_type && <span className="text-muted-foreground/60 capitalize flex-shrink-0">{fm.relationship_type}</span>}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
                {!alreadyAddedSelf && (
                  <button
                    onClick={addSelf}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-pink-400 hover:bg-secondary transition-colors text-left border-t border-border"
                  >
                    <User className="w-3.5 h-3.5" />
                    Add yourself
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {!readOnly && masterLocked && (
          <span className="text-[10px] text-amber-400/80 font-medium">List locked</span>
        )}
      </div>

      {members.filter(m => !m._is_user).length === 0 && !members.some(m => m._is_user) && (
        <p className="text-xs text-muted-foreground italic">No family members added yet.</p>
      )}

      <div className="space-y-3">
        {members.map((member, idx) => (
          <div key={idx} className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
            {/* User entry — read-only, managed from My Profile */}
            {member._is_user ? (
              <div className="flex items-center gap-3">
                {(() => {
                  const liveAvatar = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;
                  const displayUrl = member.photo_url || liveAvatar;
                  return displayUrl ? (
                    <button onClick={() => setLightboxSrc(displayUrl)} className="relative flex-shrink-0 group">
                      <img src={displayUrl} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
                      <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ZoomIn className="w-3 h-3 text-white" />
                      </div>
                    </button>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-primary">{member.name?.[0]?.toUpperCase() || "?"}</span>
                    </div>
                  );
                })()}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium">{member.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const bd = userSettings?.user_birthday;
                      if (bd) {
                        const today = new Date();
                        const d = new Date(bd);
                        let age = today.getFullYear() - d.getFullYear();
                        if (today < new Date(today.getFullYear(), d.getMonth(), d.getDate())) age--;
                        return `${age} yrs`;
                      }
                      return member.age_at_creation != null ? `${calcFamilyMemberAge(member, member.age_set_date, 0)} yrs` : "";
                    })()}
                  </p>
                </div>
                {!readOnly && (
                  <select
                    value={member.relationship_type}
                    onChange={e => updateMember(idx, "relationship_type", e.target.value)}
                    className="bg-secondary text-foreground text-xs rounded-xl px-2 py-1.5 outline-none border border-transparent focus:border-primary/50 capitalize"
                  >
                    {RELATIONSHIP_TYPES.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                )}
                {readOnly && (
                  <span className="text-xs text-muted-foreground capitalize">{member.relationship_type}</span>
                )}
                <span className="text-[10px] text-pink-400 border border-pink-400/30 rounded px-1.5 py-0.5 flex-shrink-0">You</span>
              </div>
            ) : readOnly ? (
              /* Read-only view with photo */
              <div className="flex items-center gap-3">
                {(() => {
                  const activeChar = allCharacters.find(c =>
                    c.name?.trim().toLowerCase() === member.name?.trim().toLowerCase()
                  );
                  const displayUrl = activeChar?.avatar_url || member.photo_url;
                  const isActiveChar = !!activeChar;
                  return displayUrl ? (
                    <button onClick={() => setLightboxSrc(displayUrl)} className="relative flex-shrink-0 group">
                      <img src={displayUrl} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
                      {isActiveChar && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border border-card" title="Active character" />}
                      <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ZoomIn className="w-4 h-4 text-white" />
                      </div>
                    </button>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-primary">{member.name?.[0]?.toUpperCase() || "?"}</span>
                    </div>
                  );
                })()}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium">{member.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {member.relationship_type}
                    {(() => {
                      const activeChar = allCharacters.find(c =>
                        c.name?.trim().toLowerCase() === member.name?.trim().toLowerCase()
                      );
                      if (activeChar?.birthday) {
                        const age = new Date().getFullYear() - new Date(activeChar.birthday).getFullYear();
                        return ` · ${age} yrs`;
                      }
                      const age = calcFamilyMemberAge(member, character.created_date, idx);
                      return age != null ? ` · ${age} yrs` : "";
                    })()}
                  </p>
                </div>
              </div>
            ) : (
              /* Edit view */
              <>
                <div className="flex items-center gap-2">
                  {/* Photo thumbnail + generate button */}
                  <div className="relative flex-shrink-0">
                    {(() => {
                      const activeCharAvatar = getFamilyMemberAvatar(member.name);
                      const displayUrl = activeCharAvatar || member.photo_url;
                      const isActiveChar = !!activeCharAvatar;
                      return displayUrl ? (
                        <button onClick={() => setLightboxSrc(displayUrl)} className="block group">
                          <img src={displayUrl} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
                          {isActiveChar && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border border-card" title="Active character" />}
                          <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ZoomIn className="w-3 h-3 text-white" />
                          </div>
                        </button>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                          <span className="text-sm font-semibold text-primary">{member.name?.[0]?.toUpperCase() || "?"}</span>
                        </div>
                      );
                    })()}
                    {!getFamilyMemberAvatar(member.name) && (
                      <button
                        onClick={() => generatePhoto(idx)}
                        disabled={generatingIdx === idx || !member.name?.trim()}
                        title="Generate photo"
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 hover:bg-primary/80 transition-colors"
                      >
                        {generatingIdx === idx
                          ? <Loader2 className="w-3 h-3 text-primary-foreground animate-spin" />
                          : <Camera className="w-2.5 h-2.5 text-primary-foreground" />
                        }
                      </button>
                    )}
                  </div>

                  <input
                    type="text"
                    value={member.name}
                    onChange={e => updateMember(idx, "name", e.target.value)}
                    placeholder="Name"
                    className="flex-1 bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground min-w-0"
                  />
                  <select
                    value={member.relationship_type}
                    onChange={e => updateMember(idx, "relationship_type", e.target.value)}
                    className="bg-secondary text-foreground text-sm rounded-xl px-2 py-2 outline-none border border-transparent focus:border-primary/50 capitalize"
                  >
                    {RELATIONSHIP_TYPES.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  {/* Individual member lock */}
                  <button
                    onClick={() => toggleMemberLock(member.name)}
                    title={isMemberLocked(member.name) ? "Locked — click to unlock this family member" : "Lock this family member in place"}
                    className={`flex-shrink-0 transition-colors ${isMemberLocked(member.name) ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {isMemberLocked(member.name) ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => removeMember(idx)}
                    disabled={isMemberLocked(member.name)}
                    className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {/* Age input */}
                <div className="flex items-center gap-2 mt-1">
                  <label className="text-xs text-muted-foreground w-8 flex-shrink-0">Age</label>
                  {(() => {
                    const activeChar = allCharacters.find(c =>
                      c.name?.trim().toLowerCase() === member.name?.trim().toLowerCase()
                    );
                    if (activeChar?.birthday) {
                      const age = new Date().getFullYear() - new Date(activeChar.birthday).getFullYear();
                      return (
                        <span className="text-xs text-muted-foreground">
                          <span className="text-foreground font-medium">{age} yrs</span> (from active character)
                        </span>
                      );
                    }
                    return (
                      <>
                        <input
                          type="number"
                          min="0"
                          max="120"
                          value={member.age_at_creation ?? ""}
                          onChange={e => {
                            const val = e.target.value === "" ? null : parseInt(e.target.value, 10);
                            setMembers(prev => prev.map((m, i) => i === idx ? { ...m, age_at_creation: val, age_set_date: new Date().toISOString() } : m));
                          }}
                          placeholder="Age"
                          className="w-20 bg-secondary text-foreground text-sm rounded-xl px-3 py-1.5 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground"
                        />
                        {member.age_at_creation != null && (
                          <span className="text-xs text-muted-foreground">
                            → currently{" "}
                            <span className="text-foreground font-medium">
                              {calcFamilyMemberAge(member, character.created_date, idx)} yrs
                            </span>
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                {generatingIdx === idx && (
                  <p className="text-xs text-muted-foreground">Generating photo for {member.name}...</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {!readOnly && hasChanges && (
        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-primary text-primary-foreground text-sm font-medium rounded-xl py-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Family"}
        </button>
      )}
    </div>
  );
}