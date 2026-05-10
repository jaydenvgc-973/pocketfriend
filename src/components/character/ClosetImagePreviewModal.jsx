import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ClosetImagePreviewModal
 *
 * Full-screen lightbox for uploaded or AI-generated outfit images.
 * Includes a distinct Delete button that only clears the image field —
 * the outfit form stays open and all text fields are preserved.
 *
 * Props:
 *   imageUrl   — URL of the image to display
 *   imageType  — "uploaded_reference" | "generated_preview"
 *   onClose    — () => void
 *   onDelete   — () => void  — clears the image field only, does NOT cancel the outfit
 */
export default function ClosetImagePreviewModal({ imageUrl, imageType, onClose, onDelete }) {
  if (!imageUrl) return null;

  const typeLabel = imageType === "generated_preview" ? "AI-Generated Preview" : "Uploaded Reference";

  const handleDelete = () => {
    console.log(`[ClosetImagePreview] DELETE fired | type: ${imageType} | url exists: ${!!imageUrl}`);
    onDelete();
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] bg-black/90 flex flex-col items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="flex flex-col items-center gap-4 w-full max-w-lg"
        >
          {/* Label */}
          <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">{typeLabel}</p>

          {/* Image — full size, aspect-ratio preserved */}
          <img
            src={imageUrl}
            alt={typeLabel}
            className="w-full max-h-[70vh] object-contain rounded-2xl shadow-2xl"
          />

          {/* Action buttons */}
          <div className="flex gap-3 w-full max-w-xs">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 rounded-xl border-white/20 text-white hover:bg-white/10 hover:text-white bg-transparent"
            >
              <X className="w-4 h-4 mr-1.5" /> Close
            </Button>
            <Button
              onClick={handleDelete}
              className="flex-1 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Remove Image
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}