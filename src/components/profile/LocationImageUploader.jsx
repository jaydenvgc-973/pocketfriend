import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";

/**
 * LocationImageUploader
 *
 * Upload fallback for a LocationReference that has NO existing authoritative
 * image (no zone images, no top-level image_urls). Writes the uploaded image
 * to LocationReference.image_urls — the same field TravelLocationGrid falls
 * back to. No parallel image system.
 *
 * After upload, invalidates the shared ["locationReferences", ownerEmail]
 * cache key used by Travel, Places, Home, and MyProfile.
 */
export default function LocationImageUploader({ locationId, ownerEmail, onUploaded }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !locationId) return;
    setUploading(true);
    setError(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      if (!file_url) throw new Error("Upload failed — no URL returned.");
      await base44.entities.LocationReference.update(locationId, {
        image_urls: [file_url],
      });
      // Invalidate the shared location cache key — same key used by Travel, Places, Home, and MyProfile.
      queryClient.invalidateQueries({ queryKey: ["locationReferences", ownerEmail] });
      if (onUploaded) onUploaded(file_url);
    } catch (err) {
      setError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="w-full">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full py-1.5 rounded-lg border border-dashed border-border text-[9px] text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors font-medium flex items-center justify-center gap-1"
      >
        {uploading ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Uploading...</>
        ) : (
          <><Camera className="w-3 h-3" /> Add Image</>
        )}
      </button>
      {error && <p className="text-[8px] text-destructive mt-0.5 text-center">{error}</p>}
    </div>
  );
}