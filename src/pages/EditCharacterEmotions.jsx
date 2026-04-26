import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { useSettingsCharacters } from "@/hooks/useSettingsCharacters";
import SettingsCharacterList from "@/components/settings/SettingsCharacterList";

function TagListEditor({ label, items, onChange }) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setInput("");
  };

  const handleRemove = (idx) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="flex flex-wrap gap-2 min-h-[40px] p-3 rounded-xl bg-secondary/30 border border-border">
        {items.map((item, idx) => (
          <span key={idx} className="flex items-center gap-1 bg-secondary text-secondary-foreground text-xs px-2 py-1 rounded-lg">
            {item}
            <button onClick={() => handleRemove(idx)}><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          placeholder="Add item..."
          className="flex-1 bg-secondary/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" variant="secondary" onClick={handleAdd} className="rounded-xl">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export default function EditCharacterEmotions() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [form, setForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { sections, isLoading } = useSettingsCharacters(currentUser, "emotions");

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;

  const handleSelect = (char) => {
    setSelectedChar(char);
    setForm({
      emotional_state: char.emotional_state || "calm",
      emotional_triggers_high: char.emotional_triggers_high || [],
      emotional_triggers_medium: char.emotional_triggers_medium || [],
      emotional_triggers_deep: char.emotional_triggers_deep || [],
      emotional_baggage: char.emotional_baggage || "",
      upset_reaction: char.upset_reaction || "",
      memories: char.memories || [],
      voice_enabled: char.voice_enabled || false,
      voice_name: char.voice_name || "",
      voice_style_note: char.voice_style_note || "",
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setIsSaving(true);
    const merged = { ...selectedChar, ...form };

    // Re-generate personality summary reflecting updated emotional profile
    const personality = await base44.integrations.Core.InvokeLLM({
      prompt: `Create a personality summary (2-3 sentences, raw and real, written in third person) based on this character's updated emotional profile.
Name: ${merged.name}. Age: ${merged.age_range || "adult"}. Gender: ${merged.gender || "person"}.
Archetype: ${merged.archetype || "not specified"}. Social energy: ${merged.social_energy || "not specified"}.
Emotional state: ${merged.emotional_state || "calm"}.
Emotional baggage: ${merged.emotional_baggage || "not specified"}.
Reaction when upset: ${merged.upset_reaction || "not specified"}.
High triggers: ${(merged.emotional_triggers_high || []).join(", ") || "not specified"}.
Background: ${merged.background_story || "not specified"}.
Make it feel like a real person, not a description. No flowery language.`
    });

    merged.personality_summary = personality;
    const systemPrompt = buildSystemPrompt(merged);

    // Upload system prompt if it's too large
    let systemPromptUrl = null;
    if (systemPrompt.length > 50000) {
      const uploadRes = await base44.integrations.Core.UploadFile({
        file: new Blob([systemPrompt], { type: "text/plain" })
      });
      systemPromptUrl = uploadRes.file_url;
    }

    const { voice_enabled, voice_name, voice_style_note, memories, ...formWithoutVoice } = form;
    const updateData = {
      ...formWithoutVoice,
      voice_enabled,
      voice_name,
      voice_style_note,
      memories,
      personality_summary: personality,
    };

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
          {selectedChar ? `Edit Emotions & Experiences — ${selectedChar.name}` : "Edit Character Emotions & Experiences"}
        </h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {!selectedChar ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a character to edit their emotions.</p>
            {isLoading ? (
              <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
            ) : (
              <SettingsCharacterList
                sections={sections}
                onSelect={handleSelect}
                renderSubtitle={char => `Mood: ${char.emotional_state || 'calm'}`}
                emptyMessage="No characters yet."
              />
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Emotional State</label>
              <Select value={form.emotional_state} onValueChange={v => setForm(p => ({ ...p, emotional_state: v }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="calm">Calm</SelectItem>
                  <SelectItem value="irritated">Irritated</SelectItem>
                  <SelectItem value="defensive">Defensive</SelectItem>
                  <SelectItem value="reflective">Reflective</SelectItem>
                  <SelectItem value="closed-off">Closed-off</SelectItem>
                  <SelectItem value="flirtatious">Flirtatious</SelectItem>
                  <SelectItem value="bored">Bored</SelectItem>
                  <SelectItem value="burnt out">Burnt Out</SelectItem>
                  <SelectItem value="joyful">Joyful</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <TagListEditor
              label="High Triggers (react clearly)"
              items={form.emotional_triggers_high || []}
              onChange={v => setForm(p => ({ ...p, emotional_triggers_high: v }))}
            />
            <TagListEditor
              label="Medium Triggers (noticeable shift)"
              items={form.emotional_triggers_medium || []}
              onChange={v => setForm(p => ({ ...p, emotional_triggers_medium: v }))}
            />
            <TagListEditor
              label="Deep Triggers (quiet, then cold)"
              items={form.emotional_triggers_deep || []}
              onChange={v => setForm(p => ({ ...p, emotional_triggers_deep: v }))}
            />

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Emotional Baggage</label>
              <Textarea
                value={form.emotional_baggage}
                onChange={e => setForm(p => ({ ...p, emotional_baggage: e.target.value }))}
                placeholder="What they carry, trust issues, wounds..."
                className="rounded-xl min-h-[100px] text-sm resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reaction When Upset</label>
              <Textarea
                value={form.upset_reaction}
                onChange={e => setForm(p => ({ ...p, upset_reaction: e.target.value }))}
                placeholder="How they respond when triggered..."
                className="rounded-xl min-h-[80px] text-sm resize-none"
              />
            </div>

            {/* What they've been through */}
            <div className="space-y-3 pt-4 border-t border-border">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">What They've Been Through</label>
                <p className="text-xs text-muted-foreground mt-1">Experiences that shaped them — struggles, wins, and growth.</p>
              </div>

              {/* Existing memories */}
              {(form.memories || []).map((mem, idx) => (
                <div key={idx} className="border border-border rounded-xl p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <input
                      type="text"
                      value={mem.title}
                      onChange={e => {
                        const updated = [...form.memories];
                        updated[idx] = { ...updated[idx], title: e.target.value };
                        setForm(p => ({ ...p, memories: updated }));
                      }}
                      placeholder="Experience title..."
                      className="flex-1 bg-secondary/30 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      onClick={() => setForm(p => ({ ...p, memories: p.memories.filter((_, i) => i !== idx) }))}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 mt-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <Textarea
                    value={mem.description || ""}
                    onChange={e => {
                      const updated = [...form.memories];
                      updated[idx] = { ...updated[idx], description: e.target.value };
                      setForm(p => ({ ...p, memories: updated }));
                    }}
                    placeholder="What happened, how it affected them..."
                    className="rounded-lg min-h-[70px] text-sm resize-none"
                  />
                </div>
              ))}

              <button
                onClick={() => setForm(p => ({ ...p, memories: [...(p.memories || []), { title: "", description: "", emotional_impact: "", lesson_learned: "" }] }))}
                className="w-full flex items-center gap-2 justify-center py-2.5 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> Add experience
              </button>
            </div>

            <div className="pt-4 border-t border-border">
              <VoiceSettings 
                data={form} 
                onUpdate={(field, value) => setForm(p => ({ ...p, [field]: value }))} 
                hasApiKey={hasApiKey}
                character={selectedChar}
              />
            </div>

            <Button onClick={handleSave} disabled={isSaving} className="w-full h-12 rounded-xl gap-2">
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