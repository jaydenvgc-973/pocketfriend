import { useState } from "react";
import { Hash, AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Wand2, Camera, ZoomIn } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ClosetImagePreviewModal from "@/components/character/ClosetImagePreviewModal";
import { analyzeClosetImage, mergePrefill } from "@/lib/closetImageAutofill";
import { generateClosetImage } from "@/lib/closetImageGeneration";

// The fields that describe what the outfit actually looks like.
const DESCRIPTIVE_FIELDS = ["top", "bottom", "shoes", "outerwear", "accessories", "hair_state", "full_description"];

// Canonical approved categories only — no travel, cold_weather, hot_weather, or medical
const OUTFIT_CATEGORIES = [
  { value: "lounge",        label: "Lounge / Home",       emoji: "🛋️" },
  { value: "sleepwear",     label: "Sleepwear",           emoji: "😴" },
  { value: "bath",          label: "Bath / Robe",         emoji: "🛁" },
  { value: "daily_casual",  label: "Daily Casual",        emoji: "👕" },
  { value: "work",          label: "Work",                emoji: "👔" },
  { value: "school",        label: "School",              emoji: "🎒" },
  { value: "outdoor",       label: "Outdoor / Errands",   emoji: "🌳" },
  { value: "nightlife",     label: "Nightlife / Party",   emoji: "🌃" },
  { value: "formal",        label: "Formal",              emoji: "🎩" },
  { value: "date_night",    label: "Date Night",          emoji: "💘" },
  { value: "church",        label: "Church / Religious",  emoji: "🛐" },
  { value: "special",       label: "Special / Statement", emoji: "✨" },
  { value: "gym",           label: "Gym / Workout",       emoji: "🏋️" },
  { value: "swimwear",      label: "Swimwear",            emoji: "🏊" },
];

/**
 * OutfitEditModal
 *
 * Opens an existing outfit in edit mode. Updates in-place by outfit_id.
 * Never creates a duplicate — always patches the existing record.
 *
 * Props:
 *   outfit      — the existing outfit object (must have outfit_id)
 *   owner       — whose closet this is: { kind: "character"|"user", characterId, name, userEmail }
 *                 A generated image must depict this owner, never a generic person.
 *   onSave      — async (updatedOutfit) => void  — caller patches the closet array
 *   onCancel    — () => void
 */
export default function OutfitEditModal({ outfit, owner = null, onSave, onCancel }) {
  const [form, setForm] = useState({
    label:            outfit.label            || "",
    category:         outfit.category         || "daily_casual",
    rotation_number:  outfit.rotation_number  ?? "",
    top:              outfit.top              || "",
    bottom:           outfit.bottom           || "",
    shoes:            outfit.shoes            || "",
    outerwear:        outfit.outerwear        || "",
    accessories:      outfit.accessories      || "",
    hair_state:       outfit.hair_state       || "",
    full_description: outfit.full_description || "",
    is_favorite:      outfit.is_favorite      || false,
  });
  const [imageUrl, setImageUrl]         = useState(outfit.image_url || "");
  const [uploading, setUploading]       = useState(false);
  const [generatingImg, setGeneratingImg] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [previewModal, setPreviewModal] = useState(false);
  const [fillingFromImage, setFillingFromImage] = useState(false);
  const [fillNote, setFillNote]         = useState(null);
  const [genError, setGenError]         = useState(null);

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await base44.integrations.Core.UploadFile({ file });
    if (res?.file_url) setImageUrl(res.file_url);
    setUploading(false);
  };

  // Read the outfit's own image and turn what is visible into its description fields.
  // Empty fields are filled in; when every field is already written the descriptions are
  // replaced with what the photo shows, because pressing the button is that request.
  const handleAiFill = async () => {
    if (!imageUrl || fillingFromImage) return;
    setFillingFromImage(true);
    setFillNote(null);
    try {
      const result = await analyzeClosetImage({ imageUrl, isOutfit: true });
      const prefill = {};
      DESCRIPTIVE_FIELDS.forEach((key) => {
        if (typeof result?.[key] === "string" && result[key].trim()) prefill[key] = result[key].trim();
      });
      if (Object.keys(prefill).length === 0) {
        setFillNote("Nothing readable in this photo — nothing was changed.");
        return;
      }
      const hasEmptyField = DESCRIPTIVE_FIELDS.some((key) => !String(form[key] || "").trim());
      setForm(prev => (hasEmptyField ? mergePrefill(prev, prefill) : { ...prev, ...prefill }));
      setFillNote(hasEmptyField
        ? "Filled the empty fields from the photo — review before saving."
        : "Replaced the descriptions with what the photo shows — review before saving.");
    } catch (e) {
      console.error("AI fill failed:", e);
      setFillNote("The photo could not be read — nothing was changed.");
    } finally {
      setFillingFromImage(false);
    }
  };

  const handleGenerateImage = async () => {
    const desc = form.full_description || [form.top, form.bottom, form.shoes, form.outerwear, form.accessories].filter(Boolean).join(", ");
    if (!desc) return;
    setGeneratingImg(true);
    setGenError(null);
    try {
      // The closet's owner wears it — the identity is already known from the closet itself.
      const url = await generateClosetImage({
        ownerKind: owner?.kind,
        characterId: owner?.characterId,
        userEmail: owner?.userEmail,
        ownerName: owner?.name,
        description: desc,
      });
      setImageUrl(url);
    } catch (e) {
      console.error("Image generation failed:", e);
      setGenError(e?.message || "The image could not be generated. Try again.");
    }
    setGeneratingImg(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      // Preserve all existing fields — only patch what the form controls
      const rotNum = form.rotation_number === "" || form.rotation_number == null
        ? null
        : parseInt(String(form.rotation_number), 10) || null;
      await onSave({
        ...outfit,          // preserve outfit_id, created_at, type, etc.
        ...form,            // override editable fields
        rotation_number: rotNum,
        image_url: imageUrl,
        updated_at: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 flex items-end sm:items-center justify-center p-4"
            onClick={onCancel}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Edit Outfit</p>
                <button onClick={onCancel} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Input value={form.label} onChange={e => update("label", e.target.value)} placeholder="Outfit name *" className="h-9 text-sm rounded-xl" />
                </div>
                <div className="col-span-2">
                  <select value={form.category} onChange={e => update("category", e.target.value)} className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm">
                    {OUTFIT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    # Rotation Number (within category)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="99"
                    value={form.rotation_number}
                    onChange={e => update("rotation_number", e.target.value)}
                    placeholder="e.g. 1, 2, 3…"
                    className="h-9 text-sm rounded-xl"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Rotation cycles outfits by this number within the same category.</p>
                </div>
                <Input value={form.top}         onChange={e => update("top", e.target.value)}         placeholder="Top"                  className="h-9 text-sm rounded-xl" />
                <Input value={form.bottom}      onChange={e => update("bottom", e.target.value)}      placeholder="Bottom"               className="h-9 text-sm rounded-xl" />
                <Input value={form.shoes}       onChange={e => update("shoes", e.target.value)}       placeholder="Shoes"                className="h-9 text-sm rounded-xl" />
                <Input value={form.outerwear}   onChange={e => update("outerwear", e.target.value)}   placeholder="Outerwear (optional)" className="h-9 text-sm rounded-xl" />
                <div className="col-span-2">
                  <Input value={form.accessories} onChange={e => update("accessories", e.target.value)} placeholder="Accessories (optional)" className="h-9 text-sm rounded-xl" />
                </div>
                <div className="col-span-2">
                  <Input value={form.hair_state} onChange={e => update("hair_state", e.target.value)} placeholder="Hair state (optional)" className="h-9 text-sm rounded-xl" />
                </div>
                <div className="col-span-2">
                  <Textarea
                    value={form.full_description}
                    onChange={e => update("full_description", e.target.value)}
                    placeholder="Full outfit description..."
                    className="text-sm rounded-xl min-h-[60px] resize-none"
                    rows={2}
                  />
                </div>
              </div>

              {/* Current image — click to preview/delete */}
              {imageUrl && (
                <div className="relative group cursor-pointer" onClick={() => setPreviewModal(true)}>
                  <img src={imageUrl} alt="Outfit" className="w-full h-36 object-cover rounded-xl" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-xl transition-colors flex items-center justify-center">
                    <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              )}

              {/* Fill the description fields from the outfit's own photo */}
              {imageUrl && (
                <div className="space-y-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAiFill}
                    disabled={fillingFromImage || uploading}
                    className="w-full rounded-xl gap-1.5"
                  >
                    {fillingFromImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    {fillingFromImage ? "Reading outfit from photo…" : "AI Fill from Photo"}
                  </Button>
                  {fillNote && <p className="text-[10px] text-muted-foreground">{fillNote}</p>}
                </div>
              )}

              {/* Actions row */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleGenerateImage} disabled={generatingImg || (!form.full_description && !form.top)} className="flex-1 rounded-xl gap-1">
                  {generatingImg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {generatingImg ? "Generating..." : "New Image"}
                </Button>
                <label className="flex-1 flex items-center justify-center gap-1 cursor-pointer px-3 py-2 rounded-xl border border-border hover:border-primary/40 transition-colors text-xs text-muted-foreground">
                  <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  {uploading ? "Uploading..." : "Upload Photo"}
                </label>
              </div>
              {genError && <p className="text-[10px] text-amber-400">{genError}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
                <Button size="sm" onClick={handleSave} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Save Changes
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {previewModal && imageUrl && (
        <ClosetImagePreviewModal
          imageUrl={imageUrl}
          imageType="uploaded_reference"
          onClose={() => setPreviewModal(false)}
          onDelete={() => {
            console.log(`[OutfitEditModal] DELETE | url: ${imageUrl}`);
            setImageUrl("");
            console.log("[OutfitEditModal] imageUrl cleared | form preserved");
            setPreviewModal(false);
          }}
        />
      )}
    </>
  );
}