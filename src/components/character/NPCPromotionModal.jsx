import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Sparkles, X, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

/**
 * NPCPromotionModal
 * 
 * Step 1 of NPC → Active Character promotion flow.
 * Shows avatar upload / generate options BEFORE entering the Create Character flow.
 * Preserves all existing relationship data throughout.
 * 
 * Props:
 *   npcData: { person_name, relationship_type, description, history_summary, 
 *              current_status, emotional_impact, friendship_level, romantic_level,
 *              attraction_level, chosen_family_level, user_respect_level }
 *   sourceCharacter: the Character object this NPC came from
 *   onComplete: (avatarUrl: string | null) => void — called when user proceeds
 *   onCancel: () => void
 */
export default function NPCPromotionModal({ npcData, sourceCharacter, onComplete, onCancel }) {
  const [phase, setPhase] = useState("choose"); // "choose" | "upload" | "generate" | "preview"
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState(
    npcData?.description
      ? `Realistic portrait photo of a person: ${npcData.description}. Natural lighting, detailed face, photorealistic.`
      : "Realistic portrait photo, natural lighting, detailed face, photorealistic."
  );

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await base44.integrations.Core.UploadFile({ file });
    if (res?.file_url) {
      setAvatarUrl(res.file_url);
      setPhase("preview");
    }
    setUploading(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const res = await base44.integrations.Core.GenerateImage({
      prompt: generatePrompt,
    });
    if (res?.url) {
      setAvatarUrl(res.url);
      setPhase("preview");
    }
    setGenerating(false);
  };

  const handleSkip = () => {
    onComplete(null);
  };

  const handleProceed = () => {
    onComplete(avatarUrl);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onCancel()}
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.97 }}
          className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm space-y-4"
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-primary font-semibold uppercase tracking-wider">Activating NPC</p>
              <h2 className="text-base font-bold text-foreground mt-0.5">
                {npcData?.person_name}
              </h2>
              {npcData?.relationship_type && (
                <p className="text-xs text-muted-foreground capitalize">{npcData.relationship_type}</p>
              )}
            </div>
            <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Relationship preservation notice */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
            <p className="text-xs text-primary font-medium mb-1">Relationships preserved</p>
            <p className="text-xs text-muted-foreground">
              All existing friendships, history, and social context will carry over to the new character.
            </p>
          </div>

          {/* Phase: Choose */}
          {phase === "choose" && (
            <div className="space-y-3">
              <p className="text-sm text-foreground font-medium">Choose an avatar to start</p>
              <p className="text-xs text-muted-foreground">Upload a photo or let AI generate one. You can always change it later.</p>

              <label className="block cursor-pointer">
                <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                <div className={`flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/40 transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
                  {uploading ? (
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5 text-primary" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-foreground">Upload a photo</p>
                    <p className="text-xs text-muted-foreground">Use a real reference image</p>
                  </div>
                </div>
              </label>

              <button
                onClick={() => setPhase("generate")}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/40 transition-colors text-left"
              >
                <Sparkles className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Generate with AI</p>
                  <p className="text-xs text-muted-foreground">Create a portrait from their description</p>
                </div>
              </button>

              <button
                onClick={handleSkip}
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip for now — proceed without avatar
              </button>
            </div>
          )}

          {/* Phase: Generate */}
          {phase === "generate" && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Generate avatar</p>
              <textarea
                value={generatePrompt}
                onChange={e => setGeneratePrompt(e.target.value)}
                rows={3}
                className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-secondary text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="Describe how they look..."
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPhase("choose")} className="flex-1 rounded-xl">
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={generating || !generatePrompt.trim()}
                  className="flex-1 rounded-xl gap-1.5"
                >
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {generating ? "Generating..." : "Generate"}
                </Button>
              </div>
            </div>
          )}

          {/* Phase: Preview */}
          {phase === "preview" && avatarUrl && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Avatar preview</p>
              <div className="flex justify-center">
                <img
                  src={avatarUrl}
                  alt="Avatar preview"
                  className="w-32 h-32 rounded-2xl object-cover border-2 border-primary/30"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setAvatarUrl(null); setPhase("choose"); }}
                  className="flex-1 rounded-xl"
                >
                  Try again
                </Button>
                <Button
                  size="sm"
                  onClick={handleProceed}
                  className="flex-1 rounded-xl gap-1.5"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  Continue setup
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}