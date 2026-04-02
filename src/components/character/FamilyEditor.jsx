import React, { useState, useEffect } from "react";
import { Plus, Trash2, Camera, Loader2, ZoomIn } from "lucide-react";
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
  "sister", "brother", "half-sister", "half-brother",
  "step-mother", "step-father", "step-sister", "step-brother",
  "cousin", "niece", "nephew", "daughter", "son", "spouse", "other",
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

export default function FamilyEditor({ character, readOnly = false, allCharacters = [] }) {
  const queryClient = useQueryClient();
  const [members, setMembers] = useState(character.family_members || []);
  const [saving, setSaving] = useState(false);
  const [generatingIdx, setGeneratingIdx] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);

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
    setMembers(prev => [...prev, { name: "", relationship_type: "mother", photo_url: null, age_at_creation: null, age_set_date: null }]);
  };

  const updateMember = (idx, field, value) => {
    setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const removeMember = (idx) => {
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
          if (systemPrompt && systemPrompt.length > 5000) {
            const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            updateData.system_prompt_url = file_url;
          } else {
            updateData.system_prompt = systemPrompt;
          }
          
          // Store photo as reference image
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
        if (systemPrompt && systemPrompt.length > 5000) {
          const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          updateData.system_prompt_url = file_url;
        } else {
          updateData.system_prompt = systemPrompt;
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
      const valid = members.filter(m => m.name?.trim());
      const updatedRelationships = await syncFamilyToRelationships(character, valid);
      const updated = { ...character, family_members: valid };
      const systemPrompt = buildSystemPrompt(updated);

      // Upload system prompt as a file if it's too large
      let updateData = {
        family_members: valid,
        fictional_relationships: updatedRelationships,
      };

      if (systemPrompt && systemPrompt.length > 5000) {
        const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        updateData.system_prompt_url = file_url;
      } else {
        updateData.system_prompt = systemPrompt;
      }

      await base44.entities.Character.update(character.id, updateData);
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(members) !== JSON.stringify(character.family_members || []);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <ImageLightbox src={lightboxSrc} alt="Family member" onClose={() => setLightboxSrc(null)} />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Family</p>
        {!readOnly && (
          <button
            onClick={addMember}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        )}
      </div>

      {members.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No family members added yet.</p>
      )}

      <div className="space-y-3">
        {members.map((member, idx) => (
          <div key={idx} className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
            {readOnly ? (
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
                  <button
                    onClick={() => removeMember(idx)}
                    className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
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