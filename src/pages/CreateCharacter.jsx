import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Sparkles, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { buildSystemPrompt } from "@/lib/defaultCharacter";

const ETHNICITIES = ["Black / African American", "Latino / Hispanic", "White / Caucasian", "Asian", "Middle Eastern", "Mixed / Multiracial", "Other"];
const GENDERS = ["Male", "Female", "Non-binary"];
const AGES = ["Early 20s", "Mid 20s", "Late 20s", "Early 30s", "Mid 30s", "Late 30s", "40s+"];
const LIVING = ["Lives alone", "Lives with roommates", "Lives with partner", "Lives with family", "Between places"];
const VIBES = ["Laid back", "Intense", "Sarcastic", "Warm", "Blunt", "Mysterious", "Chaotic", "Grounded"];

export default function CreateCharacter() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState(null);

  const [data, setData] = useState({
    name: "",
    gender: "",
    age_range: "",
    ethnicity: "",
    living_situation: "",
    vibes: [],
    background: "",
    personality_summary: "",
  });

  const update = (field, value) => setData(prev => ({ ...prev, [field]: value }));
  const toggleVibe = (v) => setData(prev => ({
    ...prev,
    vibes: prev.vibes.includes(v) ? prev.vibes.filter(x => x !== v) : prev.vibes.length < 4 ? [...prev.vibes, v] : prev.vibes
  }));

  const generateImages = async () => {
    setIsGeneratingImages(true);
    setGeneratedImages([]);
    const prompt = `Realistic portrait photo of a ${data.age_range} ${data.ethnicity} ${data.gender?.toLowerCase()}, ${data.vibes.join(", ")} personality, ${data.living_situation?.toLowerCase()}. Candid, natural lighting, authentic. Not a stock photo.`;
    const results = await Promise.all([
      base44.integrations.Core.GenerateImage({ prompt }),
      base44.integrations.Core.GenerateImage({ prompt: prompt + " Street style, urban setting." }),
      base44.integrations.Core.GenerateImage({ prompt: prompt + " Indoor, relaxed at home." }),
    ]);
    setGeneratedImages(results.map(r => r.url));
    setIsGeneratingImages(false);
  };

  const handleCreate = async () => {
    setIsCreating(true);
    const personality = await base44.integrations.Core.InvokeLLM({
      prompt: `Create a personality summary (2-3 sentences, first person perspective, raw and real) for a character with these traits: ${data.age_range} ${data.ethnicity} ${data.gender}. Vibes: ${data.vibes.join(", ")}. Living situation: ${data.living_situation}. Background: ${data.background || "not specified"}. Make it feel like a real person, not a description.`
    });

    const charData = {
      name: data.name,
      gender: data.gender?.toLowerCase(),
      personality_summary: personality,
      personality_traits: data.vibes,
      communication_style: `${data.vibes.join(", ")} communication style. Real, unpolished speech.`,
      background_story: data.background || `${data.age_range} ${data.ethnicity} ${data.gender?.toLowerCase()}. ${data.living_situation}.`,
      current_situation: data.living_situation,
      emotional_state: "calm",
      avatar_url: selectedImageUrl || null,
    };
    charData.system_prompt = buildSystemPrompt(charData);

    await base44.entities.Character.create(charData);
    navigate("/home");
  };

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
            <button key={g} onClick={() => update("gender", g)} className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${data.gender === g ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground"}`}>{g}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Age Range</label>
        <div className="grid grid-cols-3 gap-2">
          {AGES.map(a => (
            <button key={a} onClick={() => update("age_range", a)} className={`py-2.5 rounded-xl text-sm border transition-colors ${data.age_range === a ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground"}`}>{a}</button>
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
            <button key={e} onClick={() => update("ethnicity", e)} className={`py-2.5 px-3 rounded-xl text-sm border transition-colors text-left ${data.ethnicity === e ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground"}`}>{e}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Living Situation</label>
        <div className="grid grid-cols-2 gap-2">
          {LIVING.map(l => (
            <button key={l} onClick={() => update("living_situation", l)} className={`py-2.5 px-3 rounded-xl text-sm border transition-colors text-left ${data.living_situation === l ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground"}`}>{l}</button>
          ))}
        </div>
      </div>
    </div>,

    // Step 2: Vibes + backstory
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

    // Step 3: Pick a photo
    <div key="photo" className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-3">Generate photos based on their description, or skip.</p>
        <Button onClick={generateImages} disabled={isGeneratingImages} variant="outline" className="w-full rounded-xl gap-2">
          {isGeneratingImages ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate photos</>}
        </Button>
      </div>
      {generatedImages.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {generatedImages.map((url, i) => (
            <div key={i} onClick={() => setSelectedImageUrl(selectedImageUrl === url ? null : url)} className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${selectedImageUrl === url ? "border-primary" : "border-transparent"}`}>
              <img src={url} alt={`option ${i + 1}`} className="w-full h-full object-cover" />
              {selectedImageUrl === url && (
                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                  <Check className="w-6 h-6 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {generatedImages.length > 0 && (
        <Button onClick={generateImages} disabled={isGeneratingImages} variant="ghost" size="sm" className="w-full gap-2 text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" /> Regenerate
        </Button>
      )}
      <p className="text-xs text-muted-foreground text-center">Or skip — they'll use initials instead</p>
    </div>,
  ];

  const canNext = [
    data.name.trim() && data.gender && data.age_range,
    data.ethnicity && data.living_situation,
    data.vibes.length > 0,
    true, // photo is optional
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
            <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 h-12 rounded-xl">Back</Button>
          )}
          {step < steps.length - 1 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canNext} className="flex-1 h-12 rounded-xl gap-2">
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