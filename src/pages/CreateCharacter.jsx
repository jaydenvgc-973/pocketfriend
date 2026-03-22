import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence } from "framer-motion";
import CreationStep from "@/components/create/CreationStep";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { useToast } from "@/components/ui/use-toast";

const TOTAL_STEPS = 6;

export default function CreateCharacter() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    memories: [{ title: "", description: "", emotional_impact: "", lesson_learned: "" }],
  });
  const [isCreating, setIsCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setData(prev => ({ ...prev, avatar_url: file_url }));
    setUploading(false);
  };

  const handleCreate = async () => {
    if (!data.name?.trim()) {
      toast({ title: "Name required", description: "Give your character a name", variant: "destructive" });
      return;
    }
    setIsCreating(true);

    const charData = {
      ...data,
      is_default: false,
      emotional_state: "calm",
    };
    charData.system_prompt = buildSystemPrompt(charData);

    await base44.entities.Character.create(charData);
    navigate("/home");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/home" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-sm font-semibold">Create Character</h2>
        </div>
        <span className="text-xs text-muted-foreground">{step + 1}/{TOTAL_STEPS}</span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-secondary">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {/* Avatar upload */}
        {step === 0 && (
          <div className="flex justify-center mb-6">
            <label className="cursor-pointer group">
              <div className="w-20 h-20 rounded-full bg-card border-2 border-dashed border-border group-hover:border-primary/40 flex items-center justify-center overflow-hidden transition-colors">
                {data.avatar_url ? (
                  <img src={data.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                ) : uploading ? (
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                )}
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              <p className="text-xs text-muted-foreground text-center mt-2">Add photo</p>
            </label>
          </div>
        )}

        <AnimatePresence mode="wait">
          <CreationStep step={step} data={data} onChange={setData} />
        </AnimatePresence>

        <div className="flex gap-3 mt-8">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 h-12 rounded-xl border-border">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          )}
          {step < TOTAL_STEPS - 1 ? (
            <Button onClick={() => setStep(s => s + 1)} className="flex-1 h-12 rounded-xl">
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={isCreating} className="flex-1 h-12 rounded-xl">
              {isCreating ? (
                <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : (
                <>Create <Check className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}