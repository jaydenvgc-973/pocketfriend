import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";

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

const SEXUAL_ORIENTATIONS = [
  "Straight", "Gay", "Bisexual", "Pansexual", "Queer", "Asexual", "Prefer not to say"
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

const defaultData = {
  name: "",
  gender: "",
  age_range: "",
  ethnicity: "",
  living_situation: "",
  vibes: [],
  background: "",
  archetype: "",
  social_energy: "",
  sexual_orientation: "",
  memories: [],
};

function loadDraft() {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
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

  const saveDraft = (newData, newStep, newAvatarUrl, newReferenceUrls) => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      data: newData,
      step: newStep,
      avatarUrl: newAvatarUrl,
      referenceUrls: newReferenceUrls,
    }));
  };

  const update = (field, value) => setData(prev => {
    const next = { ...prev, [field]: value };
    saveDraft(next, step, avatarUrl, referenceUrls);
    return next;
  });

  const toggleVibe = (v) => setData(prev => {
    const next = {
      ...prev,
      vibes: prev.vibes.includes(v) ? prev.vibes.filter(x => x !== v) : prev.vibes.length < 4 ? [...prev.vibes, v] : prev.vibes
    };
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
    const personality = await base44.integrations.Core.InvokeLLM({
      prompt: `Create a personality summary (2-3 sentences, first person perspective, raw and real) for a character with these traits: ${data.age_range} ${data.ethnicity} ${data.gender}. Archetype: ${data.archetype}. Social energy: ${data.social_energy}. Vibes: ${data.vibes.join(", ")}. Living situation: ${data.living_situation}. Background: ${data.background || "not specified"}. Make it feel like a real person, not a description.`
    });

    const charData = {
      name: data.name,
      gender: data.gender?.toLowerCase(),
      archetype: data.archetype || undefined,
      social_energy: data.social_energy || undefined,
      sexual_orientation: (data.sexual_orientation && data.sexual_orientation !== "Prefer not to say") ? data.sexual_orientation : undefined,
      personality_summary: personality,
      personality_traits: data.vibes,
      communication_style: `${data.vibes.join(", ")} communication style. Real, unpolished speech.`,
      background_story: data.background || `${data.age_range} ${data.ethnicity} ${data.gender?.toLowerCase()}. ${data.living_situation}.`,
      current_situation: data.living_situation,
      emotional_state: "calm",
      avatar_url: avatarUrl || null,
      reference_image_urls: referenceUrls.length > 0 ? referenceUrls : undefined,
      memories: data.memories.length > 0 ? data.memories : undefined,
    };
    charData.system_prompt = buildSystemPrompt(charData);

    await base44.entities.Character.create(charData);
    localStorage.removeItem(DRAFT_KEY);
    navigate("/home");
  };

  const chipClass = (selected) =>
    `py-2.5 px-3 rounded-xl text-sm border transition-colors text-left cursor-pointer ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`;

  const steps = [
    // Step 0: Basic info
    <div key="basic" className="space-y-5">
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Name</label>
        <Input value={data.name} onChange={e => update("name", e.target.value)} placeholder="What's their name?" className="h-12 rounded-xl text-base" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Gender</label>
        <div className="grid grid-cols-3 gap-2">
          {GENDERS.map(g => (
            <button key={g} onClick={() => update("gender", g)} className={chipClass(data.gender === g)}>{g}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Age Range</label>
        <div className="grid grid-cols-3 gap-2">
          {AGES.map(a => (
            <button key={a} onClick={() => update("age_range", a)} className={chipClass(data.age_range === a)}>{a}</button>
          ))}
        </div>
      </div>
    </div>,

    // Step 1: Background
    <div key="background" className="space-y-5">
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Ethnicity / Background</label>
        <div className="grid grid-cols-2 gap-2">
          {ETHNICITIES.map(e => (
            <button key={e} onClick={() => update("ethnicity", e)} className={chipClass(data.ethnicity === e)}>{e}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Living Situation</label>
        <div className="grid grid-cols-2 gap-2">
          {LIVING.map(l => (
            <button key={l} onClick={() => update("living_situation", l)} className={chipClass(data.living_situation === l)}>{l}</button>
          ))}
        </div>
      </div>
    </div>,

    // Step 2: Archetype + social energy + orientation
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
        <p className="text-xs text-muted-foreground mb-3">Introvert, extrovert, or somewhere in between?</p>
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
          {SEXUAL_ORIENTATIONS.map(o => (
            <button key={o} onClick={() => update("sexual_orientation", o)} className={chipClass(data.sexual_orientation === o)}>{o}</button>
          ))}
        </div>
      </div>
    </div>,

    // Step 3: Vibes + backstory
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
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Backstory (optional)</label>
        <Textarea
          value={data.background}
          onChange={e => update("background", e.target.value)}
          placeholder="Anything specific about their past, job, family..."
          className="rounded-xl min-h-[100px] text-sm resize-none"
        />
      </div>
    </div>,

    // Step 4: Memories
    <div key="memories" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Core Memories</h2>
        <p className="text-xs text-muted-foreground mb-4">
          These shape how they think, react, and what they carry. Pick from the presets or write your own — the more real these are, the more real they'll feel in conversation.
        </p>
      </div>

      {/* Selected memories */}
      {data.memories.length > 0 && (
        <div className="space-y-2">
          {data.memories.map(m => (
            <div key={m.title} className="flex items-start gap-2 bg-primary/10 border border-primary/20 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{m.title}</p>
                {m.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{m.description}</p>}
              </div>
              <button onClick={() => removeMemory(m.title)} className="text-muted-foreground hover:text-destructive flex-shrink-0 mt-0.5"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Presets */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Pick from presets</p>
        <div className="space-y-2">
          {MEMORY_PRESETS.filter(p => !data.memories.find(m => m.title === p.title)).map(preset => (
            <button key={preset.title} onClick={() => addPresetMemory(preset)}
              className="w-full text-left p-3 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
              <p className="text-sm font-medium text-foreground">{preset.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Custom memory */}
      {showMemoryForm ? (
        <div className="space-y-2 border border-border rounded-xl p-3">
          <Input
            value={newMemory.title}
            onChange={e => setNewMemory(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Memory title..."
            className="h-10 rounded-lg text-sm"
          />
          <Textarea
            value={newMemory.description}
            onChange={e => setNewMemory(prev => ({ ...prev, description: e.target.value }))}
            placeholder="What happened? How did it affect them? (optional)"
            className="rounded-lg min-h-[80px] text-sm resize-none"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowMemoryForm(false); setNewMemory({ title: "", description: "" }); }} className="flex-1 rounded-lg">Cancel</Button>
            <Button size="sm" onClick={addCustomMemory} disabled={!newMemory.title.trim()} className="flex-1 rounded-lg">Add</Button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowMemoryForm(true)} className="w-full flex items-center gap-2 justify-center py-3 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-sm">
          <Plus className="w-4 h-4" /> Write your own memory
        </button>
      )}
    </div>,

    // Step 5: Pick a photo
    <div key="photo" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Photo</h2>
        <p className="text-xs text-muted-foreground mb-4">Upload real photos of the character to generate a consistent avatar, or skip.</p>
      </div>
      <ReferencePhotoUploader
        descriptor={`a ${data.age_range} ${data.ethnicity} ${data.gender?.toLowerCase()}, ${data.vibes.join(", ")} personality`}
        onAvatarGenerated={(url, refs) => { setAvatarUrl(url); setReferenceUrls(refs); saveDraft(data, step, url, refs); }}
        existingReferenceUrls={referenceUrls}
        existingAvatarUrl={avatarUrl}
      />
    </div>,
  ];

  const canNext = [
    data.name.trim() && data.gender && data.age_range,
    data.ethnicity && data.living_situation,
    data.archetype && data.social_energy,   // archetype + energy required
    data.vibes.length > 0,
    true, // memories optional
    true, // photo optional
  ][step];

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
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
    </div>
  );
}