import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    uploadMutation.mutate(file);
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
            <span className="text-[10px] font-medium">{uploading ? "Uploading..." : "Add photo"}</span>
          </div>
        </label>
      </div>
    </div>
  );
}