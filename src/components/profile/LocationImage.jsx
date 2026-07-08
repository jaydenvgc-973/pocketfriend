import { useState, useRef } from "react";
import { Upload, MapPin, Home } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { resolveLocationImageUrl } from "@/lib/locationUtils";

/**
 * LocationImage — canonical location image display + upload fallback.
 *
 * Uses resolveLocationImageUrl (same resolver as TravelLocationGrid) so
 * the same location displays the same image everywhere in the app.
 *
 * Upload fallback appears ONLY when the canonical resolver confirms no
 * image exists (checks zones AND top-level image_urls). Uploads go to
 * the existing LocationReference.image_urls field — no new storage.
 */
export default function LocationImage({ location, fallbackIcon: FallbackIcon = MapPin, iconClass = "w-8 h-8 text-primary/40" }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);

  const imageUrl = resolveLocationImageUrl(location);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !location?.id) return;
    setIsUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const existingImages = location.image_urls || [];
      await base44.entities.LocationReference.update(location.id, {
        image_urls: [...existingImages, file_url],
      });
      queryClient.invalidateQueries({ queryKey: ["userOwnedLocations"] });
      queryClient.invalidateQueries({ queryKey: ["userResidentLocations"] });
    } catch (err) {
      console.error("Location image upload failed:", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (imageUrl) {
    return (
      <img src={imageUrl} alt={location?.name || ""} className="w-full h-full object-cover" />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
      <FallbackIcon className={iconClass} />
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); fileInputRef.current?.click(); }}
        disabled={isUploading}
        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[9px] font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
      >
        <Upload className="w-3 h-3" />
        {isUploading ? "Uploading..." : "Add Image"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  );
}