import React, { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Camera, Loader2, ZoomIn, Lock, Unlock, User } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { resolveCanonicalPerson } from "@/lib/canonicalPersonResolver";
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
  "engaged", "significant other", "romantic interest", "other",
];

// Generate a stable unique ID for a family member (lightweight, no external dep)
function generateMemberId() {
  return `fm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Ensure every member object has a stable _member_id
// This is the ONLY identity anchor — never use array index or name for identity
function withStableIds(members) {
  return members.map(m => m._member_id ? m : { ...m, _member_id: generateMemberId() });
}

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
// Uses shared resolveOrCreateFamilyMemberCharacter to ensure consistent resolution:
// - No duplicates across parents
// - Shared children (like Leo Parker) remain one record
// - Every family member has stable _linked_character_id anchor
async function syncFamilyToRelationships(character, familyMembers, currentUser) {
  const existing = character.fictional_relationships || [];

  // Remove old family-sourced entries, keep non-family ones
  const nonFamily = existing.filter(r => !r._from_family);

  // Index non-family entries by related_character_id for merge lookups
  // MERGE RULE: if a non-family entry already exists for the same person,
  // the new family entry must absorb its last_interaction_summary and
  // replace the organic entry rather than appending alongside it.
  // This prevents two visible entries for the same Vick (or any family member
  // who also has an organic WP/chat relationship entry).
  const nonFamilyById = new Map(
    nonFamily
      .filter(r => r.related_character_id)
      .map(r => [r.related_character_id, r])
  );

  // Build new entries from family members — ensuring real Character records exist
  const familyEntries = await Promise.all(
    familyMembers
      .filter(m => m.name?.trim())
      .map(async (m) => {
        // ── USER-PARTICIPANT GATE ──────────────────────────────────────────────
        // Entries with _is_user:true represent the authenticated user.
        // They are stored as participant_type:"user" + user_id — never resolved to a Character.
        if (m._is_user === true || m.participant_type === 'user') {
          const existingOrganic = null; // user entries never have organic character cross-refs
          return {
            person_name: m.name,
            related_character_id: null,
            participant_type: 'user',
            user_id: m.user_id || currentUser?.id || null,
            relationship_type: m.relationship_type || 'family',
            description: `${m.name} is ${character.name}'s ${m.relationship_type || 'family member'} — authenticated user.`,
            current_status: 'part of the family',
            emotional_impact: '',
            history_summary: '',
            last_interaction_summary: '',
            photo_url: m.photo_url || null,
            avatar_url: m.photo_url || null,
            _from_family: true,
            _is_user: true,
            ...defaultLevels(m.relationship_type),
          };
        }

        // Every family member MUST have a stable _linked_character_id
        // This is the ONLY identity anchor — not index, not name matching
        let linkedCharId = m._linked_character_id || null;

        // If not yet linked, use the canonical resolver in create_if_confident mode.
        // This is an explicit user-triggered save — creation is permitted here.
        if (!linkedCharId && currentUser?.email && currentUser?.id) {
          try {
            // Fetch live chars fresh for accurate resolution
            const liveChars = await base44.entities.Character.filter(
              { owner_email: currentUser.email }, '-created_date', 200
            ).catch(() => []);
            const resolved = await resolveCanonicalPerson({
              owner_email: currentUser.email,
              name: m.name.trim(),
              linked_character_id: null,
              avatar_url: m.photo_url || null,
              source_type: 'family_member',
              source_character_id: character.id,
              relationship_context: m.relationship_type || null,
              mode: 'create_from_explicit_user_action',
              all_live_characters: liveChars,
              all_fictional_rels: liveChars.flatMap(c => c.fictional_relationships || []),
              base44,
              owner_user_id: currentUser.id,
              user_role: currentUser.role || 'user',
            });
            if (resolved.canonical_person_id) {
              linkedCharId = resolved.canonical_person_id;
            } else {
              console.warn('[FamilyEditor] Could not resolve or create Character for family member:', m.name, resolved.failure_reason);
            }
          } catch (err) {
            console.warn('[FamilyEditor] Resolver error for family member:', m.name, err.message);
          }
        }

        // Sync avatar_url, age, gender, and age_range to the linked Character record
        if (linkedCharId) {
          try {
            const FEMALE_ROLES = new Set(['mother', 'mom', 'grandmother', 'grandma', 'great-grandmother',
              'aunt', 'niece', 'sister', 'half-sister', 'step-mother', 'stepmother', 'stepsister', 'step-sister',
              'daughter', 'mother-in-law', 'sister-in-law']);
            const MALE_ROLES = new Set(['father', 'dad', 'grandfather', 'grandpa', 'great-grandfather',
              'uncle', 'nephew', 'brother', 'half-brother', 'step-father', 'stepfather', 'stepbrother', 'step-brother',
              'son', 'father-in-law', 'brother-in-law']);
            const inferGender = (rel) => {
              const r = (rel || '').toLowerCase();
              if (FEMALE_ROLES.has(r)) return 'female';
              if (MALE_ROLES.has(r)) return 'male';
              return null;
            };
            const inferAgeRange = (age) => {
              if (age == null) return null;
              if (age <= 3) return 'toddler';
              if (age <= 12) return 'child';
              if (age <= 17) return 'teenager';
              if (age <= 25) return 'young adult';
              if (age <= 40) return 'adult';
              if (age <= 60) return 'middle aged';
              return 'senior';
            };
            const currentAge = m.age_at_creation != null ? calcFamilyMemberAge(m, character.created_date, 0) : null;
            const syncUpdates = {};
            if (m.photo_url) syncUpdates.avatar_url = m.photo_url;
            if (currentAge != null) syncUpdates.age = currentAge;
            const gender = inferGender(m.relationship_type);
            if (gender) syncUpdates.gender = gender;
            const ageRange = inferAgeRange(currentAge);
            if (ageRange) syncUpdates.age_range = ageRange;
            if (Object.keys(syncUpdates).length > 0) {
              await base44.entities.Character.update(linkedCharId, syncUpdates);
            }
          } catch (err) {
            console.warn('[FamilyEditor] Failed to sync profile to Character:', err.message);
          }
        }

        // Merge: if an organic (non-family) entry already exists for this same character ID,
        // carry its last_interaction_summary into the new family entry so interaction
        // history is never lost. The family entry's relationship_type and bars win.
        const existingOrganic = linkedCharId ? nonFamilyById.get(linkedCharId) : null;
        return {
          person_name: m.name,
          related_character_id: linkedCharId || null,
          relationship_type: m.relationship_type || "family",
          description: `${m.name} is ${character.name}'s ${m.relationship_type || "family member"}.`,
          current_status: "part of the family",
          emotional_impact: "",
          history_summary: "",
          // Preserve last_interaction_summary from organic entry if present
          last_interaction_summary: existingOrganic?.last_interaction_summary || "",
          photo_url: m.photo_url || null,
          avatar_url: m.photo_url || null,
          _from_family: true,
          ...defaultLevels(m.relationship_type),
        };
      })
  );

  // Remove any non-family entries that are now covered by a family entry
  // (same related_character_id) — prevents duplicate rows in fictional_relationships.
  const familyCharIds = new Set(
    familyEntries.map(e => e.related_character_id).filter(Boolean)
  );
  const deduplicatedNonFamily = nonFamily.filter(r =>
    !r.related_character_id || !familyCharIds.has(r.related_character_id)
  );
  return [...deduplicatedNonFamily, ...familyEntries];
}

export default function FamilyEditor({ character, readOnly = false, allCharacters = [], currentUser = null, userSettings = null }) {
  // currentUser is passed from parent (CharacterProfile) and used for Character record creation
  const queryClient = useQueryClient();
  const [members, setMembers] = useState(() => withStableIds(character.family_members || []));
  const [saving, setSaving] = useState(false);
  // Track generation by stable _member_id, not by array index
  const [generatingMemberId, setGeneratingMemberId] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  // Master lock: prevents ANY new additions to the family list
  const [masterLocked, setMasterLocked] = useState(character.family_list_locked || false);
  // Per-member locks: stored as a set of member names (lowercased)
  const [lockedMembers, setLockedMembers] = useState(new Set((character.family_locked_members || []).map(n => n.toLowerCase())));

  const saveLocks = async (newMasterLocked, newLockedMembersSet) => {
    const lockData = {
      family_list_locked: newMasterLocked,
      family_locked_members: [...newLockedMembersSet],
    };
    await base44.entities.Character.update(character.id, lockData).catch(() => {});
    // Surgical patch — no re-fetch needed for a lock toggle
    queryClient.setQueryData(["character", character.id], (prev) => prev ? { ...prev, ...lockData } : prev);
    queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map(c => c.id === character.id ? { ...c, ...lockData } : c);
    });
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
  // CRITICAL: preserve _member_id from existing state — do not overwrite stable IDs
  useEffect(() => {
    if (!saving) {
      setMembers(prev => {
        const incoming = character.family_members || [];
        // Re-use existing stable IDs where name+relationship matches, assign new ones otherwise
        return incoming.map(m => {
          if (m._member_id) return m;
          const existing = prev.find(p => p.name === m.name && p.relationship_type === m.relationship_type);
          return existing ? { ...m, _member_id: existing._member_id } : { ...m, _member_id: generateMemberId() };
        });
      });
    }
  }, [character.id, JSON.stringify(character.family_members)]);

  const addMember = () => {
    if (masterLocked) return; // master lock blocks new additions
    setMembers(prev => [...prev, { _member_id: generateMemberId(), name: "", relationship_type: "mother", photo_url: null, age_at_creation: null, age_set_date: null }]);
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
    const memberId = member._member_id;
    setGeneratingMemberId(memberId);

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
          const updatedMembers2 = members.map((m, i) => i === idx ? { ...m, photo_url: match.photo_url } : m);
          setMembers(updatedMembers2);
          const valid2 = updatedMembers2.filter(m => m.name?.trim());
          const updatedRelationships2 = await syncFamilyToRelationships(character, valid2, currentUser);
          const systemPrompt2 = buildSystemPrompt({ ...character, family_members: valid2 });
          let updateData2 = { family_members: valid2, fictional_relationships: updatedRelationships2 };
          if (systemPrompt2) {
            const file = new File([systemPrompt2], "system_prompt.txt", { type: "text/plain" });
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            updateData2.system_prompt_url = file_url;
          }
          const existingRefs = character.reference_image_urls || [];
          updateData2.reference_image_urls = existingRefs.includes(match.photo_url) ? existingRefs : [...existingRefs, match.photo_url];

          await base44.entities.Character.update(character.id, updateData2);
          queryClient.invalidateQueries({ queryKey: ["character", character.id] });
          // Surgical patch — avoid unscoped ["characters"] invalidation which hits all users
          queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(c => c.id === character.id ? { ...c, family_members: valid2, fictional_relationships: updatedRelationships2 } : c);
          });
          setGeneratingMemberId(null);
          return;
        }
      }
    }

    // GLOBAL CONTRACT: Parent face references ONLY for children (both parents)
    // For all siblings, parents, relatives: NO parent face images — text-only context
    const parentRefs = [];
    if (isChild) {
      if (character.avatar_url) parentRefs.push(character.avatar_url);
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

      const ageStr = currentAge != null ? `, age ${currentAge}` : "";
      const ethnicityStr = character.ethnicities?.length > 0 ? `Ethnic background: ${character.ethnicities.join(", ")}.` : "";

      // GLOBAL PROMPT RULE: Family member is distinct individual. Parent is genetic/family reference only.
      // Mandate: distinct facial structure, never clone parent's face.
      let prompt;
      if (isBaby) {
        prompt = `Generate an avatar for ${member.name}, a newborn baby (under 1 year old), who is ${character.name}'s ${member.relationship_type}. ${ethnicityStr} Adorable infant, soft natural lighting, like a real family photo. NOT a cartoon, NOT illustrated. Photorealistic. Baby features — round face, chubby cheeks. This is a distinct individual with their own identity, not a duplicate.`;
      } else {
        let resemblanceRule = "";
        if (isChild) {
          resemblanceRule = `Generate ${member.name}${ageStr}, a distinct individual with their own identity, face shape, and facial features. Maintain believable family resemblance to ${character.name} only through ethnicity/genetic context—NOT by duplicating facial features. Allow distinct variations: different nose structure, different jaw line, different eye shape, different hairstyle.`;
        } else if (isParent) {
          resemblanceRule = `Generate ${member.name}${ageStr}, ${character.name}'s ${member.relationship_type}. This is a completely separate individual with their own facial identity. Do not duplicate ${character.name}'s face, jaw, nose, eyes, or expression. Use ethnicity only as genetic context. Distinct facial structure, different age markers.`;
        } else if (isSibling) {
          resemblanceRule = `Generate ${member.name}${ageStr}, ${character.name}'s ${member.relationship_type}. This is a separate person with distinct facial structure, different nose/jaw/eye shape, different hairstyle/facial hair pattern, different expression. Same-gender relatives must NOT become clones. Maintain family resemblance through ethnicity and age proximity only.`;
        } else {
          resemblanceRule = `Generate ${member.name}${ageStr}, ${character.name}'s ${member.relationship_type}. Distinct individual with own facial identity. Use ethnicity as genetic reference only. Do not duplicate ${character.name}'s face.`;
        }

        prompt = `${resemblanceRule} Natural lighting, unposed, like a real person's candid photo. NOT a cartoon, NOT illustrated. Photorealistic. ${ageNote}`;
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
        const updatedRelationships = await syncFamilyToRelationships(character, valid, currentUser);
        const systemPrompt = buildSystemPrompt({ ...character, family_members: valid });
        let updateData = { family_members: valid, fictional_relationships: updatedRelationships };
        if (systemPrompt) {
          const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          updateData.system_prompt_url = file_url;
        }
        await base44.entities.Character.update(character.id, updateData);

        // CRITICAL: Update linked npc_family_member Character with the generated avatar
        if (member._linked_character_id) {
          await base44.entities.Character.update(member._linked_character_id, {
            avatar_url: result.url
          });
        }

        // Store family member photo as reference for co-parents
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

        // Propagate to co-parents' family lists
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
              const otherRelationships = await syncFamilyToRelationships(otherChar, otherUpdated.filter(m => m.name?.trim()), currentUser);
              await base44.entities.Character.update(otherChar.id, {
                family_members: otherUpdated,
                fictional_relationships: otherRelationships,
              });
            }
          }
        }

        queryClient.invalidateQueries({ queryKey: ["character", character.id] });
        // Surgical patch — avoid unscoped ["characters"] invalidation
        queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map(c => c.id === character.id ? { ...c, family_members: valid, fictional_relationships: updatedRelationships } : c);
        });
      }
    } catch (err) {
      console.error('[FamilyEditor] Image generation failed:', err);
      try {
        const retryResult = await base44.integrations.Core.GenerateImage({
          prompt,
          existing_image_urls: parentRefs.length > 0 ? parentRefs : undefined,
        });
        if (retryResult?.url) {
          const updatedMembers = members.map((m, i) => i === idx ? { ...m, photo_url: retryResult.url } : m);
          setMembers(updatedMembers);
          const valid = updatedMembers.filter(m => m.name?.trim());
          const updatedRelationships = await syncFamilyToRelationships(character, valid, currentUser);
          const systemPrompt = buildSystemPrompt({ ...character, family_members: valid });
          let updateData = { family_members: valid, fictional_relationships: updatedRelationships };
          if (systemPrompt) {
            const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            updateData.system_prompt_url = file_url;
          }
          await base44.entities.Character.update(character.id, updateData);
          if (member._linked_character_id) {
            await base44.entities.Character.update(member._linked_character_id, {
              avatar_url: retryResult.url
            });
          }
          queryClient.invalidateQueries({ queryKey: ["character", character.id] });
          queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(c => c.id === character.id ? { ...c, family_members: valid, fictional_relationships: updatedRelationships } : c);
          });
        }
      } catch (retryErr) {
        console.error('[FamilyEditor] Image generation retry failed:', retryErr);
      }
    }
    setGeneratingMemberId(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Preserve _is_user entries; only validate/save non-user members
      const userEntry = members.find(m => m._is_user);
      const valid = members.filter(m => m.name?.trim() && !m._is_user);
      if (userEntry) valid.push(userEntry); // keep user entry intact
      const updatedRelationships = await syncFamilyToRelationships(character, valid, currentUser);
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
      // Surgical patch — avoid unscoped ["characters"] invalidation
      queryClient.setQueryData(["characters", currentUser?.email], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map(c => c.id === character.id ? { ...c, family_members: valid, fictional_relationships: updatedRelationships } : c);
      });
    } finally {
      setSaving(false);
    }
  };

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef(null);

  // Close add menu on outside click — only fire when clicking outside the entire menu container
  useEffect(() => {
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setShowAddMenu(false);
        setShowCharacterPicker(false);
      }
    };
    // Use capture=false so inner button clicks resolve first, preventing premature close
    document.addEventListener("mousedown", handler, false);
    return () => document.removeEventListener("mousedown", handler, false);
  }, []);

  const [showCharacterPicker, setShowCharacterPicker] = useState(false);
  const alreadyAddedSelf = members.some(m => m._is_user);

  // Characters available to add: active characters, NPC fictitious people, and family NPCs (all status=active)
  // CRITICAL: use the actual character_type enum values from the schema, not short aliases.
  const ALLOWED_TYPES = new Set([
    'active_created_character',
    'npc_fictitious',
    'npc_family_member',
    'npc_regular',
    // Legacy short-form aliases for backward compatibility with older records
    'active', 'npc', 'family_npc',
  ]);
  const typeOrder = (t) => {
    if (t === 'active_created_character' || t === 'active') return 0;
    if (t === 'npc_fictitious' || t === 'npc') return 1;
    if (t === 'npc_family_member' || t === 'family_npc') return 2;
    if (t === 'npc_regular') return 3;
    return 4;
  };
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
      _member_id: generateMemberId(),
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
    // CANONICAL USER_ID SOURCE:
    // currentUser is the result of base44.auth.me() — the User entity from the platform.
    // currentUser.id is the authoritative user_id. UserSettings.owner_user_id mirrors this
    // but is NOT the primary source. Do NOT read user_id from UserSettings; read it from
    // base44.auth.me() (the User entity). This is also verified in resolveAuthenticatedUser.js.
    setMembers(prev => [...prev, {
      _member_id: generateMemberId(),
      name: worldName,
      relationship_type: "other",
      // photo_url on user-participant entries is a DISPLAY CACHE ONLY.
      // The canonical avatar must come from User Profile + UserSettings at render/generation time.
      // This value is never used for identity or image generation — only for local UI preview.
      photo_url: userAvatar,
      age_at_creation: age,
      age_set_date: new Date().toISOString(),
      _is_user: true,
      participant_type: 'user',
      user_id: currentUser?.id || null,  // canonical: base44.auth.me().id (User entity)
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
                    {availableCharacters.filter(c => c.character_type === 'active_created_character' || c.character_type === 'active').length > 0 && (
                      <>
                        <p className="px-3 pt-2 pb-1 text-[9px] font-semibold text-primary/70 uppercase tracking-wider">Active Characters</p>
                        {availableCharacters.filter(c => c.character_type === 'active_created_character' || c.character_type === 'active').map(char => (
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
                    {availableCharacters.filter(c => c.character_type === 'npc_fictitious' || c.character_type === 'npc_regular' || c.character_type === 'npc').length > 0 && (
                      <>
                        <p className="px-3 pt-2 pb-1 text-[9px] font-semibold text-amber-400/70 uppercase tracking-wider">NPC Fictitious People</p>
                        {availableCharacters.filter(c => c.character_type === 'npc_fictitious' || c.character_type === 'npc_regular' || c.character_type === 'npc').map(char => (
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
                    {/* Family NPC characters (Character entities with character_type=npc_family_member) */}
                    {availableCharacters.filter(c => c.character_type === 'npc_family_member' || c.character_type === 'family_npc').length > 0 && (
                      <>
                        <p className="px-3 pt-2 pb-1 text-[9px] font-semibold text-blue-400/70 uppercase tracking-wider">Family NPCs</p>
                        {availableCharacters.filter(c => c.character_type === 'npc_family_member' || c.character_type === 'family_npc').map(char => (
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
          <div key={member._member_id || idx} className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
            {/* User entry — read-only, managed from My Profile */}
            {member._is_user ? (
              <div className="flex items-center gap-3">
                {(() => {
                  // CANONICAL RULE: user-participant entries MUST resolve avatar from live
                  // User Profile + UserSettings, NOT from the cached member.photo_url field.
                  // member.photo_url is a stale display cache only — it must NEVER be the authority.
                  const liveAvatar = currentUser?.generated_avatar_urls?.[0]
                    || currentUser?.reference_image_urls?.[0]
                    || null;
                  // Live identity always wins over cached proxy data
                  const displayUrl = liveAvatar || member.photo_url;
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
                  {/* CANONICAL RULE: always render live world name from UserSettings,
                      not the cached member.name (which may be stale proxy data). */}
                  <p className="text-sm text-foreground font-medium">
                    {userSettings?.fictional_world_name || currentUser?.full_name || member.name}
                  </p>
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
                  {/* SOURCE OF TRUTH: member.photo_url is the primary avatar source.
                      Linked Character avatar is used only if member.photo_url is absent. */}
                  <div className="relative flex-shrink-0">
                    {(() => {
                      // Priority: 1) member.photo_url (direct stored), 2) linked Character by ID, 3) name-match fallback
                      const linkedChar = member._linked_character_id
                        ? allCharacters.find(c => c.id === member._linked_character_id)
                        : null;
                      const displayUrl = member.photo_url || linkedChar?.avatar_url || getFamilyMemberAvatar(member.name);
                      const isActiveChar = !!(linkedChar || getFamilyMemberAvatar(member.name));
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
                    {/* Show camera icon for ALL editable family members, not just those missing avatars */}
                    {!isMemberLocked(member.name) && !readOnly && (
                      <button
                        onClick={() => generatePhoto(idx)}
                        disabled={generatingMemberId === member._member_id || !member.name?.trim()}
                        title="Generate or regenerate photo"
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 hover:bg-primary/80 transition-colors"
                      >
                        {generatingMemberId === member._member_id
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
                {generatingMemberId === member._member_id && (
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