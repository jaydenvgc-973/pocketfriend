import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Wand2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

export default function UserPhotoUploader({ referenceImages = [] }) {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const queryClient = useQueryClient();

  const saveImages = async (updatedImages) => {
    await base44.auth.updateMe({ reference_image_urls: updatedImages });
    queryClient.invalidateQueries({ queryKey: ["user"] });
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const user = await base44.auth.me();
      const current = user.reference_image_urls || [];
      const slots = 4 - current.length;
      const toUpload = files.slice(0, slots);
      const uploaded = await Promise.all(toUpload.map(f => base44.integrations.Core.UploadFile({ file: f })));
      const newUrls = uploaded.map(r => r.file_url);
      await saveImages([...current, ...newUrls]);
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (referenceImages.length === 0 || referenceImages.length >= 4) return;
    setGenerating(true);
    try {
      const genRes = await base44.integrations.Core.GenerateImage({
        prompt: "High-quality, photorealistic portrait of this person. Natural lighting, clear facial features, realistic skin texture, looking at camera. Upper body shot. Photo-real, not illustrated or stylized.",
        existing_image_urls: referenceImages
      });
      if (genRes?.url) {
        const user = await base44.auth.me();
        const current = user.reference_image_urls || [];
        await saveImages([...current, genRes.url]);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (urlToRemove) => {
    const user = await base44.auth.me();
    const updated = (user.reference_image_urls || []).filter(u => u !== urlToRemove);
    await saveImages(updated);
  };

  const canAdd = referenceImages.length < 4;

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Reference Photos</p>
      <p className="text-xs text-muted-foreground">
        Upload or generate up to 4 photos of yourself. These are used as reference when characters generate images that include you.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <AnimatePresence>
          {referenceImages.map((url) => (
            <motion.div
              key={url}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative group rounded-xl overflow-hidden bg-secondary aspect-square"
            >
              <img src={url} alt="reference" className="w-full h-full object-cover" />
              <button
                onClick={() => handleDelete(url)}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {canAdd && (
          <label className="relative rounded-xl border-2 border-dashed border-border hover:border-primary/40 transition-colors cursor-pointer flex items-center justify-center aspect-square bg-card/50">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              disabled={uploading || generating}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
              <span className="text-xs font-medium">{uploading ? "Uploading..." : "Upload photo"}</span>
            </div>
          </label>
        )}
      </div>

      {referenceImages.length > 0 && canAdd && (
        <Button
          variant="outline"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full gap-2"
        >
          {generating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
          ) : (
            <><Wand2 className="w-4 h-4" /> Generate AI variation</>
          )}
        </Button>
      )}

      {referenceImages.length === 4 && (
        <p className="text-xs text-muted-foreground text-center">4/4 photos saved. Delete one to add more.</p>
      )}
    </div>
  );
}