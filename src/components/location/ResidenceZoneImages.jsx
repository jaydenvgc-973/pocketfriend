import React, { useState } from "react";
import { X, Upload } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ZoneImageGenerator from "@/components/location/ZoneImageGenerator";
import { resolveSpaceDescription } from "@/lib/spaceDescription";

/**
 * ResidenceZoneImages — the reference images of ONE residence's own spaces.
 *
 * A residence is not a single room: an apartment has a living room, a kitchen, a bedroom;
 * an encampment has a tent, a bridge, a sidewalk. Each picture stays attached to the space
 * it was made for, and it belongs to THIS residence — two residences that both have a
 * Living Room never share one picture.
 *
 * The same image URL is also written into that zone's image_urls on the parent property,
 * so the existing reference usage (Scenes and everything else that reads zone references)
 * is unchanged. Pictures another residence has already claimed for itself are never shown
 * here, and a space is never required to already have a picture before it can be used.
 */
export default function ResidenceZoneImages({
  residenceLabel = "this residence",
  zoneNames = [],
  zoneImages = [],
  propertyZones = [],
  otherResidences = [],
  locationName = "",
  category = "",
  subtype = [],
  locationDescription = "",
  // The residence this room belongs to. Its own description (or this room's) is what the
  // picture is composed from — never another residence's and never the whole property's
  // when this space has something more specific to say.
  unit = null,
  maxImages = 5,
  onAddImage,
  onRemoveImage,
}) {
  const [uploadingZone, setUploadingZone] = useState(null);

  // Pictures another residence of the same property has claimed for itself.
  const claimedElsewhere = new Set();
  (otherResidences || []).forEach(r => (r?.zone_images || []).forEach(zi => { if (zi?.url) claimedElsewhere.add(zi.url); }));

  const imagesForZone = (zoneName) => {
    const own = (zoneImages || []).filter(i => i?.zone_name === zoneName && i?.url);
    const ownUrls = new Set(own.map(i => i.url));
    const parentZone = (propertyZones || []).find(z => z.zone_name === zoneName);
    const inherited = (parentZone?.image_urls || [])
      .filter(url => url && !ownUrls.has(url) && !claimedElsewhere.has(url))
      .map(url => ({ zone_name: zoneName, url }));
    return [...own, ...inherited];
  };

  // Removing takes the picture out of this residence. The property's own list only loses
  // it when no other residence still uses it.
  const handleRemove = (zoneName, url) => {
    onRemoveImage?.(zoneName, url);
  };

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
        const res = await base44.integrations.Core.UploadPublicFile({ file });
        if (res?.file_url) uploaded.push(res.file_url);
      } catch (err) {
        console.error("[ResidenceZoneImages] Upload failed:", err?.message);
      }
    }
    uploaded.forEach(url => onAddImage?.(zoneName, url));
    setUploadingZone(null);
  };

  if (zoneNames.length === 0) {
    return (
      <div className="space-y-1.5">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Space images</label>
        <p className="text-[10px] text-muted-foreground italic">
          Choose this residence's spaces above — each one keeps its own reference images.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Space images</label>
      <div className="space-y-1.5">
        {zoneNames.map(zoneName => {
          const images = imagesForZone(zoneName);
          const parentZone = (propertyZones || []).find(z => z.zone_name === zoneName);
          return (
            <div key={zoneName} className="rounded-lg bg-secondary/40 border border-border p-2 space-y-1.5">
              <p className="text-[11px] font-medium text-foreground truncate">
                {zoneName}
                <span className="text-muted-foreground/70"> · {residenceLabel}</span>
              </p>
              {images.length > 0 ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {images.map(img => (
                    <div key={img.url} className="relative group">
                      <img src={img.url} alt={zoneName} className="w-full aspect-square object-cover rounded-md" />
                      <button
                        type="button"
                        onClick={() => handleRemove(zoneName, img.url)}
                        title="Remove this image from this residence"
                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic">No images for this space yet.</p>
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
                    locationName={locationName ? `${residenceLabel} — inside ${locationName}` : residenceLabel}
                    category={category}
                    subtype={subtype}
                    locationDescription={resolveSpaceDescription({ space: unit, zoneName, zones: propertyZones, locationDescription }).text}
                    hasExistingImage={images.length > 0}
                    existingZoneImageUrls={parentZone?.image_urls || []}
                    onGenerate={(url) => onAddImage?.(zoneName, url)}
                  />
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground text-center">Maximum {maxImages} images per space reached</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}