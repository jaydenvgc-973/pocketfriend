import React from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function CreationStep({ step, data, onChange }) {
  const field = (key, value) => onChange({ ...data, [key]: value });

  const steps = {
    0: (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-foreground mb-1">Identity</h2>
          <p className="text-sm text-muted-foreground">Who is this person?</p>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input value={data.name || ""} onChange={e => field("name", e.target.value)} placeholder="Their name" className="bg-card border-border rounded-xl mt-1" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Gender</Label>
            <Select value={data.gender || ""} onValueChange={v => field("gender", v)}>
              <SelectTrigger className="bg-card border-border rounded-xl mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="non-binary">Non-binary</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Short description</Label>
            <Textarea value={data.personality_summary || ""} onChange={e => field("personality_summary", e.target.value)} placeholder="In a few sentences, who are they?" className="bg-card border-border rounded-xl mt-1 min-h-[80px]" />
          </div>
        </div>
      </div>
    ),
    1: (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-foreground mb-1">Personality & Style</h2>
          <p className="text-sm text-muted-foreground">How do they act and communicate?</p>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Personality traits (comma separated)</Label>
            <Textarea value={(data.personality_traits || []).join(", ")} onChange={e => field("personality_traits", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} placeholder="e.g. funny, sarcastic, caring, impulsive" className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">How do they talk?</Label>
            <Textarea value={data.communication_style || ""} onChange={e => field("communication_style", e.target.value)} placeholder="Short and blunt? Verbose? Poetic? Use slang?" className="bg-card border-border rounded-xl mt-1 min-h-[80px]" />
          </div>
        </div>
      </div>
    ),
    2: (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-foreground mb-1">Background & Life</h2>
          <p className="text-sm text-muted-foreground">What's their story?</p>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Background story</Label>
            <Textarea value={data.background_story || ""} onChange={e => field("background_story", e.target.value)} placeholder="Where they come from, what shaped them..." className="bg-card border-border rounded-xl mt-1 min-h-[80px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Current living situation</Label>
            <Textarea value={data.current_situation || ""} onChange={e => field("current_situation", e.target.value)} placeholder="Where do they live? Work? Daily life?" className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Family history & ties</Label>
            <Textarea value={data.family_history || ""} onChange={e => field("family_history", e.target.value)} placeholder="Family relationships, dynamics..." className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
        </div>
      </div>
    ),
    3: (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-foreground mb-1">Emotional Landscape</h2>
          <p className="text-sm text-muted-foreground">What triggers them? How do they handle emotions?</p>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">High triggers — things that set them off</Label>
            <Textarea value={(data.emotional_triggers_high || []).join(", ")} onChange={e => field("emotional_triggers_high", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} placeholder="e.g. being lied to, feeling ignored" className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Medium triggers</Label>
            <Textarea value={(data.emotional_triggers_medium || []).join(", ")} onChange={e => field("emotional_triggers_medium", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} placeholder="Things that bother them but don't explode" className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Deep triggers — emotional wounds</Label>
            <Textarea value={(data.emotional_triggers_deep || []).join(", ")} onChange={e => field("emotional_triggers_deep", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} placeholder="The things that really hurt them deep down" className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
        </div>
      </div>
    ),
    4: (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-foreground mb-1">Loyalty, Pain & Reactions</h2>
          <p className="text-sm text-muted-foreground">How do they handle the hard stuff?</p>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">How do they see loyalty?</Label>
            <Textarea value={data.loyalty_view || ""} onChange={e => field("loyalty_view", e.target.value)} placeholder="What does loyalty mean to them?" className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">How do they react when upset or down?</Label>
            <Textarea value={data.upset_reaction || ""} onChange={e => field("upset_reaction", e.target.value)} placeholder="Do they shut down? Lash out? Get quiet?" className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Emotional baggage</Label>
            <Textarea value={data.emotional_baggage || ""} onChange={e => field("emotional_baggage", e.target.value)} placeholder="Unresolved issues, things they carry..." className="bg-card border-border rounded-xl mt-1 min-h-[60px]" />
          </div>
        </div>
      </div>
    ),
    5: (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-foreground mb-1">Core Memories</h2>
          <p className="text-sm text-muted-foreground">3-5 defining moments that shaped who they are</p>
        </div>
        <div className="space-y-4">
          {(data.memories || [{ title: "", description: "", emotional_impact: "", lesson_learned: "" }]).map((m, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-2">
              <p className="text-xs font-medium text-primary">Memory {i + 1}</p>
              <Input value={m.title} onChange={e => { const mems = [...(data.memories || [])]; mems[i] = { ...mems[i], title: e.target.value }; field("memories", mems); }} placeholder="Title (e.g. 'The breakup')" className="bg-secondary border-border rounded-lg text-sm" />
              <Textarea value={m.description} onChange={e => { const mems = [...(data.memories || [])]; mems[i] = { ...mems[i], description: e.target.value }; field("memories", mems); }} placeholder="What happened?" className="bg-secondary border-border rounded-lg text-sm min-h-[50px]" />
              <Input value={m.emotional_impact} onChange={e => { const mems = [...(data.memories || [])]; mems[i] = { ...mems[i], emotional_impact: e.target.value }; field("memories", mems); }} placeholder="How did it affect them?" className="bg-secondary border-border rounded-lg text-sm" />
              <Input value={m.lesson_learned} onChange={e => { const mems = [...(data.memories || [])]; mems[i] = { ...mems[i], lesson_learned: e.target.value }; field("memories", mems); }} placeholder="What did they learn?" className="bg-secondary border-border rounded-lg text-sm" />
            </div>
          ))}
          {(data.memories || []).length < 5 && (
            <button
              onClick={() => field("memories", [...(data.memories || []), { title: "", description: "", emotional_impact: "", lesson_learned: "" }])}
              className="w-full border-2 border-dashed border-border rounded-xl py-3 text-sm text-muted-foreground hover:border-primary/30 transition-colors"
            >
              + Add memory
            </button>
          )}
        </div>
      </div>
    ),
  };

  return (
    <motion.div
      key={step}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      {steps[step]}
    </motion.div>
  );
}