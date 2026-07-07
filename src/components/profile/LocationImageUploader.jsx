import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";

/**
 * LocationImageUploader
 *
 * Allows the user to upload/set a reference image for a LocationReference
 * that has no image_urls[0]. Writes the uploaded image back to the
 * LocationReference.image_urls field — the same authoritative field
 * read elsewhere in the app. No parallel image system.
 *
 * After upload, invalidates the owned/resident location queries so the
 * card immediately reflects the new image.
 */
export default function LocationImageUploader({ locationId, ownerUserId, onUploaded }) {
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
      // Invalidate all location queries used by MyProfile so cards refresh immediately
      queryClient.invalidateQueries({ queryKey: ["userOwnedLocations", ownerUserId] });
      queryClient.invalidateQueries({ queryKey: ["userResidentLocations", ownerUserId] });
      queryClient.invalidateQueries({ queryKey: ["userHomeLocation", locationId] });
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