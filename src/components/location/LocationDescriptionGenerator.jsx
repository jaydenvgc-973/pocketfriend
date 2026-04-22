import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Wand2, Loader } from "lucide-react";

export default function LocationDescriptionGenerator({
  locationName,
  category,
  subtype,
  currentDescription,
  onGenerate
}) {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const subtypeStr = Array.isArray(subtype) ? subtype.join(", ") : subtype;
      const prompt = currentDescription && currentDescription.trim()
        ? `Expand and enhance this location description while preserving the original meaning and concept:

Location: ${locationName}
Category: ${category}
${subtypeStr ? `Venue Type: ${subtypeStr}` : ""}

Original description: "${currentDescription}"

Make it more vivid, descriptive, and immersive while keeping the core idea intact. Add sensory details, atmosphere, and helpful context that fits the venue type and category. Keep it natural and grounded.`
        : `Generate a vivid, detailed description for this location:

Name: ${locationName}
Category: ${category}
${subtypeStr ? `Venue Type: ${subtypeStr}` : ""}

Create an immersive description that captures the atmosphere, purpose, and character of this place. Include sensory details, layout, and mood. Keep it concise but evocative.`;

      const result = await base44.integrations.Core.InvokeLLM({ prompt });
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
        disabled={generating || !locationName}
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
            {currentDescription?.trim() ? "Expand" : "Generate"}
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        {currentDescription?.trim() ? "Builds on your text" : "Creates a new description"}
      </p>
    </div>
  );
}