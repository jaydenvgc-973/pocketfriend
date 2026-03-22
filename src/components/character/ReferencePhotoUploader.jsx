import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Upload, X, Sparkles, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

/**
 * ReferencePhotoUploader
 * Props:
 *  - descriptor: string — text description of the character used for generation prompt
 *  - onAvatarGenerated: (avatarUrl, referenceUrls) => void
 *  - existingReferenceUrls: string[] — pre-loaded refs (for edit mode)
 *  - existingAvatarUrl: string — current avatar (for edit mode)
 */
export default function ReferencePhotoUploader({ descriptor, onAvatarGenerated, existingReferenceUrls = [], existingAvatarUrl = null }) {
  const [referenceUrls, setReferenceUrls] = useState(existingReferenceUrls);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState(existingAvatarUrl);
  const [initialized, setInitialized] = useState(false);

  // Re-sync when the parent's async data arrives (e.g. character loads after mount)
  useEffect(() => {
    if (!initialized && (existingReferenceUrls.length > 0 || existingAvatarUrl)) {
      setReferenceUrls(existingReferenceUrls);
      setGeneratedUrl(existingAvatarUrl);
      setInitialized(true);
    }
  }, [existingReferenceUrls, existingAvatarUrl, initialized]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsUploading(true);
    const uploaded = await Promise.all(files.map(f => base44.integrations.Core.UploadFile({ file: f })));
    const newUrls = [...referenceUrls, ...uploaded.map(r => r.file_url)];
    setReferenceUrls(newUrls);
    setIsUploading(false);
    // Notify parent of the new refs (no avatar yet)
    onAvatarGenerated(generatedUrl, newUrls);
  };

  const removeRef = (url) => {
    const newUrls = referenceUrls.filter(u => u !== url);
    setReferenceUrls(newUrls);
    onAvatarGenerated(generatedUrl, newUrls);
  };

  const generateAvatar = async () => {
    setIsGenerating(true);
    const prompt = `Realistic portrait photo of ${descriptor}. Candid, natural lighting, authentic. Not a stock photo. Match the person's exact appearance from the reference photos.`;
    const result = await base44.integrations.Core.GenerateImage({
      prompt,
      existing_image_urls: referenceUrls,
    });
    setGeneratedUrl(result.url);
    setIsGenerating(false);
    onAvatarGenerated(result.url, referenceUrls);
  };

  return (
    <div className="space-y-4">
      {/* Current avatar preview */}
      {generatedUrl && (
        <div className="flex justify-center">
          <div className="relative w-24 h-24 rounded-full overflow-hidden ring-2 ring-primary/30">
            <img src={generatedUrl} alt="avatar" className="w-full h-full object-cover" />
          </div>
        </div>
      )}

      {/* Reference photos */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Reference photos {referenceUrls.length > 0 ? `(${referenceUrls.length})` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {referenceUrls.map((url, i) => (
            <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden">
              <img src={url} alt={`ref ${i + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => removeRef(url)}
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center"
              >
                <X className="w-2.5 h-2.5 text-white" />
              </button>
            </div>
          ))}

          {/* Upload button */}
          <label className="cursor-pointer w-16 h-16 rounded-xl border-2 border-dashed border-border hover:border-primary/40 flex items-center justify-center transition-colors">
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
            {isUploading ? (
              <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
            ) : (
              <Upload className="w-4 h-4 text-muted-foreground" />
            )}
          </label>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">Upload real photos — the more the better</p>
      </div>

      {/* Generate button — only show if there are reference photos */}
      {referenceUrls.length > 0 && (
        <Button
          onClick={generateAvatar}
          disabled={isGenerating}
          variant="outline"
          className="w-full rounded-xl gap-2"
        >
          {isGenerating ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Blending photos...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> {generatedUrl ? "Regenerate avatar" : "Generate avatar from photos"}</>
          )}
        </Button>
      )}

      {!referenceUrls.length && !generatedUrl && (
        <p className="text-xs text-muted-foreground text-center py-2">Upload photos above, then generate an avatar — or skip to use initials</p>
      )}
    </div>
  );
}