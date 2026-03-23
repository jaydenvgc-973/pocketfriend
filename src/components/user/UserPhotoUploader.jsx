import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Wand2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

export default function UserPhotoUploader({ referenceImages = [] }) {
  const [uploading, setUploading] = useState(false);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      const uploaded = await base44.integrations.Core.UploadFile({ file });
      const user = await base44.auth.me();
      const currentImages = user.reference_image_urls || [];
      await base44.auth.updateMe({
        reference_image_urls: [...currentImages, uploaded.file_url]
      });
      return uploaded;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
      setUploading(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (imageUrl) => {
      const user = await base44.auth.me();
      const updated = (user.reference_image_urls || []).filter(url => url !== imageUrl);
      await base44.auth.updateMe({
        reference_image_urls: updated
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    
    for (const file of files) {
      uploadMutation.mutate(file);
    }
  };

  const handleGeneratePreview = async () => {
    if (referenceImages.length === 0) return;
    setGeneratingPreview(true);
    
    try {
      const genRes = await base44.integrations.Core.GenerateImage({
        prompt: "A realistic, well-lit portrait of a person. Focus on capturing their natural appearance, style, and presence.",
        existing_image_urls: referenceImages
      });
      setGeneratedImageUrl(genRes.url);
    } catch (err) {
      console.error("Failed to generate preview:", err);
    } finally {
      setGeneratingPreview(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Photos for AI Generation</p>
      <p className="text-xs text-muted-foreground">Upload photos of yourself to appear in character-generated images</p>

      {/* Photo grid */}
      <div className="grid grid-cols-2 gap-3">
        <AnimatePresence>
          {referenceImages.map((url) => (
            <motion.div
              key={url}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="relative group rounded-xl overflow-hidden bg-secondary aspect-square"
            >
              <img
                src={url}
                alt="reference"
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => deleteMutation.mutate(url)}
                disabled={deleteMutation.isPending}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
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
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Plus className="w-5 h-5" />
            )}
            <span className="text-[10px] font-medium">{uploading ? "Uploading..." : "Add photos"}</span>
          </div>
        </label>
      </div>

      {/* Generate preview button */}
      {referenceImages.length > 0 && (
        <Button
          onClick={handleGeneratePreview}
          disabled={generatingPreview}
          className="w-full gap-2"
        >
          {generatingPreview ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              Generate Image Preview
            </>
          )}
        </Button>
      )}

      {/* Generated preview */}
      <AnimatePresence>
        {generatedImageUrl && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            <p className="text-xs font-medium text-muted-foreground">Your Generated Preview</p>
            <div className="relative rounded-xl overflow-hidden bg-secondary aspect-square">
              <img
                src={generatedImageUrl}
                alt="generated preview"
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => setGeneratedImageUrl(null)}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-destructive/80 text-destructive-foreground hover:bg-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}