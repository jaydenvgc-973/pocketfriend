import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Upload, X, Sparkles, RefreshCw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ReferencePhotoUploader
 * Props:
 *  - descriptor: string — text description of the character used for generation prompt
 *  - onAvatarGenerated: (avatarUrl, referenceUrls, generationPrompt, descriptionText) => void
 *  - existingReferenceUrls: string[] — pre-loaded refs (for edit mode)
 *  - existingAvatarUrl: string — current avatar (for edit mode)
 *  - existingDescriptionText: string — previously saved description text
 *  - existingGenerationPrompt: string — last generation prompt to display
 */
export default function ReferencePhotoUploader({
  descriptor,
  onAvatarGenerated,
  existingReferenceUrls = [],
  existingAvatarUrl = null,
  existingDescriptionText = "",
  existingGenerationPrompt = "",
}) {
  const [referenceUrls, setReferenceUrls] = useState(existingReferenceUrls);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState(existingAvatarUrl);
  const [descriptionText, setDescriptionText] = useState(existingDescriptionText);
  const [generationPrompt, setGenerationPrompt] = useState(existingGenerationPrompt);
  const [initialized, setInitialized] = useState(false);

  // Re-sync when the parent's async data arrives or changes
  useEffect(() => {
    setReferenceUrls(existingReferenceUrls);
    setGeneratedUrl(existingAvatarUrl);
    setDescriptionText(existingDescriptionText);
    setGenerationPrompt(existingGenerationPrompt);
    setInitialized(true);
  }, [existingReferenceUrls, existingAvatarUrl, existingDescriptionText, existingGenerationPrompt]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(files.map(f => base44.integrations.Core.UploadFile({ file: f })));
      const newUrls = [...referenceUrls, ...uploaded.map(r => r.file_url)];
      setReferenceUrls(newUrls);
      onAvatarGenerated(generatedUrl, newUrls, generationPrompt, descriptionText);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload images. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const removeRef = (url) => {
    const newUrls = referenceUrls.filter(u => u !== url);
    setReferenceUrls(newUrls);
    onAvatarGenerated(generatedUrl, newUrls, generationPrompt, descriptionText);
  };

  const generateAvatar = async () => {
    setIsGenerating(true);

    try {
      // Calculate weighting:
      // Each uploaded image counts as 1 "slot". The text description also counts as 1 "slot" (if provided).
      // Total slots = referenceUrls.length + (descriptionText ? 1 : 0)
      // Each slot has equal weight: 100% / totalSlots
      const imageCount = referenceUrls.length;
      const hasText = descriptionText.trim().length > 0;
      const totalSlots = imageCount + (hasText ? 1 : 0);
      const weightPercent = totalSlots > 0 ? Math.round(100 / totalSlots) : 100;

      let promptParts = [];

      // Base photorealistic directive
      promptParts.push(`Realistic portrait photo of ${descriptor}.`);
      promptParts.push(`Candid, natural lighting, authentic. Not a stock photo.`);

      if (imageCount > 0 && hasText) {
        promptParts.push(`Match the person's exact appearance from the reference photos (${weightPercent}% influence).`);
        promptParts.push(`Additional appearance details (${weightPercent}% influence): ${descriptionText.trim()}`);
      } else if (imageCount > 0) {
        promptParts.push(`Match the person's exact appearance from the reference photos (100% reference influence).`);
      } else if (hasText) {
        promptParts.push(`Appearance details (100% influence): ${descriptionText.trim()}`);
      }

      promptParts.push(`STYLE DIRECTIVE: Photorealistic, cinematic, ultra-detailed, high-resolution professional photography. RAW photo quality. Natural lighting. No illustrations or artistic renderings — this must look like a real photograph. Not an illustration, not a painting, not a digital render, natural skin texture, real human proportions.`);

      const finalPrompt = promptParts.join(" ");

      const result = await base44.integrations.Core.GenerateImage({
        prompt: finalPrompt,
        existing_image_urls: referenceUrls.length > 0 ? referenceUrls : undefined,
      });

      setGeneratedUrl(result.url);
      setGenerationPrompt(finalPrompt);
      onAvatarGenerated(result.url, referenceUrls, finalPrompt, descriptionText);
    } catch (error) {
      console.error('Avatar generation failed:', error);
      alert('Failed to generate avatar. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate = referenceUrls.length > 0 || descriptionText.trim().length > 0;

  // Weight label for display
  const imageCount = referenceUrls.length;
  const hasText = descriptionText.trim().length > 0;
  const totalSlots = imageCount + (hasText ? 1 : 0);
  const weightPercent = totalSlots > 0 ? Math.round(100 / totalSlots) : 100;

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
          Reference photos {referenceUrls.length > 0 ? `(${referenceUrls.length} · ${imageCount > 0 && totalSlots > 0 ? weightPercent : 100}% each)` : ""}
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
        <p className="text-xs text-muted-foreground mt-1.5">Upload real photos — each has equal influence on the result</p>
      </div>

      {/* Description text box */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Appearance Description</p>
          </div>
          {hasText && totalSlots > 0 && (
            <span className="text-[10px] text-primary/70 bg-primary/10 px-2 py-0.5 rounded-full">
              {weightPercent}% influence
            </span>
          )}
          {!hasText && (
            <span className="text-[10px] text-muted-foreground/50 bg-secondary px-2 py-0.5 rounded-full">
              100% if no photos
            </span>
          )}
        </div>
        <textarea
          value={descriptionText}
          onChange={(e) => setDescriptionText(e.target.value)}
          placeholder="Describe how you want this character to look — hair color, eye color, build, style, facial features, etc."
          rows={3}
          className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Counts as equal weight to each uploaded photo. Text alone = 100% influence.
        </p>
      </div>

      {/* Generate button */}
      {canGenerate && (
        <Button
          onClick={generateAvatar}
          disabled={isGenerating}
          variant="outline"
          className="w-full rounded-xl gap-2"
        >
          {isGenerating ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Generating avatar...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> {generatedUrl ? "Regenerate avatar" : "Generate avatar"}</>
          )}
        </Button>
      )}

      {!canGenerate && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Upload photos or add a description above to generate an avatar
        </p>
      )}

      {/* Generated prompt display */}
      {generationPrompt && (
        <div className="mt-2 p-3 rounded-xl bg-secondary/60 border border-border/60">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Last Generated Prompt</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{generationPrompt}</p>
        </div>
      )}
    </div>
  );
}