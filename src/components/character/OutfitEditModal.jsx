import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Wand2, Camera } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ClosetImagePreviewModal from "@/components/character/ClosetImagePreviewModal";

const OUTFIT_CATEGORIES = [
  { value: "daily_casual",  label: "Daily Casual",       emoji: "👕" },
  { value: "work",          label: "Work",                emoji: "👔" },
  { value: "gym",           label: "Gym / Workout",       emoji: "🏋️" },
  { value: "church",        label: "Church / Religious",  emoji: "🛐" },
  { value: "nightlife",     label: "Nightlife / Party",   emoji: "🌃" },
  { value: "formal",        label: "Formal",              emoji: "🎩" },
  { value: "sleepwear",     label: "Sleepwear",           emoji: "😴" },
  { value: "lounge",        label: "Lounge / Home",       emoji: "🛋️" },
  { value: "outdoor",       label: "Outdoor / Errands",   emoji: "🌳" },
  { value: "swimwear",      label: "Swimwear",            emoji: "🏊" },
  { value: "bath",          label: "Bath / Robe",         emoji: "🛁" },
  { value: "school",        label: "School",              emoji: "🎒" },
  { value: "date_night",    label: "Date Night",          emoji: "💘" },
  { value: "travel",        label: "Travel",              emoji: "✈️" },
  { value: "cold_weather",  label: "Cold Weather",        emoji: "🧣" },
  { value: "hot_weather",   label: "Hot Weather",         emoji: "☀️" },
  { value: "special",       label: "Special / Statement", emoji: "✨" },
  { value: "medical",       label: "Medical",             emoji: "🏥" },
];

/**
 * OutfitEditModal
 *
 * Opens an existing outfit in edit mode. Updates in-place by outfit_id.
 * Never creates a duplicate — always patches the existing record.
 *
 * Props:
 *   outfit      — the existing outfit object (must have outfit_id)
 *   onSave      — async (updatedOutfit) => void  — caller patches the closet array
 *   onCancel    — () => void
 */
export default function OutfitEditModal({ outfit, onSave, onCancel }) {
  const [form, setForm] = useState({
    label:            outfit.label            || "",
    category:         outfit.category         || "daily_casual",
    top:              outfit.top              || "",
    bottom:           outfit.bottom           || "",
    shoes:            outfit.shoes            || "",
    outerwear:        outfit.outerwear        || "",
    accessories:      outfit.accessories      || "",
    hair_state:       outfit.hair_state       || "",
    full_description: outfit.full_description || "",
    is_favorite:      outfit.is_favorite      || false,
  });
  const [imageUrl, setImageUrl]           = useState(outfit.image_url || "");
  const [uploading, setUploading]         = useState(false);
  const [generatingImg, setGeneratingImg] = useState(false);
  const [saving, setSaving]               = useState(false);
  const [previewModal, setPreviewModal]   = useState(false);

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await base44.integrations.Core.UploadFile({ file });
    if (res?.file_url) setImageUrl(res.file_url);
    setUploading(false);
  };

  const handleGenerateImage = async () => {
    const desc = form.full_description || [form.top, form.bottom, form.shoes, form.outerwear, form.accessories].filter(Boolean).join(", ");
    if (!desc) return;
    setGeneratingImg(true);
    try {
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Full body fashion photo of a person wearing: ${desc}. Standing pose, clean background, lifestyle photography, photorealistic.`,
      });
      if (res?.url) setImageUrl(res.url);
    } catch (e) {
      console.error("Image generation failed:", e);
    }
    setGeneratingImg(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      // Preserve all existing fields — only patch what the form controls
      await onSave({
        ...outfit,          // preserve outfit_id, created_at, type, etc.
        ...form,            // override editable fields
        image_url: imageUrl,
        updated_at: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
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

          {/* Current image — tap to preview/remove */}
          {imageUrl && (
            <div>
              <button
                type="button"
                onClick={() => setPreviewModal(true)}
                className="w-full focus:outline-none"
                title="Tap to view full image"
              >
                <img src={imageUrl} alt="Outfit" className="w-full h-36 object-cover rounded-xl hover:opacity-90 transition-opacity cursor-zoom-in" />
              </button>
              <p className="text-[10px] text-muted-foreground text-center mt-1">Tap to view or remove image</p>
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

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          </div>
        </motion.div>
      </motion.div>

      {/* Image preview / delete modal */}
      {previewModal && (
        <ClosetImagePreviewModal
          imageUrl={imageUrl}
          imageType="uploaded_reference"
          onClose={() => setPreviewModal(false)}
          onDelete={() => {
            console.log(`[OutfitEditModal] Image removed | url cleared | form preserved`);
            setImageUrl("");
          }}
        />
      )}
    </AnimatePresence>,
    document.body
  );
}