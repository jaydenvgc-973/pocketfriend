import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { calculateBirthdateFromZodiac } from "@/lib/zodiacUtils";

const ZODIAC_SIGNS = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"];
const AGE_RANGES = ["Early 20s", "Mid 20s", "Late 20s", "Early 30s", "Mid 30s", "Late 30s", "40s+"];
const GENDERS = ["male", "female", "non-binary", "other"];
const ETHNICITIES = ["African", "Asian", "Caucasian", "Hispanic", "Middle Eastern", "Pacific Islander", "South Asian", "Mixed"];
const ORIENTATIONS = ["Straight", "Gay", "Gay (DL)", "Bisexual", "Bisexual (DL)", "Pansexual", "Queer", "Asexual", "Prefer not to say"];

export default function EditCharacterStory() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [form, setForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email }, "-created_date")
      : [],
    enabled: !!currentUser?.email,
  });

  const editableChars = characters.filter(c => !c.is_default && c.status !== "deleted");

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;

  const handleSelect = (char) => {
    setSelectedChar(char);
    setForm({
      background_story: char.background_story || "",
      current_situation: char.current_situation || "",
      family_history: char.family_history || "",
      emotional_baggage: char.emotional_baggage || "",
      age_range: char.age_range || "",
      zodiac_sign: char.zodiac_sign || "",
      birthday: char.birthday || "",
      personality_notes: char.personality_summary || "",
      appearance_notes: char.appearance_notes || "",
      gender: char.gender || "",
      ethnicities: char.ethnicities || [],
      sexual_orientation: char.sexual_orientation || "",
      cultural_backgrounds: char.cultural_backgrounds || "",
      voice_enabled: char.voice_enabled || false,
      voice_name: char.voice_name || "",
      voice_style_note: char.voice_style_note || "",
    });
    setSaved(false);
  };

  const handleZodiacChange = (zodiac) => {
    const newForm = { ...form, zodiac_sign: zodiac };
    // Auto-generate birthday if zodiac and age_range are set and birthday is empty
    if (zodiac && form.age_range && !form.birthday) {
      const generated = calculateBirthdateFromZodiac(zodiac, form.age_range);
      if (generated) newForm.birthday = generated;
    }
    setForm(newForm);
  };

  const handleAgeRangeChange = (ageRange) => {
    const newForm = { ...form, age_range: ageRange };
    // Auto-generate birthday if zodiac and age_range are set and birthday is empty
    if (form.zodiac_sign && ageRange && !form.birthday) {
      const generated = calculateBirthdateFromZodiac(form.zodiac_sign, ageRange);
      if (generated) newForm.birthday = generated;
    }
    setForm(newForm);
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setIsSaving(true);
    const merged = { ...selectedChar, ...form };

    // Use user-edited personality notes directly if changed, otherwise re-generate from story
    let personality;
    if (form.personality_notes.trim() && form.personality_notes.trim() !== (selectedChar.personality_summary || "").trim()) {
      personality = form.personality_notes.trim();
    } else {
      personality = await base44.integrations.Core.InvokeLLM({
        prompt: `Create a personality summary (2-3 sentences, raw and real, written in third person) based on this character's updated profile.
Name: ${merged.name}. Age: ${merged.age_range || "adult"}. Gender: ${merged.gender || "person"}.
Background story: ${merged.background_story || "not specified"}.
Current situation: ${merged.current_situation || "not specified"}.
Emotional baggage: ${merged.emotional_baggage || "not specified"}.
Existing personality traits: ${(merged.personality_traits || []).join(", ") || "not specified"}.
Make it feel like a real person, not a description. No flowery language.`
      });
    }

    merged.personality_summary = personality;
    const systemPrompt = buildSystemPrompt(merged);

    // Upload system prompt if it's too large
    let systemPromptUrl = null;
    if (systemPrompt.length > 5000) {
      const uploadRes = await base44.integrations.Core.UploadFile({
        file: new File([systemPrompt], "system_prompt.txt", { type: "text/plain" })
      });
      systemPromptUrl = uploadRes.file_url;
    }

    const { personality_notes, ...formWithoutNotes } = form;
    const updateData = {
      ...formWithoutNotes,
      personality_summary: personality,
      appearance_notes: form.appearance_notes,
      gender: form.gender,
      ethnicities: form.ethnicities,
      sexual_orientation: form.sexual_orientation,
      cultural_backgrounds: form.cultural_backgrounds,
      voice_enabled: form.voice_enabled,
      voice_name: form.voice_name,
      voice_style_note: form.voice_style_note,
    };

    // Only include system_prompt if it's under size limit
    if (systemPromptUrl) {
      updateData.system_prompt_url = systemPromptUrl;
    } else {
      updateData.system_prompt = systemPrompt;
    }

    await base44.entities.Character.update(selectedChar.id, updateData);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        {selectedChar ? (
          <button onClick={() => setSelectedChar(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <Link to="/settings" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <h2 className="text-sm font-semibold">
          {selectedChar ? `Edit Story — ${selectedChar.name}` : "Edit Character Story"}
        </h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {!selectedChar ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a character to edit their story.</p>
            {editableChars.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No custom characters yet.</p>
            )}
            {editableChars.map(char => (
              <button
                key={char.id}
                onClick={() => handleSelect(char)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left"
              >
                <CharacterAvatar character={char} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{char.personality_summary?.split(".")[0]}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Age Range</label>
              <select
                value={form.age_range}
                onChange={e => handleAgeRangeChange(e.target.value)}
                className="w-full h-9 px-3 py-1 rounded-md border border-input bg-transparent text-sm"
              >
                <option value="">Select age range...</option>
                {AGE_RANGES.map(age => (
                  <option key={age} value={age}>{age}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Zodiac Sign</label>
              <select
                value={form.zodiac_sign}
                onChange={e => handleZodiacChange(e.target.value)}
                className="w-full h-9 px-3 py-1 rounded-md border border-input bg-transparent text-sm"
              >
                <option value="">Select zodiac...</option>
                {ZODIAC_SIGNS.map(sign => (
                  <option key={sign} value={sign}>{sign.charAt(0).toUpperCase() + sign.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Birthday (YYYY-MM-DD)</label>
              <Input
                type="date"
                value={form.birthday}
                onChange={e => setForm(p => ({ ...p, birthday: e.target.value }))}
                className="rounded-xl text-sm"
              />
              {form.zodiac_sign && form.age_range && !form.birthday && (
                <p className="text-[11px] text-muted-foreground">Will auto-generate from zodiac + age when saved if left empty.</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Personality Notes</label>
              <Textarea
                value={form.personality_notes}
                onChange={e => setForm(p => ({ ...p, personality_notes: e.target.value }))}
                placeholder="A short description of who they are — tone, vibe, how they carry themselves..."
                className="rounded-xl min-h-[90px] text-sm resize-none"
              />
              <p className="text-[11px] text-muted-foreground">Edit directly or leave unchanged to auto-regenerate from story fields.</p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gender</label>
              <select
                value={form.gender}
                onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}
                className="w-full h-9 px-3 py-1 rounded-md border border-input bg-transparent text-sm"
              >
                <option value="">Select gender...</option>
                {GENDERS.map(g => (
                  <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ethnicities</label>
              <div className="space-y-2">
                {ETHNICITIES.map(eth => (
                  <label key={eth} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.ethnicities.includes(eth)}
                      onChange={e => {
                        const updated = e.target.checked
                          ? [...form.ethnicities, eth]
                          : form.ethnicities.filter(e => e !== eth);
                        setForm(p => ({ ...p, ethnicities: updated }));
                      }}
                      className="rounded border border-input"
                    />
                    {eth}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sexual Orientation</label>
              <select
                value={form.sexual_orientation}
                onChange={e => setForm(p => ({ ...p, sexual_orientation: e.target.value }))}
                className="w-full h-9 px-3 py-1 rounded-md border border-input bg-transparent text-sm"
              >
                <option value="">Select orientation...</option>
                {ORIENTATIONS.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Appearance Notes</label>
              <Textarea
                value={form.appearance_notes}
                onChange={e => setForm(p => ({ ...p, appearance_notes: e.target.value }))}
                placeholder="Hair, tattoos, piercings, distinctive features, style..."
                className="rounded-xl min-h-[90px] text-sm resize-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cultural Backgrounds</label>
              <Textarea
                value={form.cultural_backgrounds}
                onChange={e => setForm(p => ({ ...p, cultural_backgrounds: e.target.value }))}
                placeholder="Cultural heritage, traditions, languages spoken, beliefs..."
                className="rounded-xl min-h-[90px] text-sm resize-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Background Story</label>
              <Textarea
                value={form.background_story}
                onChange={e => setForm(p => ({ ...p, background_story: e.target.value }))}
                placeholder="Their past, upbringing, where they came from..."
                className="rounded-xl min-h-[120px] text-sm resize-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Situation</label>
              <Textarea
                value={form.current_situation}
                onChange={e => setForm(p => ({ ...p, current_situation: e.target.value }))}
                placeholder="What's going on in their life right now..."
                className="rounded-xl min-h-[100px] text-sm resize-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Family History</label>
              <Textarea
                value={form.family_history}
                onChange={e => setForm(p => ({ ...p, family_history: e.target.value }))}
                placeholder="Family background, dynamics, key relationships..."
                className="rounded-xl min-h-[100px] text-sm resize-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Emotional Baggage</label>
              <Textarea
                value={form.emotional_baggage}
                onChange={e => setForm(p => ({ ...p, emotional_baggage: e.target.value }))}
                placeholder="What they carry, trust issues, wounds, patterns..."
                className="rounded-xl min-h-[100px] text-sm resize-none"
              />
            </div>
            <div className="pt-4 border-t border-border">
              <VoiceSettings 
                data={form} 
                onUpdate={(field, value) => setForm(p => ({ ...p, [field]: value }))} 
                hasApiKey={hasApiKey}
                character={selectedChar}
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full h-12 rounded-xl gap-2"
            >
              {saved ? <><Check className="w-4 h-4" /> Saved</> : isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}