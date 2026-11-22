import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import OnSiteResidenceModal from "@/components/location/OnSiteResidenceModal";
import { getOnSiteResidence } from "@/lib/onsiteResidence";

/**
 * OnSiteResidenceSection — the On-Site Residence surface inside the Places location form.
 *
 * The residence lives on the property itself: a residential entry in `environments[]`,
 * its rooms are the property's existing zones, and its people are the property's existing
 * resident list. The business keeps its category, hours, staff and operational zones.
 *
 * Saving goes through the location form's own save (`onPersist`), so an existing property
 * is persisted immediately and reopens exactly as configured. No separate save system.
 */
export default function OnSiteResidenceSection({
  form,
  setForm,
  locationName,
  editingLocationId,
  characters = [],
  residentNames = {},
  lockedZoneNames = [],
  onPersist,
}) {
  const [open, setOpen] = useState(false);
  const residence = getOnSiteResidence(form);
  const residentCount = (form.resident_character_ids || []).length;

  const handleSave = ({ environment, residentIds }) => {
    const rest = (form.environments || []).filter((e) => e.type !== "residential");
    const environments = environment ? [...rest, environment] : rest;
    const updates = { environments, resident_character_ids: residentIds };
    setForm((p) => ({ ...p, ...updates }));
    setOpen(false);
    if (editingLocationId) onPersist?.(updates);
  };

  return (
    <>
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider">On-Site Residence</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {residence
                ? `${residence.name} · ${(residence.zone_names || []).length} room${(residence.zone_names || []).length === 1 ? "" : "s"} · ${residentCount} resident${residentCount === 1 ? "" : "s"}`
                : "A living space inside this business. The business keeps its category, hours and staff."}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="rounded-xl flex-shrink-0">
            {residence ? "Configure" : "Add residence"}
          </Button>
        </div>
      </div>

      {open && (
        <OnSiteResidenceModal
          locationName={locationName}
          existingLocation={!!editingLocationId}
          zones={form.zones}
          environments={form.environments}
          residentIds={form.resident_character_ids || []}
          residentNames={residentNames}
          lockedZoneNames={lockedZoneNames}
          characters={characters}
          onAddZone={(zoneName) => setForm((p) => ({
            ...p,
            zones: [...(p.zones || []), { zone_name: zoneName, image_urls: [] }],
          }))}
          onUpdateZoneImages={(zoneName, urls) => setForm((p) => ({
            ...p,
            zones: (p.zones || []).map((z) =>
              String(z.zone_name).toLowerCase() === String(zoneName).toLowerCase()
                ? { ...z, image_urls: urls }
                : z
            ),
          }))}
          onSave={handleSave}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}