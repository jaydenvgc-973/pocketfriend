import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { RefreshCw, Upload, Trash2, PawPrint } from "lucide-react";
import { PET_TYPES, petPrompt, emptyPet } from "@/lib/ownerBelongings";

/**
 * PetBelongingsEditor — one owner's pet and its reference image.
 *
 * The type is a dropdown with the common animals, plus a field for a pet that is not on
 * the list. The image is generated through the app's existing image generation or uploaded
 * from a photo, and stays the owner's established reference.
 */
export default function PetBelongingsEditor({ pet, onChange }) {
  const current = pet || emptyPet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setPet = (patch) => onChange({ ...current, ...patch });

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: petPrompt(current),
        existing_image_urls: current.image_url ? [current.image_url] : undefined,
      });
      if (result?.url) setPet({ image_url: result.url });
      else setError("That photo could not be drawn. Try again.");
    } catch {
      setError("That photo could not be drawn. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const res = await base44.integrations.Core.UploadPublicFile({ file });
      if (res?.file_url) setPet({ image_url: res.file_url });
    } catch {
      setError("That photo could not be uploaded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><PawPrint className="w-3.5 h-3.5 text-primary" /> Pet</p>
        {pet && (
          <button onClick={() => onChange(null)} className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Remove pet
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={current.pet_type || ""}
          onChange={(e) => setPet({ pet_type: e.target.value })}
          className="h-8 text-xs rounded-lg bg-background border border-input px-2 text-foreground"
        >
          <option value="">Choose a pet</option>
          {PET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Input value={current.name || ""} onChange={(e) => setPet({ name: e.target.value })} placeholder="Pet's name" className="h-8 text-xs rounded-lg" />
      </div>

      {current.pet_type === "other" && (
        <Input value={current.pet_type_custom || ""} onChange={(e) => setPet({ pet_type_custom: e.target.value })} placeholder="What kind of animal?" className="h-8 text-xs rounded-lg" />
      )}

      <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 p-2">
        <div className="w-[92px] h-[56px] rounded-lg overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0">
          {current.image_url ? <img src={current.image_url} alt={current.name || "pet"} className="w-full h-full object-cover" /> : <PawPrint className="w-4 h-4 text-muted-foreground/60" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground leading-tight">Their reference photo</p>
          <p className="text-[9px] text-muted-foreground leading-tight">Used for Walk Pet and at home.</p>
          <div className="flex items-center gap-1 mt-1">
            <button onClick={generate} disabled={busy} className="text-[9px] px-1.5 py-0.5 rounded-md border border-border text-foreground hover:border-primary/50 disabled:opacity-50 flex items-center gap-1">
              {busy ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />} Generate
            </button>
            <label className="text-[9px] px-1.5 py-0.5 rounded-md border border-border text-foreground hover:border-primary/50 cursor-pointer flex items-center gap-1">
              <Upload className="w-2.5 h-2.5" /> Upload
              <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </div>
        </div>
      </div>

      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}