import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BottomNav from "@/components/BottomNav";
import { DEFAULT_CHARACTER_DATA, buildSystemPrompt } from "@/lib/defaultCharacter";

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [characterName, setCharacterName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: userSettings } = useQuery({
    queryKey: ["userSettings"],
    queryFn: async () => {
      const settings = await base44.entities.UserSettings.list();
      return settings[0];
    },
  });

  useEffect(() => {
    if (userSettings?.has_completed_onboarding) {
      navigate("/home");
    }
  }, [userSettings, navigate]);

  const handleCreate = async () => {
    if (!characterName.trim()) return;
    setIsSubmitting(true);

    // Generate a unique character profile for this user based on the name they chose
    const generated = await base44.integrations.Core.InvokeLLM({
      prompt: `Create a fully realized fictional character named "${characterName.trim()}" for a social simulation app. This character will text and chat with the user — they must feel like a real human being.

Generate a diverse, interesting character. Vary:
- Gender (can be male, female, non-binary — pick what fits the name)
- Age (20s–40s)
- Ethnicity/background (pick something authentic and specific)
- Personality (complex, flawed, real — not generic)
- Communication style (how they actually text — terse? wordy? sarcastic? warm?)
- Emotional state and triggers
- Life situation

CRITICAL: Make this character feel unique. Avoid clichés. Give them a real backstory, real flaws, real relationships.

Return JSON matching this schema exactly:
{
  "gender": "male|female|non-binary|other",
  "age_range": "e.g. Mid 20s",
  "ethnicities": ["e.g. Nigerian", "Puerto Rican"],
  "city": "city name",
  "state": "state abbreviation or country",
  "archetype": "e.g. The Realist, The Dreamer, The Protector",
  "social_energy": "introvert|mostly_introvert|ambivert|mostly_extrovert|extrovert",
  "sexual_orientation": "e.g. Straight, Gay, Bisexual, Queer",
  "personality_summary": "2-3 sentence raw, real description of who they are",
  "personality_traits": ["trait1", "trait2", "trait3", "trait4", "trait5"],
  "communication_style": "how they text and talk — raw, specific, not generic",
  "background_story": "2-3 sentence backstory — specific, real, grounded",
  "current_situation": "what their life looks like right now",
  "family_history": "brief family context — who raised them, key dynamics",
  "loyalty_view": "how they see loyalty",
  "upset_reaction": "how they react when upset",
  "emotional_baggage": "what they carry emotionally",
  "emotional_triggers_high": ["trigger1", "trigger2", "trigger3"],
  "emotional_triggers_medium": ["trigger1", "trigger2"],
  "emotional_triggers_deep": ["trigger1", "trigger2"],
  "work_details": { "job_title": "...", "workplace_type": "...", "work_environment": "..." },
  "lives_alone": true,
  "sleep_start_time": "23:00",
  "wake_up_time": "07:30",
  "work_start_time": "09:00",
  "work_end_time": "17:00",
  "work_days": [1,2,3,4,5]
}`,
      response_json_schema: {
        type: "object",
        properties: {
          gender: { type: "string" },
          age_range: { type: "string" },
          ethnicities: { type: "array", items: { type: "string" } },
          city: { type: "string" },
          state: { type: "string" },
          archetype: { type: "string" },
          social_energy: { type: "string" },
          sexual_orientation: { type: "string" },
          personality_summary: { type: "string" },
          personality_traits: { type: "array", items: { type: "string" } },
          communication_style: { type: "string" },
          background_story: { type: "string" },
          current_situation: { type: "string" },
          family_history: { type: "string" },
          loyalty_view: { type: "string" },
          upset_reaction: { type: "string" },
          emotional_baggage: { type: "string" },
          emotional_triggers_high: { type: "array", items: { type: "string" } },
          emotional_triggers_medium: { type: "array", items: { type: "string" } },
          emotional_triggers_deep: { type: "array", items: { type: "string" } },
          work_details: { type: "object" },
          lives_alone: { type: "boolean" },
          sleep_start_time: { type: "string" },
          wake_up_time: { type: "string" },
          work_start_time: { type: "string" },
          work_end_time: { type: "string" },
          work_days: { type: "array", items: { type: "integer" } }
        }
      }
    });

    const data = {
      ...generated,
      name: characterName.trim(),
      is_default: true,
      is_finalized: true,
      status: "active",
      emotional_state: "calm",
      user_respect_level: 50,
      friendship_level: 75,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 100,
    };
    data.system_prompt = buildSystemPrompt(data);

    await base44.entities.Character.create(data);
    await base44.entities.UserSettings.create({ has_completed_onboarding: true });
    navigate("/home");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center space-y-6"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto">
                <span className="text-3xl">👤</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Pocketfriend</h1>
                <p className="text-muted-foreground mt-2 text-sm">A character that feels real. Built to push back, not just agree.</p>
              </div>
              <Button onClick={() => setStep(1)} className="w-full h-12 rounded-xl">Get started</Button>
              <Link to="/home" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors mt-2 whitespace-nowrap">Or go to home</Link>
            </motion.div>
          )}
          {step === 1 && (
            <motion.div
              key="name"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-foreground">Name your character</h2>
                <p className="text-muted-foreground text-sm mt-1">What do you want to call them?</p>
              </div>
              <Input
                value={characterName}
                onChange={e => setCharacterName(e.target.value)}
                placeholder="e.g. Kelvin"
                className="h-12 rounded-xl text-base"
                onKeyDown={e => e.key === "Enter" && characterName.trim() && handleCreate()}
              />
              <Button
                onClick={handleCreate}
                disabled={!characterName.trim() || isSubmitting}
                className="w-full h-12 rounded-xl"
              >
                {isSubmitting ? "Building your character..." : "Create character"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <BottomNav />
    </div>
  );
}