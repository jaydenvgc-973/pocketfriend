import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Wand2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

const MAX_AVATARS = 4;

export default function UserPhotoUploader({ referenceImages = [], generatedAvatars = [] }) {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const queryClient = useQueryClient();

  // --- Uploaded reference photos ---
  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      const uploaded = await base44.integrations.Core.UploadFile({ file });
      const user = await base44.auth.me();
      const current = user.reference_image_urls || [];
      await base44.auth.updateMe({ reference_image_urls: [...current, uploaded.file_url] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
      setUploading(false);
    },
  });

  const deleteReferenceMutation = useMutation({
    mutationFn: async (imageUrl) => {
      const user = await base44.auth.me();
      const updated = (user.reference_image_urls || []).filter(u => u !== imageUrl);
      await base44.auth.updateMe({ reference_image_urls: updated });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user"] }),
  });

  // --- Generated avatars ---
  const deleteAvatarMutation = useMutation({
    mutationFn: async (imageUrl) => {
      const user = await base44.auth.me();
      const updated = (user.generated_avatar_urls || []).filter(u => u !== imageUrl);
      await base44.auth.updateMe({ generated_avatar_urls: updated });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user"] }),
  });

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      await uploadMutation.mutateAsync(file);
    }
  };

  const handleGenerate = async () => {
    if (referenceImages.length === 0 || generatedAvatars.length >= MAX_AVATARS) return;
    setGenerating(true);
    try {
      const genRes = await base44.integrations.Core.GenerateImage({
        prompt: "A realistic, high-quality portrait of a person. Accurately capture their natural appearance, facial features, style, and presence based on the provided reference photos.",
        existing_image_urls: referenceImages,
      });
      const user = await base44.auth.me();
      const current = user.generated_avatar_urls || [];
      await base44.auth.updateMe({ generated_avatar_urls: [...current, genRes.url] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = referenceImages.length > 0 && generatedAvatars.length < MAX_AVATARS;

  return (
    <div className="space-y-6">

      {/* --- Uploaded Reference Photos --- */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Reference Photos</p>
          <p className="text-xs text-muted-foreground mt-1">Upload photos of yourself — these guide the avatar generation</p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <AnimatePresence>
            {referenceImages.map((url) => (
              <motion.div
                key={url}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="relative group rounded-xl overflow-hidden bg-secondary aspect-square"
              >
                <img src={url} alt="reference" className="w-full h-full object-cover" />
                <button
                  onClick={() => deleteReferenceMutation.mutate(url)}
                  disabled={deleteReferenceMutation.isPending}
                  className="absolute top-1.5 right-1.5 p-1 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Upload button */}
          <label className="relative rounded-xl border-2 border-dashed border-border hover:border-primary/40 transition-colors cursor-pointer flex items-center justify-center aspect-square bg-card/50">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              <span className="text-[10px] font-medium">{uploading ? "Uploading..." : "Add photos"}</span>
            </div>
          </label>
        </div>
      </div>

      {/* --- Generated Avatars --- */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Your Generated Avatars <span className="text-primary/70">({generatedAvatars.length}/{MAX_AVATARS})</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">These are used when a character includes you in a photo</p>
        </div>

        {generatedAvatars.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <AnimatePresence>
              {generatedAvatars.map((url) => (
                <motion.div
                  key={url}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative group rounded-xl overflow-hidden bg-secondary aspect-square"
                >
                  <img src={url} alt="generated avatar" className="w-full h-full object-cover" />
                  <button
                    onClick={() => deleteAvatarMutation.mutate(url)}
                    disabled={deleteAvatarMutation.isPending}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {canGenerate && (
          <Button onClick={handleGenerate} disabled={generating} className="w-full gap-2">
            {generating ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Generating Avatar...</>
            ) : (
              <><Wand2 className="w-4 h-4" />Generate Avatar ({generatedAvatars.length}/{MAX_AVATARS})</>
            )}
          </Button>
        )}

        {generatedAvatars.length >= MAX_AVATARS && (
          <p className="text-xs text-muted-foreground text-center">
            You've reached the maximum of {MAX_AVATARS} avatars. Delete one to generate a new one.
          </p>
        )}

        {referenceImages.length === 0 && generatedAvatars.length < MAX_AVATARS && (
          <p className="text-xs text-muted-foreground text-center">
            Upload at least one reference photo to generate an avatar.
          </p>
        )}
      </div>

    </div>
  );
}