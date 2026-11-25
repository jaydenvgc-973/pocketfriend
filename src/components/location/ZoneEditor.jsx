import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, Upload } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import ZoneImageGenerator from "@/components/location/ZoneImageGenerator";

/**
 * ZoneEditor — one room / zone of a location, with its own reference images.
 *
 * Unchanged behaviour: up to 5 images, uploaded or generated, each attached to this zone's
 * own image list. A picture that belongs to one of the property's businesses is labelled
 * with that business's name so the master list can name whose room it is.
 */
export default function ZoneEditor({ zone, onUpdateImages, onDelete, onTogglePrimaryCategory, readOnly = false, locationName = "", category = "", subtype = [], locationDescription = "", workplaceByImageUrl = {} }) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 5 - (zone.image_urls?.length || 0);
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    const uploaded = [];
    for (const file of toUpload) {
      let res = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await base44.integrations.Core.UploadFile({ file });
          break;
        } catch (err) {
          const status = err?.response?.status || err?.status;
          if ((status === 502 || status === 503 || status === 504) && attempt < 2) {
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          } else {
            console.error('[ZoneEditor] Upload failed:', err?.message);
            break;
          }
        }
      }
      if (res?.file_url) uploaded.push(res.file_url);
    }
    onUpdateImages([...(zone.image_urls || []), ...uploaded]);
    setUploading(false);
  };

  const removeImage = (i) => {
    onUpdateImages((zone.image_urls || []).filter((_, idx) => idx !== i));
  };

  const handleGeneratedImage = (imageUrl) => {
    onUpdateImages([...(zone.image_urls || []), imageUrl]);
  };

  const imgCount = zone.image_urls?.length || 0;

  return (
    <div className="border border-border rounded-xl p-3 space-y-3 bg-secondary/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{zone.zone_name}</p>
        {!readOnly && <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
        <X className="w-3.5 h-3.5" />
        </button>}
      </div>
      {!readOnly && (
        <label className="flex items-center gap-2 cursor-pointer select-none -mt-1">
          <Checkbox
            checked={!!zone.is_primary_category}
            onCheckedChange={(checked) => onTogglePrimaryCategory?.(checked === true)}
          />
          <span className="text-[11px] text-muted-foreground">Part of Main Category</span>
        </label>
      )}
      {imgCount > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {zone.image_urls.map((url, i) => {
            const workplaceName = workplaceByImageUrl[url];
            return (
              <div key={i} className="relative group">
                <img src={url} alt={`${zone.zone_name} ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                {!readOnly && <button
                  onClick={() => removeImage(i)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3 text-white" />
                </button>}
                {workplaceName && (
                  <p className="text-[9px] text-muted-foreground truncate text-center mt-0.5" title={`${zone.zone_name}, ${workplaceName}`}>
                    {workplaceName}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!readOnly && imgCount < 5 && (
        <div className="space-y-2">
          <label className="block cursor-pointer">
            <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
            <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? "Uploading..." : `Upload images (${5 - imgCount} remaining)`}
            </div>
          </label>
          <ZoneImageGenerator
            zoneName={zone.zone_name}
            locationName={locationName}
            category={category}
            subtype={subtype}
            locationDescription={locationDescription}
            hasExistingImage={imgCount > 0}
            existingZoneImageUrls={zone.image_urls || []}
            onGenerate={handleGeneratedImage}
          />
        </div>
      )}
      {imgCount >= 5 && !readOnly && (
        <p className="text-xs text-muted-foreground text-center">Maximum 5 images per zone reached</p>
      )}
      {imgCount === 0 && !readOnly && (
        <p className="text-xs text-amber-500/80">⚠ No images yet — add reference photos for this zone</p>
      )}
    </div>
  );
}