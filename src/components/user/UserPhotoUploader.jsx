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

  const [lastProof, setLastProof] = useState(null);

  const handleGenerate = async () => {
    if (referenceImages.length === 0 || generatedAvatars.length >= MAX_AVATARS) return;
    setGenerating(true);
    setLastProof(null);
    try {
      // Always re-fetch the live user to get the most up-to-date reference image list,
      // preventing stale-prop bugs where recently uploaded images are not yet in referenceImages.
      const liveUser = await base44.auth.me();
      const liveImages = liveUser?.reference_image_urls || [];
      const imagesToUse = liveImages.length > 0 ? liveImages : referenceImages;

      if (imagesToUse.length === 0) return;

      const count = imagesToUse.length;
      // Use exact decimal weights, not rounded, for accuracy
      const weightEach = parseFloat((100 / count).toFixed(2));
      const weightList = imagesToUse.map((url, i) => `Image ${i + 1} [${url.slice(-24)}]: ${weightEach}%`).join('\n');

      const weightingNote = count === 1
        ? `1 reference image provided. Use it as the sole source of truth (100% influence).`
        : `${count} reference images provided. Each image MUST contribute equally:\n${weightList}\n\nYou MUST blend facial features, hair texture, face shape, body type, skin tone, and all identity cues from ALL ${count} images at ${weightEach}% each. Do NOT use only one image. Do NOT ignore any of the provided images.`;

      const proof = {
        imageCount: count,
        weightPerImage: `${weightEach}%`,
        imageUrls: imagesToUse.map((u, i) => `Image ${i + 1}: ${u}`),
      };
      setLastProof(proof);

      const prompt = [
        `📸 STYLE: Ultra-photorealistic, cinematic, professional RAW photo. Natural light, authentic skin texture, real hair, natural imperfections. Must look like an unmanipulated photograph of a real person.`,
        ``,
        `🎯 MULTI-IMAGE IDENTITY BLENDING (MANDATORY):`,
        weightingNote,
        ``,
        `Synthesize this person's exact facial structure, bone structure, eye shape, nose shape, lip shape, skin tone, hair type and texture from ALL ${count} provided reference image(s). The result must be the same person visible across all references.`,
        ``,
        `❌ FORBIDDEN: illustration, painting, digital art, anime, cartoon, CGI, 3D render, airbrushed, stylized, or any non-photographic look.`,
        ``,
        `[GENERATION PROOF — ${count} image(s) at ${weightEach}% each]`,
      ].join('\n');

      const genRes = await base44.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: imagesToUse,
      });
      const current = liveUser.generated_avatar_urls || [];
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

        {lastProof && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1 text-xs">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">Generation Proof</p>
            <p className="text-muted-foreground">Images used: <span className="text-foreground font-medium">{lastProof.imageCount}</span></p>
            <p className="text-muted-foreground">Weight per image: <span className="text-foreground font-medium">{lastProof.weightPerImage}</span></p>
            <div className="space-y-0.5 mt-1">
              {lastProof.imageUrls.map((u, i) => (
                <p key={i} className="text-[10px] text-muted-foreground/70 truncate">{u}</p>
              ))}
            </div>
          </div>
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