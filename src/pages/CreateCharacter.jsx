import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus, X, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { calculateBirthdateFromZodiac } from "@/lib/zodiacUtils";
import { generateRandomName } from "@/lib/namePoolUtils";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import RelationshipStep from "@/components/character/RelationshipStep";
import VoiceSettings from "@/components/character/VoiceSettings";
import ReligionStep from "@/components/create/ReligionStep";
import CharacterTraitsStep from "@/components/character/CharacterTraitsStep";
import { CHARACTER_TRAITS } from "@/components/character/CharacterTraitsStep";

const ETHNICITIES = ["Black / African American", "Latino / Hispanic", "White / Caucasian", "Asian", "Middle Eastern", "Mixed / Multiracial", "Other"];
const GENDERS = ["Male", "Female", "Non-binary"];
const AGES = ["Early 20s", "Mid 20s", "Late 20s", "Early 30s", "Mid 30s", "Late 30s", "40s+"];
const LIVING = ["Lives alone", "Lives with roommates", "Lives with partner", "Lives with family", "Between places"];
const VIBES = ["Laid back", "Intense", "Sarcastic", "Warm", "Blunt", "Mysterious", "Chaotic", "Grounded"];

const ARCHETYPES = [
  { label: "The Protector", desc: "Puts others first. Loyal to a fault." },
  { label: "The Rebel", desc: "Questions everything. Lives on their own terms." },
  { label: "The Caretaker", desc: "Nurturing, empathetic, always there for people." },
  { label: "The Achiever", desc: "Driven, focused, always leveling up." },
  { label: "The Seeker", desc: "Restless, curious, always chasing something." },
  { label: "The Loner", desc: "Self-contained, guarded, doesn't need much." },
  { label: "The Charmer", desc: "Magnetic, reads rooms well, socially fluid." },
  { label: "The Realist", desc: "Blunt, grounded, calls it like it is." },
];

const ENERGY_SCALE = [
  { value: "introvert", label: "Introvert", desc: "Recharges alone. Private. Selective." },
  { value: "mostly_introvert", label: "Mostly Introvert", desc: "Prefers small circles but can engage." },
  { value: "ambivert", label: "Ambivert", desc: "Reads the room. Adapts to the situation." },
  { value: "mostly_extrovert", label: "Mostly Extrovert", desc: "Energized by people. Fairly social." },
  { value: "extrovert", label: "Extrovert", desc: "Thrives with people. Always in the mix." },
];

const SEXUAL_ORIENTATIONS = ["Straight", "Gay", "Gay (DL)", "Bisexual", "Bisexual (DL)", "Pansexual", "Queer", "Asexual", "Prefer not to say"];

const DL_INFO = `"Down Low" (DL) refers to someone who presents publicly as heterosexual but privately engages in same-sex relationships. It emphasizes secrecy and discretion — not just attraction. DL characters may compartmentalize their life, avoid labels, show internal conflict, and resist public visibility of same-sex connections. Rooted in AAVE; common in communities where cultural, family, or religious pressure shapes identity expression.`;

const JOB_TYPES = [
  "Retail / Customer Service", "Food Service / Restaurant", "Healthcare / Medical",
  "Corporate / Office", "Education / Teaching", "Creative / Arts", "Tech / Software",
  "Trades / Construction", "Freelance / Self-employed", "Student", "Student & Internship",
  "Unemployed", "Crime / Illegal", "Between jobs"
];

const PLACE_OPTIONS = [
  "Local coffee shop", "Gym", "Barber / Salon", "Church / Mosque / Temple",
  "Park / Outdoors", "Bars / Clubs", "Library", "Grocery store",
  "Friend's place", "Family home", "Laundromat", "Community center"
];

const MEMORY_PRESETS = [
  { title: "First heartbreak", description: "A relationship that ended badly and left a mark — whether they show it or not." },
  { title: "A betrayal by someone close", description: "Someone they trusted completely turned on them. They never fully forgot." },
  { title: "A moment they lost control", description: "A situation where they went further than they meant to — emotionally or otherwise." },
  { title: "A loss they haven't processed", description: "Someone or something they lost that still sits with them quietly." },
  { title: "A time they were humiliated", description: "A public or private moment where they felt small. It hardened something in them." },
  { title: "A decision they regret", description: "A fork in the road they took wrong. They know it. They don't talk about it much." },
  { title: "A moment of unexpected kindness", description: "Someone showed up for them when they didn't expect it. It stayed." },
  { title: "A falling out with family", description: "A rupture with someone in their family — said or unsaid. Still complicated." },
  { title: "Their first real win", description: "The moment they proved something to themselves. The thing they hold onto." },
  { title: "A secret they've never told anyone", description: "Something they carry alone. No one knows. Maybe they'll tell you." },
];

const DRAFT_KEY = "create_character_draft";

const ZODIAC_SIGNS = [
  "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
  "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"
];

const RELATIONSHIP_TYPES = [
  "mother","father","grandmother","grandfather","great-grandmother","great-grandfather",
  "aunt","uncle","sister","brother","half-sister","half-brother","step-mother","step-father",
  "step-sister","step-brother","cousin","niece","nephew","daughter","son","spouse","other",
];

const KNOWN_CHARACTER_RELATIONSHIP_TYPES = [
  "Friend", "Partner", "Spouse", "Sibling", "Cousin", "Co-worker", "Boss", "Member", "Rival", "Ex",
];

const defaultData = {
first_name: "", middle_name: "", last_name: "",
gender: "", age_range: "", ethnicities: [], living_situation: "",
city: "", state: "",
vibes: [], background: "", archetype: "", social_energy: "", sexual_orientation: "",
personality_override: "", situation_override: "",
memories: [],
job_title: "", workplace_type: "", work_environment: "",
occupation_description: "",
criminal_record: "",
zodiac_sign: "",
frequented_places: [],
known_character_relationships: [],
family_members: [],
birthday: "",
user_respect_level: 50,
friendship_level: 75,
romantic_level: 0,
attraction_level: 0,
chosen_family_level: 0,
voice_enabled: false,
voice_name: "",
voice_style_note: "",
religion: "None",
belief_level: "moderate",
religion_custom: "",
// traits
is_photogenic: false,
trait_oversharer: false,
trait_dry_humor: false,
trait_night_owl: false,
trait_hot_and_cold: false,
trait_flirty: false,
trait_overcorrects: false,
trait_blunt: false,
trait_easily_distracted: false,
trait_romanticizes: false,
trait_hard_to_read: false,
trait_competitive: false,
};

function loadDraft() {
  try { const s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

export default function CreateCharacter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = loadDraft();
  const [step, setStep] = useState(draft?.step || 0);
  const [isCreating, setIsCreating] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(draft?.avatarUrl || null);
  const [referenceUrls, setReferenceUrls] = useState(draft?.referenceUrls || []);
  const [newMemory, setNewMemory] = useState({ title: "", description: "" });
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [data, setData] = useState(draft?.data || defaultData);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [isGeneratingBackstory, setIsGeneratingBackstory] = useState(false);
  const [isGeneratingPersonality, setIsGeneratingPersonality] = useState(false);
  const [isGeneratingSituation, setIsGeneratingSituation] = useState(false);
  const [isExtractingFamily, setIsExtractingFamily] = useState(false);
  const [familyExtracted, setFamilyExtracted] = useState(false);
  const [pendingFamilyMembers, setPendingFamilyMembers] = useState([]); // proposed — not yet approved
  const [isGeneratingOccupation, setIsGeneratingOccupation] = useState(false);
  const [isGeneratingCriminalRecord, setIsGeneratingCriminalRecord] = useState(false);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.email === 'murqart@gmail.com';

  const { data: existingCharacters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => currentUser?.email ? base44.entities.Character.filter({ created_by: currentUser.email }, "-created_date") : [],
    enabled: !!currentUser?.email,
  });

  const activeCharCount = existingCharacters.filter(c => (c.character_type === 'active' || c.character_type === 'promoted_npc') && c.status === 'active').length;
  const canCreateCharacter = isAdmin || activeCharCount < 4;

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;

  const saveDraft = (newData, newStep, newAvatarUrl, newReferenceUrls) => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: newData, step: newStep, avatarUrl: newAvatarUrl, referenceUrls: newReferenceUrls }));
  };

  const update = (field, value) => setData(prev => {
    const next = { ...prev, [field]: value };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const toggleEthnicity = (e) => setData(prev => {
    const next = { ...prev, ethnicities: prev.ethnicities.includes(e) ? prev.ethnicities.filter(x => x !== e) : [...prev.ethnicities, e] };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const togglePlace = (p) => setData(prev => {
    const next = { ...prev, frequented_places: prev.frequented_places.includes(p) ? prev.frequented_places.filter(x => x !== p) : [...prev.frequented_places, p] };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const toggleKnownCharacter = (id) => setData(prev => {
    const existing = prev.known_character_relationships || [];
    const isSelected = existing.some(r => r.character_id === id);
    const next = {
      ...prev,
      known_character_relationships: isSelected
        ? existing.filter(r => r.character_id !== id)
        : [...existing, { character_id: id, relationship_type: "Friend" }]
    };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const updateKnownCharacterRelType = (id, relationship_type) => setData(prev => {
    const next = {
      ...prev,
      known_character_relationships: (prev.known_character_relationships || []).map(r => {
        if (r.character_id === id) {
          const updated = { ...r, relationship_type };
          // If "Partner" is selected, set romantic and attraction to 60
          if (relationship_type === "Partner") {
            updated.romantic_level = 60;
            updated.attraction_level = 60;
          } else {
            // Reset to 0 if changing from Partner to something else
            updated.romantic_level = 0;
            updated.attraction_level = 0;
          }
          return updated;
        }
        return r;
      })
    };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const generateName = async () => {
    setIsGeneratingName(true);
    const { first_name, last_name } = generateRandomName();
    setData(prev => {
      const next = { ...prev, first_name, last_name, middle_name: "" };
      saveDraft(next, step, avatarUrl, referenceUrls);
      return next;
    });
    setIsGeneratingName(false);
  };

  const generateBackstory = async () => {
    setIsGeneratingBackstory(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Write a short, raw backstory (2-3 sentences) for a ${data.age_range || "adult"} ${data.gender || "person"} who is ${data.ethnicities.join(" / ") || "from a mixed background"}, ${data.living_situation || "living on their own"}, working in ${data.workplace_type || "some field"}. Archetype: ${data.archetype || "unknown"}. Write in third person, informal, grounded. No flowery language. Focus on upbringing, family, or a defining past experience. IMPORTANT: Do NOT use any specific names for family members or people — use generic terms only (e.g. "their mother", "an older sibling", "a childhood friend"). Do NOT reference any names from other characters or external sources.`
    });
    update("background", result);
    setIsGeneratingBackstory(false);
  };

  const generatePersonality = async () => {
    setIsGeneratingPersonality(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Write 2-3 raw, honest personality notes for a ${data.archetype || "person"} who is ${data.social_energy?.replace("_", " ") || "somewhere in the middle socially"} with these vibes: ${data.vibes.join(", ") || "hard to pin down"}. Write it like someone who knows them well is describing their quirks, habits, and how they actually act — not a therapist, not a resume. No flattery. IMPORTANT: Do NOT use any specific names — refer to the person using gender-appropriate pronouns or generic terms only.`
    });
    update("personality_override", result);
    setIsGeneratingPersonality(false);
  };

  const generateOccupationDescription = async () => {
    setIsGeneratingOccupation(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Write a short, realistic occupation description (2-3 sentences) for a ${data.age_range || "adult"} ${data.gender || "person"} who works in ${data.workplace_type || "an unspecified field"} as a ${data.job_title || "worker"}. Describe what a typical day looks like — real and grounded. No names. Third person.`
    });
    update("occupation_description", result);
    setIsGeneratingOccupation(false);
  };

  const generateCriminalRecord = async () => {
    setIsGeneratingCriminalRecord(true);
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || "this person";
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Generate a plausible, brief criminal record for a fictional ${data.age_range || "adult"} ${data.gender || "person"} who is ${data.archetype || "a regular person"} with these vibes: ${data.vibes.join(", ") || "unknown"}. Make it feel grounded — could be minor (e.g. a DUI, petty theft) or more serious depending on their archetype. Return only a short paragraph describing the offense(s), rough year, and outcome. No names.`
    });
    update("criminal_record", result);
    setIsGeneratingCriminalRecord(false);
  };

  const generateSituation = async () => {
    setIsGeneratingSituation(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Describe in 2-3 sentences what's currently going on in the life of a ${data.age_range || "adult"} ${data.gender || "person"} who works in ${data.workplace_type || "some field"} as a ${data.job_title || "worker"} and ${data.living_situation || "lives somewhere"}. Make it feel like a real slice of life — something they're dealing with, adjusting to, or navigating right now. Casual tone, third person, no drama clichés. IMPORTANT: Do NOT use any specific names — use generic terms only (e.g. "their roommate", "a coworker", "their landlord").`
    });
    update("situation_override", result);
    setIsGeneratingSituation(false);
  };

  const extractFamilyFromText = async () => {
    const text = [data.background, data.personality_override, data.situation_override].filter(Boolean).join("\n\n");
    if (!text.trim()) return;
    setIsExtractingFamily(true);
    setPendingFamilyMembers([]);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Read the following character description and extract any explicitly named family members mentioned. Only include people who are clearly described as family (e.g. "her mom Sarah", "his brother Darius", "raised by her grandmother Elena"). Do not invent or assume. If no family members are mentioned by name, return an empty array.

Text:
${text}

Return ONLY a JSON object with a "members" array. Each item: { name: string, relationship_type: string }. Use lowercase relationship types like: mother, father, sister, brother, grandmother, grandfather, aunt, uncle, cousin, daughter, son, other.`,
      response_json_schema: {
        type: "object",
        properties: {
          members: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                relationship_type: { type: "string" }
              }
            }
          }
        }
      }
    });
    setIsExtractingFamily(false);
    setFamilyExtracted(true);
    if (result?.members?.length > 0) {
      // Show as PENDING — user must approve each one before they are added
      const existing = data.family_members || [];
      const existingNames = existing.map(m => (m.name || '').toLowerCase());
      const newOnes = result.members.filter(m => m.name && !existingNames.includes(m.name.toLowerCase()));
      setPendingFamilyMembers(newOnes); // do NOT auto-add — wait for user approval
    }
  };

  const approvePendingFamilyMember = (member) => {
    update("family_members", [...(data.family_members || []), member]);
    setPendingFamilyMembers(prev => prev.filter(m => m.name !== member.name));
  };

  const rejectPendingFamilyMember = (member) => {
    setPendingFamilyMembers(prev => prev.filter(m => m.name !== member.name));
  };

  const toggleVibe = (v) => setData(prev => {
    const next = { ...prev, vibes: prev.vibes.includes(v) ? prev.vibes.filter(x => x !== v) : prev.vibes.length < 4 ? [...prev.vibes, v] : prev.vibes };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const addPresetMemory = (preset) => {
    if (data.memories.find(m => m.title === preset.title)) return;
    update("memories", [...data.memories, { title: preset.title, description: preset.description, emotional_impact: "", lesson_learned: "" }]);
  };

  const addCustomMemory = () => {
    if (!newMemory.title.trim()) return;
    update("memories", [...data.memories, { title: newMemory.title, description: newMemory.description, emotional_impact: "", lesson_learned: "" }]);
    setNewMemory({ title: "", description: "" });
    setShowMemoryForm(false);
  };

  const [isRandomCreating, setIsRandomCreating] = useState(false);

  const handleRandomCreate = async () => {
    if (!canCreateCharacter && !isAdmin) {
      alert('You have reached the maximum of 4 active characters. Delete or archive one to create another.');
      return;
    }
    
    // ══════════════════════════════════════════════════════════════
    // LOCK ACTING USER CONTEXT AT RANDOM CREATE START (CRITICAL FIX)
    // ══════════════════════════════════════════════════════════════
    if (!currentUser?.email || !currentUser?.id) {
      alert('Error: Unable to determine current user. Please refresh and try again.');
      return;
    }
    
    const lockedActingUserEmail = currentUser.email;
    const lockedActingUserId = currentUser.id;
    const lockedActingUserRole = currentUser.role || 'user';
    
    setIsRandomCreating(true);
    try {
      // Pick random attributes
      const randomGender = GENDERS[Math.floor(Math.random() * GENDERS.length)];
      const randomAge = AGES[Math.floor(Math.random() * AGES.length)];
      const randomEthnicity = ETHNICITIES[Math.floor(Math.random() * ETHNICITIES.length)];
      const randomLiving = LIVING[Math.floor(Math.random() * LIVING.length)];
      const randomArchetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
      const randomEnergy = ENERGY_SCALE[Math.floor(Math.random() * ENERGY_SCALE.length)];
      const randomJob = JOB_TYPES[Math.floor(Math.random() * JOB_TYPES.length)];
      const randomZodiac = ZODIAC_SIGNS[Math.floor(Math.random() * ZODIAC_SIGNS.length)];
      const shuffledVibes = [...VIBES].sort(() => Math.random() - 0.5);
      const randomVibes = shuffledVibes.slice(0, 2 + Math.floor(Math.random() * 3));
      const randomOrientation = SEXUAL_ORIENTATIONS.filter(o => !o.includes("(DL)") && o !== "Prefer not to say")[Math.floor(Math.random() * 5)];

      const { first_name, last_name } = generateRandomName();
      const birthday = calculateBirthdateFromZodiac(randomZodiac, randomAge) || "";

      const fullName = `${first_name} ${last_name}`;
      const charProfile = `Name: ${fullName}. Age: ${randomAge}. Background: ${randomEthnicity}. Gender: ${randomGender}. Archetype: ${randomArchetype.label}. Social energy: ${randomEnergy.value}. Vibes: ${randomVibes.join(", ")}. Living situation: ${randomLiving}. Job type: ${randomJob}.`;

      // Generate all in parallel
      const [personality, generatedMemories, sleepSchedule, avatarResult, backstory] = await Promise.all([
        base44.integrations.Core.InvokeLLM({
          prompt: `Create a personality summary (2-3 sentences, raw and real, third person) for: ${charProfile}. Make it feel like a real person, not a description. No flowery language.`
        }),
        base44.integrations.Core.InvokeLLM({
          prompt: `Generate 4 specific memories for this character that shaped who they are. CHARACTER: ${charProfile}. Return ONLY a JSON object with a "memories" array. Each memory: { title, description, emotional_impact, lesson_learned }`,
          response_json_schema: {
            type: "object",
            properties: {
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    emotional_impact: { type: "string" },
                    lesson_learned: { type: "string" }
                  }
                }
              }
            }
          }
        }),
        base44.integrations.Core.InvokeLLM({
          prompt: `Given this character's job (${randomJob}) and social energy (${randomEnergy.value}), return their realistic sleep schedule. Return ONLY JSON with sleep_start_time and wake_up_time in HH:MM 24-hour format.`,
          response_json_schema: {
            type: "object",
            properties: {
              sleep_start_time: { type: "string" },
              wake_up_time: { type: "string" }
            }
          }
        }),
        base44.integrations.Core.GenerateImage({
          prompt: `Portrait photo of a real person. ${randomAge} ${randomEthnicity} descent. Gender: ${randomGender}. ${randomVibes.join(", ")} energy. ${randomArchetype.label} personality. Natural lighting, realistic, photographic, candid feel. Photorealistic, cinematic, high-resolution. Not an illustration, not a painting, natural skin texture.`
        }),
        base44.integrations.Core.InvokeLLM({
          prompt: `Write a 2-sentence backstory for a ${randomAge} ${randomGender} who is ${randomEthnicity}, ${randomLiving}, works in ${randomJob}, and has a ${randomArchetype.label} personality. Third person, grounded, no names for other people.`
        }),
      ]);

      // ══════════════════════════════════════════════════════════════
      // RANDOM CREATE: USE LOCKED ACTING USER CONTEXT FOR ALL IDENTITY
      // ══════════════════════════════════════════════════════════════
      const charData = {
        name: fullName,
        created_by: lockedActingUserEmail,
        owner_email: lockedActingUserEmail,
        character_type: "active_created_character",
        gender: randomGender.toLowerCase(),
        archetype: randomArchetype.label,
        social_energy: randomEnergy.value,
        sexual_orientation: randomOrientation,
        personality_summary: typeof personality === "string" ? personality : JSON.stringify(personality),
        personality_traits: randomVibes,
        communication_style: `${randomVibes.join(", ")} communication style. Real, unpolished speech.`,
        age_range: randomAge,
        ethnicities: [randomEthnicity],
        background_story: typeof backstory === "string" ? backstory : `${randomAge} ${randomEthnicity} ${randomGender.toLowerCase()}. ${randomLiving}.`,
        current_situation: randomLiving,
        emotional_state: "calm",
        birthday: birthday || undefined,
        zodiac_sign: randomZodiac,
        avatar_url: avatarResult?.url,
        memories: generatedMemories?.memories?.length > 0 ? generatedMemories.memories : undefined,
        work_details: { job_title: "", workplace_type: randomJob, work_environment: "" },
        user_respect_level: 50,
        friendship_level: 75,
        romantic_level: 0,
        attraction_level: 0,
        chosen_family_level: 0,
        sleep_start_time: sleepSchedule?.sleep_start_time || "23:00",
        wake_up_time: sleepSchedule?.wake_up_time || "07:00",
        religion: "None",
        belief_level: "moderate",
        status: "active",
        is_finalized: true,
        family_members: [],
      };
      // Upload system prompt — non-blocking fallback if it fails
      try {
        const systemPromptText = buildSystemPrompt(charData, []);
        const uploadedPrompt = await base44.integrations.Core.UploadFile({
          file: new File([systemPromptText], "system_prompt.txt", { type: "text/plain" })
        });
        if (uploadedPrompt?.file_url) charData.system_prompt_url = uploadedPrompt.file_url;
      } catch (promptErr) {
        console.warn('[CreateCharacter] System prompt upload failed — continuing without it:', promptErr.message);
      }

      const res = await base44.functions.invoke("createCharacterWithRelationships", {
        characterData: charData,
        characterRelationships: []
      });

      if (res?.data?.success) {
        const newChar = res.data.character;
        localStorage.removeItem(DRAFT_KEY);

        // Persist memories to Memory entity
        if (generatedMemories?.memories?.length > 0 && newChar?.id) {
          generatedMemories.memories.forEach(mem => {
            base44.entities.Memory.create({
              character_id: newChar.id,
              title: mem.title,
              description: mem.description,
              emotional_impact: mem.emotional_impact || "",
              lesson_learned: mem.lesson_learned || "",
              timestamp: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
              source_context: "character_creation",
            }).catch(() => {});
          });
        }

        // Pre-create both direct and phone conversations
        if (newChar?.id) {
          Promise.all([
            base44.entities.Conversation.create({
              title: `Chat with ${newChar.name}`,
              type: "direct",
              character_ids: [newChar.id],
            }),
            base44.entities.Conversation.create({
              title: `Text with ${newChar.name}`,
              type: "phone",
              character_ids: [newChar.id],
            }),
          ]).catch(() => {});
        }

        // Invalidate ALL character cache variants
        queryClient.invalidateQueries({ queryKey: ["characters"] });
        queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
        queryClient.invalidateQueries({ queryKey: ["user"] });
        await queryClient.refetchQueries({ queryKey: ["characters", currentUser?.email] });
        navigate("/home");
      } else {
        throw new Error("Failed to create random character");
      }
    } catch (err) {
      setIsRandomCreating(false);
      alert("Failed to create random character. Please try again.");
    }
  };

  const removeMemory = (title) => update("memories", data.memories.filter(m => m.title !== title));

  const handleCreate = async () => {
    if (!canCreateCharacter && !isAdmin) {
      alert('You have reached the maximum of 4 active characters. Delete or archive one to create another.');
      return;
    }
    
    // ══════════════════════════════════════════════════════════════
    // LOCK ACTING USER CONTEXT AT CREATION START (CRITICAL FIX)
    // ══════════════════════════════════════════════════════════════
    // Freeze the acting user identity. Do NOT re-read from global state.
    // Use only this locked context for ALL identity-based fields.
    if (!currentUser?.email || !currentUser?.id) {
      alert('Error: Unable to determine current user. Please refresh and try again.');
      return;
    }
    
    const lockedActingUserEmail = currentUser.email;
    const lockedActingUserId = currentUser.id;
    const lockedActingUserRole = currentUser.role || 'user';
    
    setIsCreating(true);
    // BACKWARD COMPATIBILITY: merge any missing fields with safe defaults so older
    // draft data never blocks creation after a schema update
    const safeData = { ...defaultData, ...data };
    Object.assign(data, safeData);
    try {
      // Auto-generate avatar if none provided
      let finalAvatarUrl = avatarUrl;
      if (!finalAvatarUrl) {
        const ethnicityPart = data.ethnicities.length > 0 ? `${data.ethnicities.join(" and ")} descent, clearly reflecting their cultural background` : "";
        const prompt = `Portrait photo of a real person. ${data.age_range || "adult"} ${ethnicityPart ? ethnicityPart + "." : ""} Gender: ${data.gender || "person"}. ${data.vibes.join(", ")} energy. ${data.archetype ? data.archetype + " personality." : ""} Natural lighting, realistic, photographic, candid feel. Not a model, a real everyday person.\n\n📸 STYLE DIRECTIVE: Photorealistic, cinematic, ultra-detailed, high-resolution professional photography. RAW photo quality. Natural lighting. No illustrations or artistic renderings — this must look like a real photograph. CRITICAL: Not an illustration, not a painting, not a digital render, not uncanny valley, natural skin texture, real human proportions.`;
        const result = await base44.integrations.Core.GenerateImage({ prompt });
        finalAvatarUrl = result.url;
      }

      const fullName = [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(" ");
      const ethnicityStr = data.ethnicities.join(" / ");

      // Build known-characters context for the prompt
      const knownRels = data.known_character_relationships || [];
      const knownChars = existingCharacters.filter(c => knownRels.some(r => r.character_id === c.id));
      const knownContext = knownChars.length > 0
        ? `They personally know these people: ${knownChars.map(c => {
            const rel = knownRels.find(r => r.character_id === c.id);
            return `${c.name} (${rel?.relationship_type || "knows them"} — ${c.personality_summary?.split(".")[0] || ""})`;
          }).join("; ")}.`
        : "";

      const charProfile = `Name: ${fullName}. Age: ${data.age_range}. Background: ${ethnicityStr}. Gender: ${data.gender}. Archetype: ${data.archetype}. Social energy: ${data.social_energy}. Vibes: ${data.vibes.join(", ")}. Living situation: ${data.living_situation}. Job: ${data.job_title || "not specified"} at a ${data.workplace_type || "workplace"}. Background story: ${data.background || "not specified"}. ${knownContext}`;

      // Run personality + memory generation in parallel
      const memoryThemes = data.memories.length > 0
        ? data.memories.map(m => `"${m.title}": ${m.description}`).join("; ")
        : "first heartbreak, a betrayal, a moment of unexpected loss or failure, a win that proved something, a secret";

      const personalityOverrideNote = data.personality_override
        ? ` IMPORTANT: The creator also wrote this about them directly — incorporate this and let it shape the result: "${data.personality_override}"`
        : "";

      const [personality, generatedMemories, sleepSchedule] = await Promise.all([
        base44.integrations.Core.InvokeLLM({
          prompt: `Create a personality summary (2-3 sentences, raw and real, written about this person in third person) for: ${charProfile}.${personalityOverrideNote} Make it feel like a real person, not a description. No flowery language.`
        }),
        base44.integrations.Core.InvokeLLM({
          prompt: `You are building the internal memory bank of a fictional person for a character simulation. Generate 4-6 specific, vivid, predated memories for this character that permanently shaped who they are.

CHARACTER: ${charProfile}

MEMORY THEMES TO COVER (use these as seeds, not scripts): ${memoryThemes}

Each memory must:
- Be a specific, grounded scene — not vague. Include real names, places, situations.
- Feel like a real human experience, not a movie moment.
- Have real emotional weight that still affects how they behave today.
- Use informal, real language in the descriptions — not polished.

Return ONLY a JSON object with a "memories" array. Each memory object: { title, description, emotional_impact, lesson_learned }
- title: short (3-6 words), real, lowercase
- description: 3-5 sentences. Specific scene, what happened, who was involved.
- emotional_impact: 1-2 sentences. What it did to them internally. How it affects them now.
- lesson_learned: 1 sentence. The thing they took away — spoken like them, not a therapist.`,
          response_json_schema: {
            type: "object",
            properties: {
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    emotional_impact: { type: "string" },
                    lesson_learned: { type: "string" }
                  }
                }
              }
            }
          }
        }),
        base44.integrations.Core.InvokeLLM({
          prompt: `Given this character's lifestyle and job, determine their realistic sleep schedule.

CHARACTER: ${charProfile}

Consider their job type, social energy, age, and lifestyle. A bartender working nights would sleep ~3:00-11:00. A nurse on day shift might sleep 22:00-06:00. A college student might sleep 02:00-10:00. A retiree might sleep 21:30-05:30. A night owl creative might sleep 01:30-09:30.

Return ONLY a JSON object with sleep_start_time and wake_up_time in HH:MM 24-hour format.`,
          response_json_schema: {
            type: "object",
            properties: {
              sleep_start_time: { type: "string" },
              wake_up_time: { type: "string" }
            }
          }
        })
      ]);

      const finalMemories = generatedMemories?.memories?.length > 0
        ? generatedMemories.memories
        : data.memories.length > 0 ? data.memories : undefined;

      // ══════════════════════════════════════════════════════════════
      // STANDARD CREATE: USE LOCKED ACTING USER CONTEXT FOR ALL IDENTITY
      // ══════════════════════════════════════════════════════════════
      const charData = {
        name: fullName,
        created_by: lockedActingUserEmail,
        owner_email: lockedActingUserEmail,
        character_type: "active_created_character",
        gender: data.gender?.toLowerCase(),
        archetype: data.archetype || undefined,
        social_energy: data.social_energy || undefined,
        sexual_orientation: (data.sexual_orientation && data.sexual_orientation !== "Prefer not to say") ? data.sexual_orientation : undefined,
        personality_summary: personality,
        personality_traits: data.vibes,
        communication_style: `${data.vibes.join(", ")} communication style. Real, unpolished speech.`,
        age_range: data.age_range || undefined,
        ethnicities: data.ethnicities.length > 0 ? data.ethnicities : undefined,
        background_story: data.background || `${data.age_range} ${ethnicityStr} ${data.gender?.toLowerCase()}. ${data.living_situation}.`,
        current_situation: data.situation_override || data.living_situation,
        emotional_state: "calm",
        reference_image_urls: referenceUrls.length > 0 ? referenceUrls : undefined,
        birthday: data.birthday || undefined,
        avatar_url: finalAvatarUrl,
        memories: finalMemories,
        criminal_record: data.criminal_record || undefined,
        zodiac_sign: data.zodiac_sign || undefined,
        work_details: (data.job_title || data.workplace_type) ? {
          job_title: data.job_title,
          workplace_type: data.workplace_type,
          work_environment: data.occupation_description || data.work_environment,
        } : undefined,
        frequented_places: data.frequented_places.length > 0 ? data.frequented_places : undefined,
        family_members: (data.family_members || []).filter(m => m.name.trim()).length > 0 ? data.family_members.filter(m => m.name.trim()) : [],
        fictional_relationships: knownChars.length > 0 ? knownChars.map(c => {
          const rel = knownRels.find(r => r.character_id === c.id);
          return {
            person_name: c.name,
            related_character_id: c.id,
            relationship_type: rel?.relationship_type || "Friend",
            description: `${fullName} is a ${rel?.relationship_type || "friend"} of ${c.name}.`,
            current_status: "active",
            emotional_impact: "neutral",
            last_interaction_summary: "",
            history_summary: "",
          };
        }) : undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        user_respect_level: data.user_respect_level,
        friendship_level: data.friendship_level,
        romantic_level: data.romantic_level,
        attraction_level: data.attraction_level,
        chosen_family_level: data.chosen_family_level,
        sleep_start_time: sleepSchedule?.sleep_start_time || "23:00",
        wake_up_time: sleepSchedule?.wake_up_time || "07:00",
        religion: data.religion || "None",
        belief_level: data.belief_level || "moderate",
        religion_custom: data.religion_custom || undefined,
        // character traits & quirks
        is_photogenic: data.is_photogenic || false,
        ...Object.fromEntries(
          CHARACTER_TRAITS.filter(t => t.key !== "is_photogenic").map(t => [t.key, data[t.key] || false])
        ),
        status: "active",
        is_finalized: true,
      };
      // Upload system prompt as a file — non-blocking: if it fails, character still saves
      try {
        const systemPromptText = buildSystemPrompt(charData, knownChars);
        const uploadedPrompt = await base44.integrations.Core.UploadFile({
          file: new File([systemPromptText], "system_prompt.txt", { type: "text/plain" })
        });
        if (uploadedPrompt?.file_url) charData.system_prompt_url = uploadedPrompt.file_url;
      } catch (promptErr) {
        console.warn('[CreateCharacter] System prompt upload failed — continuing without it:', promptErr.message);
      }

      // Create character and handle bidirectional relationships
      const res = await base44.functions.invoke("createCharacterWithRelationships", {
        characterData: charData,
        characterRelationships: charData.fictional_relationships || []
      });

      if (res?.data?.success) {
        const newChar = res.data.character;
        localStorage.removeItem(DRAFT_KEY);

        // Persist generated memories to the Memory entity for long-term recall
        if (finalMemories && newChar?.id) {
          finalMemories.forEach(mem => {
            base44.entities.Memory.create({
              character_id: newChar.id,
              title: mem.title,
              description: mem.description,
              emotional_impact: mem.emotional_impact || "",
              lesson_learned: mem.lesson_learned || "",
              timestamp: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
              source_context: "character_creation",
            }).catch(() => {});
          });
        }

        // Pre-create both direct and phone conversations so they exist immediately
         if (newChar?.id) {
           Promise.all([
             base44.entities.Conversation.create({
               title: `Chat with ${newChar.name}`,
               type: "direct",
               character_ids: [newChar.id],
             }),
             base44.entities.Conversation.create({
               title: `Text with ${newChar.name}`,
               type: "phone",
               character_ids: [newChar.id],
             }),
           ]).catch(() => {});
         }

         // Setup character's home with default location registration + financial record
         if (newChar?.id) {
           Promise.all([
             base44.functions.invoke('setupCharacterHome', {
               characterId: newChar.id,
               characterName: newChar.name,
             }).catch(() => {}),
             base44.functions.invoke('initializeCharacterFinancials', {
               characterId: newChar.id,
               characterName: newChar.name,
               isNpc: false,
             }).catch(() => {}),
           ]);
         }

         // Invalidate ALL character cache variants to guarantee Home page refresh
         queryClient.invalidateQueries({ queryKey: ["characters"] });
         queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
         queryClient.invalidateQueries({ queryKey: ["user"] });
         queryClient.invalidateQueries({ queryKey: ["locationReferences"] });
         queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
         // Force a fresh refetch before navigating
         await queryClient.refetchQueries({ queryKey: ["characters", currentUser?.email] });
         navigate("/home");
       } else {
         throw new Error(res?.data?.error || "Failed to create character");
       }
     } catch (error) {
      setIsCreating(false);
      // CREATION_VERSION_MISMATCH / CREATION_BLOCKED_ERROR:
      // Surface a clear error with a retry option rather than a dead state.
      const msg = error?.message || "";
      if (msg.includes("validation") || msg.includes("required") || msg.includes("field")) {
        alert("Some fields couldn't be validated. Retrying with safe defaults — please tap Create again.");
      } else {
        alert("Failed to create character. Please check your connection and try again.");
      }
     }
     };

  const chipClass = (selected) =>
    `py-2.5 px-3 rounded-xl text-sm border transition-colors text-left cursor-pointer ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`;

  const steps = [
    // Step 0: Basic info
    <div key="basic" className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Name</label>
          <button onClick={generateName} disabled={isGeneratingName} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50">
            <Sparkles className="w-3 h-3" />{isGeneratingName ? "Generating..." : "Auto-generate"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={data.first_name} onChange={e => update("first_name", e.target.value)} placeholder="First name" className="h-12 rounded-xl text-base" />
          <Input value={data.last_name} onChange={e => update("last_name", e.target.value)} placeholder="Last name" className="h-12 rounded-xl text-base" />
        </div>
        <Input value={data.middle_name} onChange={e => update("middle_name", e.target.value)} placeholder="Middle name (optional)" className="h-11 rounded-xl text-base mt-2" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Gender</label>
        <div className="grid grid-cols-3 gap-2">
          {GENDERS.map(g => <button key={g} onClick={() => update("gender", g)} className={chipClass(data.gender === g)}>{g}</button>)}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Age Range</label>
        <div className="grid grid-cols-3 gap-2">
          {AGES.map(a => (
            <button key={a} onClick={() => {
              update("age_range", a);
              // Auto-fill birthday if zodiac already set
              if (data.zodiac_sign) {
                const bd = calculateBirthdateFromZodiac(data.zodiac_sign, a);
                if (bd) update("birthday", bd);
              }
            }} className={chipClass(data.age_range === a)}>{a}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Zodiac Sign (optional)</label>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {ZODIAC_SIGNS.map(z => (
            <button key={z} onClick={() => {
              update("zodiac_sign", z);
              // Auto-fill birthday if age range is set
              if (data.age_range) {
                const bd = calculateBirthdateFromZodiac(z, data.age_range);
                if (bd) update("birthday", bd);
              }
            }} className={chipClass(data.zodiac_sign === z)}>{z}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Birthday (optional)</label>
        <p className="text-xs text-muted-foreground mb-1">Auto-fills when you pick age range + zodiac sign above.</p>
        <Input type="date" value={data.birthday} onChange={e => update("birthday", e.target.value)} className="h-11 rounded-xl text-sm" />
      </div>
    </div>,

    // Step 1: Background
    <div key="background" className="space-y-5">
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Cultural Background</label>
        <p className="text-xs text-muted-foreground mb-2">Select all that apply</p>
        <div className="grid grid-cols-2 gap-2">
          {ETHNICITIES.map(e => <button key={e} onClick={() => toggleEthnicity(e)} className={chipClass(data.ethnicities.includes(e))}>{e}</button>)}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Living Situation</label>
        <div className="grid grid-cols-2 gap-2">
          {LIVING.map(l => <button key={l} onClick={() => update("living_situation", l)} className={chipClass(data.living_situation === l)}>{l}</button>)}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Where do they live?</label>
        <div className="grid grid-cols-2 gap-2">
          <Input value={data.city} onChange={e => update("city", e.target.value)} placeholder="City" className="h-11 rounded-xl text-sm" />
          <Input value={data.state} onChange={e => update("state", e.target.value)} placeholder="State" className="h-11 rounded-xl text-sm" />
        </div>
      </div>
    </div>,

    // Step 2: Work & Places
    <div key="work" className="space-y-5">
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">What do they do for work?</label>
        <p className="text-xs text-muted-foreground mb-3">This shapes their daily interactions and who they encounter</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {JOB_TYPES.map(j => (
            <button key={j} onClick={() => update("workplace_type", j)} className={chipClass(data.workplace_type === j)}>{j}</button>
          ))}
        </div>
        <Input value={data.job_title} onChange={e => update("job_title", e.target.value)} placeholder="Specific job title (e.g. cashier, nurse, designer)" className="h-11 rounded-xl text-sm mt-2" />
        <Textarea value={data.work_environment} onChange={e => update("work_environment", e.target.value)} placeholder="Describe the work environment... (optional)" className="rounded-xl mt-2 min-h-[70px] text-sm resize-none" />
        <div className="flex items-center justify-between mt-3 mb-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Occupation description (optional)</label>
          <button onClick={generateOccupationDescription} disabled={isGeneratingOccupation} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50">
            <Sparkles className="w-3 h-3" />{isGeneratingOccupation ? "Generating..." : "Auto-generate"}
          </button>
        </div>
        <Textarea value={data.occupation_description} onChange={e => update("occupation_description", e.target.value)} placeholder="What does a typical day at work look like for them?" className="rounded-xl min-h-[70px] text-sm resize-none" />
        <div className="flex items-center justify-between mt-3 mb-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Criminal record (optional)</label>
          <button onClick={generateCriminalRecord} disabled={isGeneratingCriminalRecord} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50">
            <Sparkles className="w-3 h-3" />{isGeneratingCriminalRecord ? "Generating..." : "Auto-generate"}
          </button>
        </div>
        <Textarea value={data.criminal_record} onChange={e => update("criminal_record", e.target.value)} placeholder="Leave blank for no criminal record..." className="rounded-xl min-h-[70px] text-sm resize-none" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Places they frequent</label>
        <p className="text-xs text-muted-foreground mb-3">Where do they spend time outside of work or home?</p>
        <div className="grid grid-cols-2 gap-2">
          {PLACE_OPTIONS.map(p => (
            <button key={p} onClick={() => togglePlace(p)} className={chipClass(data.frequented_places.includes(p))}>{p}</button>
          ))}
        </div>
      </div>
    </div>,

    // Step 3: Connections to existing characters
    <div key="connections" className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Do they know anyone?</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Select which existing characters this person already knows. Their relationship will be woven into their personality and how they talk about their life. Leave empty if they're a stranger to everyone.
        </p>
      </div>
      {existingCharacters.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No other characters yet.</p>
      ) : (
        <div className="space-y-3">
          {existingCharacters.map(char => {
            const rel = (data.known_character_relationships || []).find(r => r.character_id === char.id);
            const selected = !!rel;
            return (
              <div
                key={char.id}
                className={`w-full rounded-xl border transition-colors ${selected ? "bg-primary/10 border-primary/40" : "bg-card border-border"}`}
              >
                <button
                  onClick={() => toggleKnownCharacter(char.id)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  <CharacterAvatar character={char} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${selected ? "text-primary" : "text-foreground"}`}>{char.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{char.personality_summary?.split(".")[0]}</p>
                  </div>
                  {selected && (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                </button>
                {selected && !char.is_default && (
                  <div className="px-3 pb-3">
                    <div className="flex flex-wrap gap-2">
                      {KNOWN_CHARACTER_RELATIONSHIP_TYPES.map(type => (
                        <button
                          key={type}
                          onClick={() => updateKnownCharacterRelType(char.id, type)}
                          className={`px-3 py-1 rounded-full text-xs border transition-colors ${rel.relationship_type === type ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {(data.known_character_relationships || []).length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Knows {data.known_character_relationships.length} character{data.known_character_relationships.length > 1 ? "s" : ""}
        </p>
      )}
    </div>,

    // Step 5: Archetype + social energy + orientation
    <div key="archetype" className="space-y-6">
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Archetype</label>
        <p className="text-xs text-muted-foreground mb-3">Who are they at their core?</p>
        <div className="grid grid-cols-2 gap-2">
          {ARCHETYPES.map(a => (
            <button key={a.label} onClick={() => update("archetype", a.label)}
              className={`p-3 rounded-xl border transition-colors text-left ${data.archetype === a.label ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
              <div className="text-sm font-medium">{a.label}</div>
              <div className={`text-xs mt-0.5 ${data.archetype === a.label ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{a.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Social Energy</label>
        <div className="space-y-2">
          {ENERGY_SCALE.map(e => (
            <button key={e.value} onClick={() => update("social_energy", e.value)}
              className={`w-full p-3 rounded-xl border transition-colors text-left flex items-center justify-between ${data.social_energy === e.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
              <span className="text-sm font-medium">{e.label}</span>
              <span className={`text-xs ${data.social_energy === e.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{e.desc}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Sexual Orientation (optional)</label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SEXUAL_ORIENTATIONS.map(o => <button key={o} onClick={() => update("sexual_orientation", o)} className={chipClass(data.sexual_orientation === o)}>{o}</button>)}
        </div>
        {(data.sexual_orientation === "Gay (DL)" || data.sexual_orientation === "Bisexual (DL)") && (
          <div className="mt-3 p-3 rounded-xl bg-secondary/60 border border-border">
            <p className="text-xs font-semibold text-foreground mb-1">About "DL" (Down Low)</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{DL_INFO}</p>
          </div>
        )}
      </div>
    </div>,

    // Step 6: Vibes + backstory + overrides
    <div key="vibes" className="space-y-5">
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Their vibe (pick up to 4)</label>
        <div className="grid grid-cols-4 gap-2">
          {VIBES.map(v => (
            <button key={v} onClick={() => toggleVibe(v)} className={`py-2 rounded-xl text-xs border font-medium transition-colors ${data.vibes.includes(v) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground"}`}>{v}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Backstory (optional)</label>
          <button onClick={generateBackstory} disabled={isGeneratingBackstory} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50">
            <Sparkles className="w-3 h-3" />{isGeneratingBackstory ? "Generating..." : "Auto-generate"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Write freely — this shapes who they are. The AI will blend it in.</p>
        <Textarea value={data.background} onChange={e => update("background", e.target.value)} placeholder="Anything about their past, family, where they came from..." className="rounded-xl min-h-[90px] text-sm resize-none" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Personality notes (optional)</label>
          <button onClick={generatePersonality} disabled={isGeneratingPersonality} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50">
            <Sparkles className="w-3 h-3" />{isGeneratingPersonality ? "Generating..." : "Auto-generate"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">Override or add to the generated personality. Write it raw — exactly how you'd describe them.</p>
        <Textarea value={data.personality_override} onChange={e => update("personality_override", e.target.value)} placeholder="e.g. She holds grudges but never admits it. Laughs loudly then goes quiet when something actually matters to her..." className="rounded-xl min-h-[90px] text-sm resize-none" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Current situation (optional)</label>
          <button onClick={generateSituation} disabled={isGeneratingSituation} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50">
            <Sparkles className="w-3 h-3" />{isGeneratingSituation ? "Generating..." : "Auto-generate"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">What's going on in their life right now — job situation, housing, something they're dealing with.</p>
        <Textarea value={data.situation_override} onChange={e => update("situation_override", e.target.value)} placeholder="e.g. Just got out of a 3-year relationship. Moved back to her hometown. Working two jobs to save up..." className="rounded-xl min-h-[80px] text-sm resize-none" />
      </div>
    </div>,

    // Step 7: Family members
    <div key="family" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Family members</h2>
        <p className="text-xs text-muted-foreground mb-1">We scanned the backstory you wrote for any family names. Edit, add, or remove — this is the definitive list.</p>
        <p className="text-xs text-muted-foreground/60 mb-3">Leave empty if they have no family — the character will know that too.</p>
      </div>

      {/* AI extraction button — only if there's text to scan and haven't extracted yet */}
      {(data.background || data.personality_override || data.situation_override) && !familyExtracted && (
        <button
          onClick={extractFamilyFromText}
          disabled={isExtractingFamily}
          className="w-full flex items-center gap-2 justify-center py-3 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          {isExtractingFamily ? "Reading backstory..." : "Scan backstory for family names"}
        </button>
      )}
      {familyExtracted && pendingFamilyMembers.length === 0 && (data.family_members || []).length === 0 && (
        <p className="text-xs text-primary/70 text-center">No family names found in the backstory. Add them manually below if needed.</p>
      )}

      {/* Pending approval — user must approve each one individually */}
      {pendingFamilyMembers.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Found in backstory — approve to add</p>
          <p className="text-xs text-muted-foreground">These names were detected. You must approve each one before they are added to the family list.</p>
          {pendingFamilyMembers.map((member, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-card rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{member.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{member.relationship_type}</p>
              </div>
              <button
                onClick={() => approvePendingFamilyMember(member)}
                className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => rejectPendingFamilyMember(member)}
                className="px-3 py-1 rounded-lg bg-secondary text-muted-foreground text-xs hover:text-destructive transition-colors"
              >
                Skip
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {(data.family_members || []).map((member, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              value={member.name}
              onChange={e => {
                const updated = [...data.family_members];
                updated[idx] = { ...updated[idx], name: e.target.value };
                update("family_members", updated);
              }}
              placeholder="Name"
              className="flex-1 bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground min-w-0"
            />
            <select
              value={member.relationship_type}
              onChange={e => {
                const updated = [...data.family_members];
                updated[idx] = { ...updated[idx], relationship_type: e.target.value };
                update("family_members", updated);
              }}
              className="bg-secondary text-foreground text-sm rounded-xl px-2 py-2 outline-none border border-transparent focus:border-primary/50 capitalize"
            >
              {RELATIONSHIP_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <button
              onClick={() => update("family_members", data.family_members.filter((_, i) => i !== idx))}
              className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => update("family_members", [...(data.family_members || []), { name: "", relationship_type: "mother" }])}
        className="w-full flex items-center gap-2 justify-center py-3 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-sm"
      >
        <Plus className="w-4 h-4" /> Add family member
      </button>
      {!familyExtracted && (data.family_members || []).length === 0 && !(data.background || data.personality_override || data.situation_override) && (
        <p className="text-xs text-muted-foreground text-center italic">No family added — character will have no family in their world.</p>
      )}
    </div>,

    // Step 8: Memories
    <div key="memories" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">What have they been through?</h2>
        <p className="text-xs text-muted-foreground mb-1">Pick the types of experiences that shaped them.</p>
        <p className="text-xs text-muted-foreground/60 mb-4">The AI will write the actual memories — specific, named, real-feeling scenes — when you create. Skip this step and they'll still get a full past.</p>
      </div>
      {data.memories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {data.memories.map(m => (
            <div key={m.title} className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-1.5">
              <span className="text-xs font-medium text-primary">{m.title}</span>
              <button onClick={() => removeMemory(m.title)} className="text-primary/50 hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {MEMORY_PRESETS.filter(p => !data.memories.find(m => m.title === p.title)).map(preset => (
          <button key={preset.title} onClick={() => addPresetMemory(preset)} className="w-full text-left p-3 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
            <p className="text-sm font-medium text-foreground">{preset.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
          </button>
        ))}
      </div>
      {showMemoryForm ? (
        <div className="space-y-2 border border-border rounded-xl p-3">
          <Input value={newMemory.title} onChange={e => setNewMemory(prev => ({ ...prev, title: e.target.value }))} placeholder="Describe the experience type..." className="h-10 rounded-lg text-sm" />
          <Textarea value={newMemory.description} onChange={e => setNewMemory(prev => ({ ...prev, description: e.target.value }))} placeholder="Any specific details to include? (optional)" className="rounded-lg min-h-[70px] text-sm resize-none" />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowMemoryForm(false); setNewMemory({ title: "", description: "" }); }} className="flex-1 rounded-lg">Cancel</Button>
            <Button size="sm" onClick={addCustomMemory} disabled={!newMemory.title.trim()} className="flex-1 rounded-lg">Add theme</Button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowMemoryForm(true)} className="w-full flex items-center gap-2 justify-center py-3 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-sm">
          <Plus className="w-4 h-4" /> Add a custom experience
        </button>
      )}
    </div>,

    // Step 8: Relationship levels (index 8)
    <RelationshipStep
      key="relationship"
      data={data}
      onChange={(field, value) => update(field, value)}
    />,

    // Step 8.5: Religion & Belief
    <ReligionStep
      key="religion"
      data={data}
      onChange={(field, value) => update(field, value)}
    />,

    // Step: Traits & Quirks
    <CharacterTraitsStep
      key="traits"
      data={data}
      onChange={(key, value) => update(key, value)}
    />,

    // Step 9: Voice Settings
    <div key="voice" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Voice Settings (Optional)</h2>
        <p className="text-xs text-muted-foreground mb-4">Give this character a voice. You can change this later.</p>
      </div>
      <VoiceSettings data={data} onUpdate={update} hasApiKey={hasApiKey} />
    </div>,

    // Step 9: Photo
    <div key="photo" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Photo</h2>
        <p className="text-xs text-muted-foreground mb-1">Upload real photos to generate a consistent avatar, or let AI create one from their description.</p>
      </div>

      {/* AI Generate option */}
      <div className="border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-medium text-foreground uppercase tracking-wider">Generate from description</p>
        {avatarUrl && !referenceUrls.length ? (
          <div className="flex flex-col items-center gap-3">
            <img src={avatarUrl} alt="Generated avatar" className="w-28 h-28 rounded-full object-cover ring-2 ring-primary/40" />
            <button
              onClick={async () => {
                setAvatarUrl(null);
                saveDraft(data, step, null, referenceUrls);
              }}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            disabled={isGeneratingAvatar}
            onClick={async () => {
              setIsGeneratingAvatar(true);
              const ethnicityPart = data.ethnicities.length > 0 ? `${data.ethnicities.join(" and ")} descent, clearly reflecting their cultural background` : "";
              const prompt = `Portrait photo of a real person. ${data.age_range || "adult"} ${ethnicityPart ? ethnicityPart + "." : ""} Gender: ${data.gender || "person"}. ${data.vibes.join(", ")} energy. ${data.archetype ? data.archetype + " personality." : ""} Natural lighting, realistic, photographic, candid feel. Not a model, a real everyday person.\n\n📸 STYLE DIRECTIVE: Photorealistic, cinematic, ultra-detailed, high-resolution professional photography. RAW photo quality. Natural lighting. No illustrations or artistic renderings — this must look like a real photograph. CRITICAL: Not an illustration, not a painting, not a digital render, not uncanny valley, natural skin texture, real human proportions.`;
              const result = await base44.integrations.Core.GenerateImage({ prompt });
              setAvatarUrl(result.url);
              setReferenceUrls([]);
              saveDraft(data, step, result.url, []);
              setIsGeneratingAvatar(false);
            }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {isGeneratingAvatar ? "Generating..." : "Generate AI Avatar"}
          </button>
        )}
        <p className="text-xs text-muted-foreground">Uses gender, age, cultural background, and personality vibes.</p>
      </div>

      {/* Upload option */}
      <div className="border border-border rounded-2xl p-4 space-y-3">
        <p className="text-xs font-medium text-foreground uppercase tracking-wider">Upload reference photos</p>
        <ReferencePhotoUploader
          descriptor={`a ${data.age_range} ${data.ethnicities.join(" / ")} ${data.gender?.toLowerCase()}, ${data.vibes.join(", ")} personality`}
          onAvatarGenerated={(url, refs) => { setAvatarUrl(url); setReferenceUrls(refs); saveDraft(data, step, url, refs); }}
          existingReferenceUrls={referenceUrls}
          existingAvatarUrl={referenceUrls.length > 0 ? avatarUrl : null}
        />
      </div>
    </div>,
  ];

  const canNext = [
    data.first_name.trim() && data.last_name.trim() && data.gender && data.age_range, // 0: basic
    data.ethnicities.length > 0 && data.living_situation, // 1: background
    true, // 2: work optional
    true, // 3: connections optional
    data.archetype && data.social_energy, // 4: archetype required
    data.vibes.length > 0, // 5: vibes+backstory
    true, // 6: family optional
    true, // 7: memories optional
    true, // 8: relationship optional
    true, // 9: religion optional
    true, // 10: traits optional
    true, // 11: voice optional
    true, // 12: photo optional
  ][step];

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/home")} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></button>
        <h2 className="text-sm font-semibold">Create Character</h2>
        <div className="ml-auto flex items-center gap-1">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : i < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-border"}`} />
          ))}
        </div>
      </div>
      <div className="max-w-lg mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            {steps[step]}
          </motion.div>
        </AnimatePresence>
        <div className="flex gap-3 mt-8">
          {step > 0 && (
            <Button variant="outline" onClick={() => { const s = step - 1; setStep(s); saveDraft(data, s, avatarUrl, referenceUrls); }} className="flex-1 h-12 rounded-xl">Back</Button>
          )}
          {step < steps.length - 1 ? (
            <Button onClick={() => { const s = step + 1; setStep(s); saveDraft(data, s, avatarUrl, referenceUrls); }} disabled={!canNext} className="flex-1 h-12 rounded-xl gap-2">
              Next <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={isCreating || (!canCreateCharacter && !isAdmin)} className="flex-1 h-12 rounded-xl">
              {isCreating ? "Creating..." : !canCreateCharacter && !isAdmin ? "Max 4 characters reached" : "Create Character"}
            </Button>
          )}
        </div>
        {step === 0 && (
          <div className="mt-3">
            <Button
              variant="outline"
              onClick={handleRandomCreate}
              disabled={isRandomCreating || (!canCreateCharacter && !isAdmin)}
              className="w-full h-12 rounded-xl gap-2 border-dashed text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              {isRandomCreating ? "Generating character..." : "Random — create someone automatically"}
            </Button>
            {isRandomCreating && (
              <p className="text-[11px] text-muted-foreground text-center mt-2">Generating a full character with avatar, memories, and personality...</p>
            )}
          </div>
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}