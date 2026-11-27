import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Wand2, Loader } from "lucide-react";

/**
 * The app's ONE description generator, reused by every place that can be described.
 *
 * A parent location describes itself from its name, category and venue types. A configured
 * space — an apartment, a house, a room, a workspace — passes its OWN reference images, and
 * the description is written from those images alone: the exact space whose Generate was
 * pressed, never a neighbouring unit and never the whole city it sits in.
 *
 * With no images it falls back to the established text behavior and says nothing about
 * images, so a description is never claimed to have been read from a picture that does
 * not exist.
 */
export default function LocationDescriptionGenerator({
  locationName,
  category,
  subtype,
  currentDescription,
  imageUrls = [],
  spaceLabel = "",
  onGenerate
}) {
  const [generating, setGenerating] = useState(false);

  const subject = spaceLabel?.trim() || locationName;
  const images = (imageUrls || []).filter(Boolean).slice(0, 4);
  const hasImages = images.length > 0;
  const hasText = !!(currentDescription && currentDescription.trim());

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const subtypeStr = Array.isArray(subtype) ? subtype.join(", ") : subtype;

      const imageInstruction = hasImages
        ? `The attached reference images are photographs of THIS exact space (${subject}). Describe only what they actually show: the room's layout, furnishings, surfaces, materials, colours, lighting, condition and atmosphere. Do not invent features, furniture or rooms the images do not show, and do not describe any other room, unit or the surrounding area.`
        : "";

      const prompt = hasText
        ? `Expand and enhance this description while preserving the original meaning and concept:

Space: ${subject}
Category: ${category}
${subtypeStr ? `Venue Type: ${subtypeStr}` : ""}

Original description: "${currentDescription}"

Make it more vivid, descriptive, and immersive while keeping the core idea intact. Add sensory details, atmosphere, and helpful context that fits the space. Keep it natural and grounded.${imageInstruction ? `\n\n${imageInstruction}` : ""}`
        : `${hasImages ? "Write a description of this space from its reference images." : "Generate a vivid, detailed description for this space."}

Space: ${subject}
Category: ${category}
${subtypeStr ? `Venue Type: ${subtypeStr}` : ""}

${imageInstruction || "Create an immersive description that captures the atmosphere, purpose, and character of this place. Include sensory details, layout, and mood. Keep it concise but evocative."}`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        ...(hasImages ? { file_urls: images } : {}),
      });
      if (result) {
        onGenerate(result);
      }
    } catch (err) {
      console.error("Description generation failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex gap-2 items-center">
      <Button
        onClick={handleGenerate}
        disabled={generating || !subject}
        variant="outline"
        size="sm"
        className="gap-1.5 rounded-lg"
      >
        {generating ? (
          <>
            <Loader className="w-3.5 h-3.5 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Wand2 className="w-3.5 h-3.5" />
            {hasText ? "Expand" : "Generate"}
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        {hasImages
          ? `From this space's ${images.length} image${images.length === 1 ? "" : "s"}`
          : hasText ? "Builds on your text" : "Creates a new description"}
      </p>
    </div>
  );
}