import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { DEFAULT_CHARACTER_DATA, buildSystemPrompt } from "@/lib/defaultCharacter";
import { useNavigate } from "react-router-dom";

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);

    const charData = {
      ...DEFAULT_CHARACTER_DATA,
      name: name.trim(),
    };
    charData.system_prompt = buildSystemPrompt(charData);

    const character = await base44.entities.Character.create(charData);

    await base44.entities.UserSettings.create({
      has_completed_onboarding: true,
      default_character_id: character.id,
    });

    navigate("/home");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center"
            >
              <div className="w-20 h-20 rounded-full bg-primary/20 mx-auto mb-8 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-primary/60" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-3">
                You're about to meet your first character.
              </h1>
              <div className="bg-card border border-border rounded-2xl p-6 mt-8 text-left space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed italic">
                  "He's direct, observant, and emotionally aware. He values respect, notices everything, and doesn't respond well to being minimized. He's not always easy—but he's real."
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {["Male", "Conversational", "Emotionally reactive", "Memory-driven"].map(t => (
                    <span key={t} className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full font-medium">{t}</span>
                  ))}
                </div>
              </div>
              <Button onClick={() => setStep(1)} className="mt-8 w-full h-12 rounded-xl text-base gap-2">
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="name"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center"
            >
              <div className="w-20 h-20 rounded-full bg-primary/20 mx-auto mb-8 flex items-center justify-center">
                {name ? (
                  <span className="text-2xl font-bold text-primary">{name[0].toUpperCase()}</span>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/60" />
                )}
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">What would you like to name him?</h2>
              <p className="text-sm text-muted-foreground mb-8">This changes only the display name. His personality stays the same.</p>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter a name..."
                className="h-12 text-center text-lg bg-card border-border rounded-xl"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || isCreating}
                className="mt-6 w-full h-12 rounded-xl text-base gap-2"
              >
                {isCreating ? (
                  <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>Meet {name || "them"} <ArrowRight className="w-4 h-4" /></>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}