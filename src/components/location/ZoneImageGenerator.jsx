import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Wand2, Loader, AlertCircle } from "lucide-react";
import { getBackgroundPopulationDiversityDirective } from "@/lib/imageDiversityConstraints";

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
        ? `\nCRITICAL VISUAL CONTINUITY REQUIREMENT — READ CAREFULLY:
The reference images show the EXACT same room/zone that already exists. You MUST generate a new photograph of THAT SAME ROOM from the OPPOSITE END of the room — a full 180-degree camera rotation from the reference image perspective.

MANDATORY RULES:
- If the reference shows the room looking toward the far wall → your image must be taken standing at that far wall looking back toward where the camera was
- The new image must preserve EVERY detail: same cabinets, countertops, flooring material, lighting fixtures, furniture pieces, color palette, wall colors, appliances, layout — all identical
- This is NOT a redesign. This is NOT a new room. This is the SAME ROOM from the complete opposite direction
- Camera placement must be physically impossible to confuse with the reference — opposite corner, opposite wall, opposite end of the room
- Preserve room identity: if it is a kitchen, it must still clearly be the same kitchen; if a living room, the same living room
- Do NOT change any furniture, colors, materials, or room identity
- The viewer should immediately recognize this as the same space from a completely different vantage point`
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

      const generateParams = { prompt: `${prompt}${getBackgroundPopulationDiversityDirective()}` };
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