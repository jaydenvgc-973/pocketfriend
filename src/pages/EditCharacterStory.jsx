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
import { buildSystemPrompt } from "@/lib/defaultCharacter";

export default function EditCharacterStory() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [form, setForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const editableChars = characters.filter(c => !c.is_default && c.status !== "deleted");

  const handleSelect = (char) => {
    setSelectedChar(char);
    setForm({
      background_story: char.background_story || "",
      current_situation: char.current_situation || "",
      family_history: char.family_history || "",
      emotional_baggage: char.emotional_baggage || "",
      age_range: char.age_range || "",
      personality_notes: char.personality_summary || "",
    });
    setSaved(false);
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
    merged.system_prompt = buildSystemPrompt(merged);

    const { personality_notes, ...formWithoutNotes } = form;
    await base44.entities.Character.update(selectedChar.id, {
      ...formWithoutNotes,
      personality_summary: personality,
      system_prompt: merged.system_prompt,
    });
    queryClient.invalidateQueries({ queryKey: ["characters"] });
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
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Age</label>
              <Input
                value={form.age_range}
                onChange={e => setForm(p => ({ ...p, age_range: e.target.value }))}
                placeholder="e.g. Early 20s, Mid 30s, Late 40s..."
                className="rounded-xl text-sm"
              />
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