import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Check, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";

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

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const editableChars = characters.filter(c => c.status !== "deleted");

  const handleSelect = (char) => {
    setSelectedChar(char);
    setForm({
      emotional_state: char.emotional_state || "calm",
      emotional_triggers_high: char.emotional_triggers_high || [],
      emotional_triggers_medium: char.emotional_triggers_medium || [],
      emotional_triggers_deep: char.emotional_triggers_deep || [],
      emotional_baggage: char.emotional_baggage || "",
      upset_reaction: char.upset_reaction || "",
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setIsSaving(true);
    const updated = { ...selectedChar, ...form };
    updated.system_prompt = buildSystemPrompt(updated);
    await base44.entities.Character.update(selectedChar.id, {
      ...form,
      system_prompt: updated.system_prompt,
    });
    queryClient.invalidateQueries({ queryKey: ["characters"] });
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
          {selectedChar ? `Edit Emotions — ${selectedChar.name}` : "Edit Character Emotions"}
        </h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {!selectedChar ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a character to edit their emotions.</p>
            {editableChars.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No characters yet.</p>
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
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Emotional State</label>
              <Select value={form.emotional_state} onValueChange={v => setForm(p => ({ ...p, emotional_state: v }))}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="calm">Calm</SelectItem>
                  <SelectItem value="irritated">Irritated</SelectItem>
                  <SelectItem value="defensive">Defensive</SelectItem>
                  <SelectItem value="reflective">Reflective</SelectItem>
                  <SelectItem value="closed-off">Closed-off</SelectItem>
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