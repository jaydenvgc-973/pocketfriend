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
    const data = {
      ...DEFAULT_CHARACTER_DATA,
      name: characterName.trim(),
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
              <Link to="/home" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors mt-2">Or go to home</Link>
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
                {isSubmitting ? "Creating..." : "Create character"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <BottomNav />
    </div>
  );
}