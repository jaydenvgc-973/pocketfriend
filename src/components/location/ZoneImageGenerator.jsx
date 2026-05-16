import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Wand2, Loader, AlertCircle } from "lucide-react";

export default function ZoneImageGenerator({
  zoneName,
  locationName,
  category,
  subtype,
  locationDescription,
  hasExistingImage,
  existingZoneImageUrls = [],
  onGenerate
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const subtypeStr = Array.isArray(subtype) ? subtype.join(", ") : subtype;

      const continuityInstruction = existingZoneImageUrls && existingZoneImageUrls.length > 0
        ? `\nVISUAL CONTINUITY REQUIREMENT: This zone already has existing reference images. Generate a new view of THE SAME SPACE from a different camera angle/position. The new image must:
- Show the same room/zone identity (same furniture, layout, materials, color palette, lighting style)
- Be a different viewpoint or angle of that same space (e.g., from across the room, from the doorway, from another corner)
- Preserve all the continuity markers visible in the reference images
- NOT redesign the room or create a completely different space
- Maintain the same overall atmosphere and functional layout`
        : "";

      const prompt = `Generate a realistic, detailed photograph of a ${zoneName} in a ${category} ${subtypeStr ? `(${subtypeStr})` : ""}.

Location: ${locationName}
Zone/Room: ${zoneName}
Category: ${category}
${subtypeStr ? `Venue Type: ${subtypeStr}` : ""}
${locationDescription ? `Setting Context: ${locationDescription}` : ""}

Create a photo that:
- Accurately represents the space type and function
- Matches the category and venue type (not mismatched aesthetics)
- Shows realistic details, furniture, lighting, and atmosphere
- Feels like an actual photograph of the real place
- Is composition-wise a natural room/zone view
${continuityInstruction}

Do NOT create fantasy, abstract, or stylized art. Make it look like a real space.`;

      console.log(`[ZONE-IMG-GEN] zone="${zoneName}" location="${locationName}" existing_refs=${existingZoneImageUrls?.length || 0} prompt_includes_continuity=${continuityInstruction.length > 0}`);
      if (existingZoneImageUrls?.length > 0) {
        console.log(`[ZONE-IMG-GEN] reference_urls=[${existingZoneImageUrls.join(", ")}]`);
      }

      const generateParams = { prompt };
      if (existingZoneImageUrls && existingZoneImageUrls.length > 0) {
        generateParams.existing_image_urls = existingZoneImageUrls;
        console.log(`[ZONE-IMG-GEN] passing_existing_images_as_references`);
      }

      const result = await base44.integrations.Core.GenerateImage(generateParams);
      if (result?.url) {
        console.log(`[ZONE-IMG-GEN] generated_url=${result.url} zone="${zoneName}"`);
        onGenerate(result.url);
      } else {
        setError("Failed to generate image. Please try again.");
      }
    } catch (err) {
      console.error("Image generation failed:", err);
      setError("Image generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleGenerate}
        disabled={generating || !zoneName || !locationName}
        variant="outline"
        size="sm"
        className="gap-1.5 rounded-lg w-full justify-center"
      >
        {generating ? (
          <>
            <Loader className="w-3.5 h-3.5 animate-spin" />
            Generating Image...
          </>
        ) : (
          <>
            <Wand2 className="w-3.5 h-3.5" />
            {hasExistingImage ? "Generate Another" : "Generate Zone Image"}
          </>
        )}
      </Button>
      {error && (
        <div className="flex gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}