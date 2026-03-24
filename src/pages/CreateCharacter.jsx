import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus, X, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import RelationshipStep from "@/components/character/RelationshipStep";

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

const SEXUAL_ORIENTATIONS = ["Straight", "Gay", "Bisexual", "Pansexual", "Queer", "Asexual", "Prefer not to say"];

const JOB_TYPES = [
  "Retail / Customer Service", "Food Service / Restaurant", "Healthcare / Medical",
  "Corporate / Office", "Education / Teaching", "Creative / Arts", "Tech / Software",
  "Trades / Construction", "Freelance / Self-employed", "Student", "Between jobs"
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

const RELATIONSHIP_TYPES = [
  "mother","father","grandmother","grandfather","great-grandmother","great-grandfather",
  "aunt","uncle","sister","brother","half-sister","half-brother","step-mother","step-father",
  "step-sister","step-brother","cousin","niece","nephew","daughter","son","other",
];

const defaultData = {
  first_name: "", middle_name: "", last_name: "",
  gender: "", age_range: "", ethnicities: [], living_situation: "",
  city: "", state: "",
  vibes: [], background: "", archetype: "", social_energy: "", sexual_orientation: "",
  personality_override: "", situation_override: "",
  memories: [],
  job_title: "", workplace_type: "", work_environment: "",
  frequented_places: [],
  known_character_ids: [],
  family_members: [],
  birthday: "",
  user_respect_level: 50,
  friendship_level: 75,
  romantic_level: 0,
  attraction_level: 0,
  chosen_family_level: 0,
};

function loadDraft() {
  try { const s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

export default function CreateCharacter() {
  const navigate = useNavigate();
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

  const { data: existingCharacters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

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
    const next = { ...prev, known_character_ids: prev.known_character_ids.includes(id) ? prev.known_character_ids.filter(x => x !== id) : [...prev.known_character_ids, id] };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const generateName = async () => {
    setIsGeneratingName(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Generate a realistic name for a ${data.age_range || "adult"} ${data.ethnicities.join(" / ") || ""} ${data.gender || "person"}. Return ONLY a JSON object with fields: first_name, middle_name (can be empty string), last_name. No explanation.`,
      response_json_schema: { type: "object", properties: { first_name: { type: "string" }, middle_name: { type: "string" }, last_name: { type: "string" } } }
    });
    setData(prev => {
      const next = { ...prev, first_name: result.first_name || "", middle_name: result.middle_name || "", last_name: result.last_name || "" };
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

  const generateSituation = async () => {
    setIsGeneratingSituation(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Describe in 2-3 sentences what's currently going on in the life of a ${data.age_range || "adult"} ${data.gender || "person"} who works in ${data.workplace_type || "some field"} as a ${data.job_title || "worker"} and ${data.living_situation || "lives somewhere"}. Make it feel like a real slice of life — something they're dealing with, adjusting to, or navigating right now. Casual tone, third person, no drama clichés. IMPORTANT: Do NOT use any specific names — use generic terms only (e.g. "their roommate", "a coworker", "their landlord").`
    });
    update("situation_override", result);
    setIsGeneratingSituation(false);
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

  const removeMemory = (title) => update("memories", data.memories.filter(m => m.title !== title));

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const fullName = [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(" ");
      const ethnicityStr = data.ethnicities.join(" / ");

      // Build known-characters context for the prompt
      const knownChars = existingCharacters.filter(c => data.known_character_ids.includes(c.id));
      const knownContext = knownChars.length > 0
        ? `They personally know these people: ${knownChars.map(c => `${c.name} (${c.personality_summary?.split(".")[0] || ""})`).join("; ")}.`
        : "";

      const charProfile = `Name: ${fullName}. Age: ${data.age_range}. Background: ${ethnicityStr}. Gender: ${data.gender}. Archetype: ${data.archetype}. Social energy: ${data.social_energy}. Vibes: ${data.vibes.join(", ")}. Living situation: ${data.living_situation}. Job: ${data.job_title || "not specified"} at a ${data.workplace_type || "workplace"}. Background story: ${data.background || "not specified"}. ${knownContext}`;

      // Run personality + memory generation in parallel
      const memoryThemes = data.memories.length > 0
        ? data.memories.map(m => `"${m.title}": ${m.description}`).join("; ")
        : "first heartbreak, a betrayal, a moment of unexpected loss or failure, a win that proved something, a secret";

      const personalityOverrideNote = data.personality_override
        ? ` IMPORTANT: The creator also wrote this about them directly — incorporate this and let it shape the result: "${data.personality_override}"`
        : "";

      const [personality, generatedMemories] = await Promise.all([
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
        })
      ]);

      const finalMemories = generatedMemories?.memories?.length > 0
        ? generatedMemories.memories
        : data.memories.length > 0 ? data.memories : undefined;

      const charData = {
        name: fullName,
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
        avatar_url: avatarUrl || null,
        reference_image_urls: referenceUrls.length > 0 ? referenceUrls : undefined,
        birthday: data.birthday || undefined,
        memories: finalMemories,
        work_details: (data.job_title || data.workplace_type) ? {
          job_title: data.job_title,
          workplace_type: data.workplace_type,
          work_environment: data.work_environment,
        } : undefined,
        frequented_places: data.frequented_places.length > 0 ? data.frequented_places : undefined,
        family_members: (data.family_members || []).filter(m => m.name.trim()).length > 0 ? data.family_members.filter(m => m.name.trim()) : [],
        city: data.city || undefined,
        state: data.state || undefined,
        user_respect_level: data.user_respect_level,
        friendship_level: data.friendship_level,
        romantic_level: data.romantic_level,
        attraction_level: data.attraction_level,
        chosen_family_level: data.chosen_family_level,
        status: "active",
        is_finalized: true,
      };
      charData.system_prompt = buildSystemPrompt(charData, knownChars);

      await base44.entities.Character.create(charData);
      localStorage.removeItem(DRAFT_KEY);
      navigate("/home");
    } catch (error) {
      setIsCreating(false);
      alert("Failed to create character. Please check your connection and try again.");
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
          {AGES.map(a => <button key={a} onClick={() => update("age_range", a)} className={chipClass(data.age_range === a)}>{a}</button>)}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Birthday (optional)</label>
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
        <Input value={data.job_title} onChange={e => update("job_title", e.target.value)} placeholder="Specific job title (e.g. cashier, nurse, designer)" className="h-11 rounded-xl text-sm" />
        <Textarea value={data.work_environment} onChange={e => update("work_environment", e.target.value)} placeholder="Describe the work environment... (optional)" className="rounded-xl mt-2 min-h-[70px] text-sm resize-none" />
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
            const selected = data.known_character_ids.includes(char.id);
            return (
              <button
                key={char.id}
                onClick={() => toggleKnownCharacter(char.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${selected ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/30"}`}
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
            );
          })}
        </div>
      )}
      {data.known_character_ids.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Knows {data.known_character_ids.length} character{data.known_character_ids.length > 1 ? "s" : ""}
        </p>
      )}
    </div>,

    // Step 4: Family members
    <div key="family" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Family members</h2>
        <p className="text-xs text-muted-foreground mb-4">Add anyone in their family. Leave blank if they have none — this is the definitive list the character will know.</p>
      </div>
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
      {(data.family_members || []).length === 0 && (
        <p className="text-xs text-muted-foreground text-center italic">No family added — character will have no family in their world.</p>
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
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Sexual Orientation (optional)</label>
        <div className="grid grid-cols-2 gap-2">
          {SEXUAL_ORIENTATIONS.map(o => <button key={o} onClick={() => update("sexual_orientation", o)} className={chipClass(data.sexual_orientation === o)}>{o}</button>)}
        </div>
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

    // Step 7: Memories
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

    // Step 8: Relationship levels
    <RelationshipStep
      key="relationship"
      data={data}
      onChange={(field, value) => update(field, value)}
    />,

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
              const prompt = `Portrait photo of a real person. ${data.age_range || "adult"} ${ethnicityPart ? ethnicityPart + "." : ""} Gender: ${data.gender || "person"}. ${data.vibes.join(", ")} energy. ${data.archetype ? data.archetype + " personality." : ""} Natural lighting, realistic, photographic, candid feel. Not a model, a real everyday person.`;
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
    data.first_name.trim() && data.last_name.trim() && data.gender && data.age_range,
    data.ethnicities.length > 0 && data.living_situation,
    true, // work optional
    true, // connections optional
    true, // family optional
    data.archetype && data.social_energy,
    data.vibes.length > 0,
    true, // memories optional
    true, // relationship optional
    true, // photo optional
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
            <Button onClick={handleCreate} disabled={isCreating} className="flex-1 h-12 rounded-xl">
              {isCreating ? "Creating..." : "Create Character"}
            </Button>
          )}
        </div>
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}