import React, { useState } from "react";
import { X, Upload } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ZoneImageGenerator from "@/components/location/ZoneImageGenerator";

/**
 * WorkplaceZoneImages — the zone images of ONE business inside a property.
 *
 * Each image stays attached to the zone it was generated for, and the same image URL is
 * also written into that zone's image_urls on the parent location, so the existing
 * reference usage (Scenes and everything else that reads zone references) is unchanged.
 *
 * Props:
 *   workplace              the business, with its zone_names and zone_images
 *   locationZones          the parent property's zones (for continuity references)
 *   locationName           the parent property's name
 *   category / subtype     the parent property's category / venue types (fallbacks)
 *   locationDescription    the parent property's description (fallback)
 *   otherWorkplaces        the property's other businesses, so a picture already
 *                          attached to another business is never shown here
 *   onAddImage(zoneName, url)
 *   onRemoveImage(zoneName, url)
 */
export default function WorkplaceZoneImages({
  workplace,
  locationZones = [],
  locationName = "",
  category = "",
  subtype = [],
  locationDescription = "",
  otherWorkplaces = [],
  onAddImage,
  onRemoveImage,
  maxImages = 5,
}) {
  const [uploadingZone, setUploadingZone] = useState(null);
  const zoneNames = workplace?.zone_names || [];
  const zoneImages = workplace?.zone_images || [];
  const businessName = workplace?.name?.trim() || "this business";
  // Every kind of establishment this business is, so its pictures are generated from all of
  // its venue types, not only the first one.
  const businessSubtypes = Array.isArray(workplace?.business_types) && workplace.business_types.length > 0
    ? workplace.business_types.map(t => t.type).filter(Boolean)
    : (workplace?.business_type ? [workplace.business_type] : []);

  // Uploading uses the same storage and the same 5-images-per-zone limit as the property's
  // own Rooms / Zones section.
  const handleUpload = async (zoneName, event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const remaining = Math.max(0, maxImages - imagesForZone(zoneName).length);
    const toUpload = files.slice(0, remaining);
    if (toUpload.length === 0) return;
    setUploadingZone(zoneName);
    const uploaded = [];
    for (const file of toUpload) {
      try {
        const res = await base44.integrations.Core.UploadFile({ file });
        if (res?.file_url) uploaded.push(res.file_url);
      } catch (err) {
        console.error("[WorkplaceZoneImages] Upload failed:", err?.message);
      }
    }
    uploaded.forEach(url => onAddImage?.(zoneName, url));
    setUploadingZone(null);
  };

  // A picture that already sits on one of this business's zones in the property is this
  // business's picture, even when it was made before the business had its own image
  // record — the master zone list is the authority on what exists. Only pictures that
  // another business has claimed for itself are left out.
  const claimedByOtherBusinesses = new Set();
  otherWorkplaces.forEach(w => (w.zone_images || []).forEach(zi => { if (zi?.url) claimedByOtherBusinesses.add(zi.url); }));
  const imagesForZone = (zoneName) => {
    const own = zoneImages.filter(i => i.zone_name === zoneName);
    const ownUrls = new Set(own.map(i => i.url));
    const parentZone = (locationZones || []).find(z => z.zone_name === zoneName);
    const existing = (parentZone?.image_urls || [])
      .filter(url => url && !ownUrls.has(url) && !claimedByOtherBusinesses.has(url))
      .map(url => ({ zone_name: zoneName, url }));
    return [...own, ...existing];
  };

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Zone Images</label>
      {zoneNames.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">Select this business's zones above to generate their images.</p>
      ) : (
        <div className="space-y-1.5">
          {zoneNames.map(zoneName => {
            const images = imagesForZone(zoneName);
            const parentZone = (locationZones || []).find(z => z.zone_name === zoneName);
            return (
              <div key={zoneName} className="rounded-lg bg-secondary/40 border border-border p-2 space-y-1.5">
                <p className="text-[11px] font-medium text-foreground truncate">
                  {zoneName}
                  <span className="text-muted-foreground/70"> · {businessName}</span>
                </p>
                {images.length > 0 ? (
                  <div className="grid grid-cols-4 gap-1.5">
                    {images.map(img => (
                      <div key={img.url} className="relative group">
                        <img src={img.url} alt={zoneName} className="w-full aspect-square object-cover rounded-md" />
                        <button
                          onClick={() => onRemoveImage?.(zoneName, img.url)}
                          title="Remove this image"
                          className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-2.5 h-2.5 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">No images for this zone yet.</p>
                )}
                {images.length < maxImages ? (
                  <div className="space-y-1.5">
                    <label className="block cursor-pointer">
                      <input type="file" accept="image/*" multiple onChange={e => handleUpload(zoneName, e)} className="hidden" />
                      <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-[10px]">
                        <Upload className="w-3 h-3" />
                        {uploadingZone === zoneName ? "Uploading..." : `Upload images (${maxImages - images.length} remaining)`}
                      </div>
                    </label>
                    <ZoneImageGenerator
                      zoneName={zoneName}
                      locationName={locationName ? `${businessName} — inside ${locationName}` : businessName}
                      category={workplace?.business_category || category}
                      subtype={businessSubtypes}
                      locationDescription={workplace?.description?.trim() || locationDescription}
                      hasExistingImage={images.length > 0}
                      existingZoneImageUrls={parentZone?.image_urls || []}
                      onGenerate={(url) => onAddImage?.(zoneName, url)}
                    />
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground text-center">Maximum {maxImages} images per zone reached</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}