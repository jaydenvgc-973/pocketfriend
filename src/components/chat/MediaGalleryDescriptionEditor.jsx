import React, { useState } from "react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { X, Wand2, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveBestImageDescription } from "@/lib/descriptionResolver";

export default function MediaGalleryDescriptionEditor({ image, onClose, onSaved }) {
  const [mode, setMode] = useState("view"); // view | edit | generating
  const [editText, setEditText] = useState("");
  const [error, setError] = useState(null);

  const currentDescription = resolveBestImageDescription(image);
  const hasDescription = !!currentDescription;

  // Debug: log what resolver is returning
  console.log('[MediaGalleryDescriptionEditor] image fields:', {
    id: image.id,
    user_edited_description: image.user_edited_description,
    image_description: image.image_description,
    visual_analysis_description: image.visual_analysis_description,
    inferred_image_description: image.inferred_image_description,
    imageDescription: image.imageDescription,
    displayPrompt: image.displayPrompt,
    resolved: currentDescription?.substring(0, 100),
    hasDescription
  });

  const handleEditStart = () => {
    setEditText(currentDescription || "");
    setMode("edit");
    setError(null);
  };

  const handleSaveEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed.length < 5) {
      setError("Description must be at least 5 characters.");
      return;
    }

    try {
      await base44.entities.Message.update(image.id, {
        user_edited_description: trimmed,
        description_last_edited_by_user: true,
        description_edit_timestamp: new Date().toISOString(),
        description_source: "user_edited",
        image_analysis_status: "manual",
      });

      // Refetch the image to verify save
      const results = await base44.entities.Message.filter({ id: image.id }, '-created_date', 1);
      const updated = results?.[0];
      if (!updated || updated.user_edited_description !== trimmed) {
        throw new Error("Description was not saved correctly.");
      }

      setMode("view");
      setEditText("");
      onSaved?.(updated); // Pass updated data to parent
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
      setMode("edit");
    }
  };

  const handleGenerateDescription = async () => {
    setMode("generating");
    setError(null);
    try {
      // Confirm image URL is accessible and valid
      if (!image.url || image.url.trim().length === 0) {
        throw new Error("Image URL is missing or invalid.");
      }

      const analysisResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Provide a detailed, factual visual description of this image in 2-4 sentences.
Describe exactly what you see: people (appearance, expressions, clothing), objects, setting, lighting, and notable details.
Do NOT interpret meaning or make assumptions beyond what is literally visible.
Return ONLY the description text, nothing else.`,
        file_urls: [image.url],
      });

      const description = (typeof analysisResult === "string" ? analysisResult : "").trim();
      
      // Reject transport metadata and empty/generic descriptions
      if (!description || description.length < 10) {
        throw new Error("Analysis returned no usable description.");
      }
      if (/image sent to|photo shared|image attachment/i.test(description)) {
        throw new Error("Analysis returned transport metadata instead of visual description.");
      }

      // Save to backend
      await base44.entities.Message.update(image.id, {
        image_description: description,
        image_analysis_status: "complete",
        image_analysis_source: "media_gallery_manual_generate",
        image_analysis_is_inferred: true,
        description_source: "visual_analysis",
      });

      // Refetch to verify save
      const results = await base44.entities.Message.filter({ id: image.id }, '-created_date', 1);
      const updated = results?.[0];
      if (!updated || updated.image_description !== description) {
        throw new Error("Generated description was not saved correctly.");
      }

      setMode("view");
      setEditText("");
      onSaved?.(updated); // Pass updated data to parent
    } catch (err) {
      setError(`Generation failed: ${err.message}`);
      setMode("view");
    }
  };

  const handleCancel = () => {
    setMode("view");
    setEditText("");
    setError(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="space-y-3 border-t border-border pt-4"
    >
      {mode === "view" && (
        <>
          {hasDescription ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Image Description</p>
              <p className="text-sm text-foreground leading-relaxed">{currentDescription}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEditStart}
                  className="text-xs"
                >
                  Edit Description
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">No Description</p>
              <p className="text-xs text-muted-foreground">This image has no usable description. Generate one or add it manually.</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateDescription}
                  className="text-xs flex items-center gap-1"
                >
                  <Wand2 className="w-3 h-3" /> Generate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEditStart}
                  className="text-xs"
                >
                  Add Manually
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {mode === "edit" && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Edit Description</p>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Describe what you see in the image..."
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm resize-none focus:outline-none focus:border-primary"
            rows={4}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSaveEdit}
              className="text-xs flex items-center gap-1 bg-primary hover:bg-primary/90"
            >
              <Save className="w-3 h-3" /> Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              className="text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "generating" && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Generating Description</p>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-xs text-muted-foreground">Analyzing image...</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}