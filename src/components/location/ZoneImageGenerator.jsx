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
  onGenerate
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const subtypeStr = Array.isArray(subtype) ? subtype.join(", ") : subtype;

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

Do NOT create fantasy, abstract, or stylized art. Make it look like a real space.`;

      const result = await base44.integrations.Core.GenerateImage({ prompt });
      if (result?.url) {
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