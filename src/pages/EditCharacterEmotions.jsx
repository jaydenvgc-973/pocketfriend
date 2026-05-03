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

    // Always upload system prompt as a file to avoid size limit
    const uploadRes = await base44.integrations.Core.UploadFile({
      file: new File([systemPrompt], "system_prompt.txt", { type: "text/plain" })
    });

    const { voice_enabled, voice_name, voice_style_note, memories, ...formWithoutVoice } = form;
    const updateData = {
      ...formWithoutVoice,
      voice_enabled,
      voice_name,
      voice_style_note,
      memories,
      personality_summary: personality,
      system_prompt_url: uploadRes.file_url,
    };

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

              {/* Custom (non-preset) memories — show as removable chips */}
              {(() => {
                const PRESET_TITLES_LOWER = new Set([
                  "first heartbreak","a betrayal by someone close","a moment they lost control","a loss they haven't fully processed","a time they felt rejected or overlooked","a period where everything felt uncertain",
                  "a moment they felt truly loved","a time they were proud of themselves","a meaningful friendship they still value","a time they helped someone and it mattered","a moment of joy they still remember clearly","a goal they worked hard to achieve","a place or experience that made them feel alive","a time they felt at peace with themselves",
                  "they learned from a mistake and changed","they grew stronger after a difficult time","they rebuilt something after losing it","they developed better coping skills","they became more confident over time","they are learning to trust again","they are working on becoming better",
                ]);
                const customMemories = (form.memories || []).filter(m => m.title && !PRESET_TITLES_LOWER.has(m.title.trim().toLowerCase()));
                if (customMemories.length === 0) return null;
                return (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Custom Experiences</p>
                    <div className="flex flex-wrap gap-2">
                      {customMemories.map((mem, i) => (
                        <div key={i} className="flex items-center gap-1.5 border border-border bg-secondary/30 rounded-full px-3 py-1.5">
                          <span className="text-xs font-medium text-foreground">{mem.title}</span>
                          <button onClick={() => setForm(p => ({ ...p, memories: p.memories.filter(m => m.title !== mem.title) }))} className="opacity-60 hover:opacity-100 transition-opacity">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Preset groups — toggleable, pre-selected if already on character */}
              {(() => {
                const PRESETS = [
                  { title: "First heartbreak", description: "A relationship that ended badly and left a mark — whether they show it or not.", category: "challenges" },
                  { title: "A betrayal by someone close", description: "Someone they trusted completely turned on them. They never fully forgot.", category: "challenges" },
                  { title: "A moment they lost control", description: "A situation where they went further than they meant to — emotionally or otherwise.", category: "challenges" },
                  { title: "A loss they haven't fully processed", description: "Someone or something they lost that still sits with them quietly.", category: "challenges" },
                  { title: "A time they felt rejected or overlooked", description: "A moment where they were passed over, dismissed, or made to feel invisible.", category: "challenges" },
                  { title: "A period where everything felt uncertain", description: "A stretch of life where they didn't know what came next. It changed how they plan.", category: "challenges" },
                  { title: "A moment they felt truly loved", description: "A relationship, friendship, or family moment where they felt completely accepted.", category: "positive" },
                  { title: "A time they were proud of themselves", description: "The moment they proved something to themselves. The thing they quietly hold onto.", category: "positive" },
                  { title: "A meaningful friendship they still value", description: "A person who genuinely got them — made them feel less alone. Defines how they connect.", category: "positive" },
                  { title: "A time they helped someone and it mattered", description: "They showed up for someone in a real way. That person still crosses their mind.", category: "positive" },
                  { title: "A moment of joy they still remember clearly", description: "A night, a trip, a celebration — pure happiness. They go back to it sometimes.", category: "positive" },
                  { title: "A goal they worked hard to achieve", description: "Something they earned through effort, not luck. It shaped what they believe they're capable of.", category: "positive" },
                  { title: "A place or experience that made them feel alive", description: "A trip, a job, a moment — something that reminded them why it's worth showing up.", category: "positive" },
                  { title: "A time they felt at peace with themselves", description: "A rare window where things were still and they were okay with who they were.", category: "positive" },
                  { title: "They learned from a mistake and changed", description: "Something they did wrong — and actually did the work to understand it and shift.", category: "growth" },
                  { title: "They grew stronger after a difficult time", description: "Hard stretch. They came out different — more capable, more grounded, more themselves.", category: "growth" },
                  { title: "They rebuilt something after losing it", description: "A job, a relationship, a sense of self — it fell apart and they built it back.", category: "growth" },
                  { title: "They developed better coping skills", description: "They used to handle things poorly. They found a better way. Still a work in progress.", category: "growth" },
                  { title: "They became more confident over time", description: "Wasn't always sure of themselves. Something shifted. They carry themselves differently now.", category: "growth" },
                  { title: "They are learning to trust again", description: "Trust got broken somewhere. They're opening back up — slowly, carefully.", category: "growth" },
                  { title: "They are working on becoming better", description: "Active self-improvement. Not perfect. But moving in the right direction.", category: "growth" },
                ];

                const matchesPreset = (mem, preset) =>
                  mem.title?.trim().toLowerCase() === preset.title.trim().toLowerCase();

                const togglePreset = (preset) => {
                  const currentMemories = form.memories || [];
                  const isSelected = currentMemories.some(m => matchesPreset(m, preset));
                  if (isSelected) {
                    setForm(p => ({ ...p, memories: p.memories.filter(m => !matchesPreset(m, preset)) }));
                  } else {
                    setForm(p => ({ ...p, memories: [...(p.memories || []), { title: preset.title, description: preset.description, category: preset.category, emotional_impact: "", lesson_learned: "" }] }));
                  }
                };

                return [
                  { key: "challenges", label: "Challenges", color: "text-rose-400", selectedColor: "border-rose-500/40 bg-rose-500/10", desc: "Experiences that tested them" },
                  { key: "positive", label: "Positive Experiences", color: "text-emerald-400", selectedColor: "border-emerald-500/40 bg-emerald-500/10", desc: "Things that brought them joy, love, or pride" },
                  { key: "growth", label: "Growth & Resilience", color: "text-blue-400", selectedColor: "border-blue-500/40 bg-blue-500/10", desc: "How they've changed and grown" },
                ].map(group => {
                  const groupPresets = PRESETS.filter(p => p.category === group.key);
                  return (
                    <div key={group.key}>
                      <div className="mb-2">
                        <p className={`text-[10px] font-bold uppercase tracking-widest ${group.color}`}>{group.label}</p>
                        <p className="text-[10px] text-muted-foreground">{group.desc}</p>
                      </div>
                      <div className="space-y-2">
                        {groupPresets.map(preset => {
                          const isSelected = (form.memories || []).some(m => matchesPreset(m, preset));
                          return (
                            <button
                              key={preset.title}
                              onClick={() => togglePreset(preset)}
                              className={`w-full text-left p-3 rounded-xl border transition-colors ${isSelected ? group.selectedColor : "border-border bg-card hover:border-primary/40"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-foreground">{preset.title}</p>
                                {isSelected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Custom add */}
              <button
                onClick={() => setForm(p => ({ ...p, memories: [...(p.memories || []), { title: "", description: "", category: "challenges", emotional_impact: "", lesson_learned: "" }] }))}
                className="w-full flex items-center gap-2 justify-center py-2.5 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> Add a custom experience
              </button>

              {/* Inline editor for blank/custom memories */}
              {(form.memories || []).filter(m => !m.title || m._editing).map((mem, idx) => {
                const realIdx = (form.memories || []).indexOf(mem);
                return (
                  <div key={realIdx} className="border border-border rounded-xl p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <input
                        type="text"
                        value={mem.title}
                        onChange={e => {
                          const updated = [...form.memories];
                          updated[realIdx] = { ...updated[realIdx], title: e.target.value };
                          setForm(p => ({ ...p, memories: updated }));
                        }}
                        placeholder="Experience title..."
                        className="flex-1 bg-secondary/30 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button onClick={() => setForm(p => ({ ...p, memories: p.memories.filter((_, i) => i !== realIdx) }))} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 mt-1">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <Textarea
                      value={mem.description || ""}
                      onChange={e => {
                        const updated = [...form.memories];
                        updated[realIdx] = { ...updated[realIdx], description: e.target.value };
                        setForm(p => ({ ...p, memories: updated }));
                      }}
                      placeholder="Any specific details... (optional)"
                      className="rounded-lg min-h-[60px] text-sm resize-none"
                    />
                  </div>
                );
              })}
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