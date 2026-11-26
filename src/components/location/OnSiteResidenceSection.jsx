import React, { useState } from "react";
import { Home, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import OnSiteResidenceModal from "@/components/location/OnSiteResidenceModal";

/**
 * OnSiteResidenceSection — the residential spaces inside the Places location form.
 *
 * A property is not limited to one living space. Exactly as the Workspaces section lets one
 * property hold several independently configured businesses, this lets it hold several
 * independently configured residences: each with its own name, its own spaces, its own
 * people, its own Physical Setting and its own reference images.
 *
 * Everything is written to what Places already stores: each residence is one residential
 * entry in the property's `environments[]`, its spaces are the property's existing zones,
 * its pictures are that residence's own `zone_images`, and its people are its own
 * `occupant_character_ids`. The parent keeps its category, hours, staff and other spaces,
 * and existing residences — including those saved before a property could hold several —
 * keep their spaces, people and pictures.
 */
export default function OnSiteResidenceSection({
  form,
  setForm,
  locationName,
  editingLocationId,
  characters = [],
  residentNames = {},
  lockedZoneNames = [],
  suggestedZones = [],
  onPersist,
  // What the parent property is called in this section's copy. A business property is a
  // business; a Generic location that contains living spaces is a property.
  contextLabel = "business",
}) {
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);

  const environments = form.environments || [];
  const residences = environments.filter((e) => e?.type === "residential" && e?.id);
  const locationResidentIds = form.resident_character_ids || [];

  // A residence saved before a property could hold several keeps the property's resident
  // list as its own — its people are never shown as missing.
  const occupantsOf = (env) => {
    if (!env) return [];
    if ((env.occupant_character_ids || []).length > 0) return env.occupant_character_ids;
    return residences.length === 1 ? locationResidentIds : [];
  };

  const assignedToAnyResidence = new Set(residences.flatMap((r) => occupantsOf(r)));
  const unassignedResidents = locationResidentIds.filter((id) => !assignedToAnyResidence.has(id));

  const persist = (updates) => {
    setForm((p) => ({ ...p, ...updates }));
    if (editingLocationId) onPersist?.(updates);
  };

  const handleSave = ({ environment, residentIds }) => {
    const others = residences.filter((r) => r.id !== environment.id);
    const nextEnvironments = residences.some((r) => r.id === environment.id)
      ? environments.map((e) => (e.id === environment.id ? environment : e))
      : [...environments, environment];
    // The property's resident list holds every resident of every residence, plus anyone
    // not yet placed in one. Nobody is removed by editing another residence.
    const nextResidentIds = Array.from(new Set([
      ...unassignedResidents,
      ...others.flatMap((r) => occupantsOf(r)),
      ...(residentIds || []),
    ]));
    setEditingId(null);
    setAdding(false);
    persist({ environments: nextEnvironments, resident_character_ids: nextResidentIds, zones: form.zones });
  };

  const handleRemove = (id) => {
    const removed = residences.find((r) => r.id === id);
    const nextEnvironments = environments.filter((e) => e.id !== id);
    const others = residences.filter((r) => r.id !== id);
    const stillAssigned = new Set(others.flatMap((r) => occupantsOf(r)));
    // Removing a residence never deletes anyone: its people return to the property's
    // unassigned residents.
    const nextResidentIds = Array.from(new Set([
      ...unassignedResidents,
      ...(removed ? occupantsOf(removed) : []),
      ...locationResidentIds.filter((cid) => stillAssigned.has(cid)),
    ]));
    persist({ environments: nextEnvironments, resident_character_ids: nextResidentIds });
  };

  // Spaces and their pictures live on the property's own zone list — the same record the
  // Rooms / Zones section and Scenes already read.
  const addPropertyZone = (zoneName) => {
    const name = String(zoneName || "").trim();
    if (!name) return;
    setForm((p) => {
      const zones = p.zones || [];
      if (zones.some((z) => String(z.zone_name).toLowerCase() === name.toLowerCase())) return p;
      return { ...p, zones: [...zones, { zone_name: name, image_urls: [] }] };
    });
  };

  const addPropertyZoneImage = (zoneName, url) => {
    if (!zoneName || !url) return;
    setForm((p) => ({
      ...p,
      zones: (p.zones || []).map((z) => z.zone_name === zoneName && !(z.image_urls || []).includes(url)
        ? { ...z, image_urls: [...(z.image_urls || []), url] }
        : z),
    }));
  };

  const removePropertyZoneImage = (zoneName, url) => {
    setForm((p) => ({
      ...p,
      zones: (p.zones || []).map((z) => z.zone_name === zoneName
        ? { ...z, image_urls: (z.image_urls || []).filter((u) => u !== url) }
        : z),
    }));
  };

  const editing = residences.find((r) => r.id === editingId) || null;
  const modalOpen = adding || !!editing;
  const modalResidence = editing;
  const otherResidences = residences.filter((r) => r.id !== modalResidence?.id);

  return (
    <>
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider">On-Site Residence</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {residences.length === 0
                ? `Living spaces inside this ${contextLabel}. The ${contextLabel} keeps its category, hours and staff.`
                : `${residences.length} residence${residences.length === 1 ? "" : "s"} — each with its own spaces, people and images.`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setAdding(true); }} className="rounded-xl flex-shrink-0">
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add residence
          </Button>
        </div>

        {residences.length > 0 && (
          <div className="space-y-1.5">
            {residences.map((residence) => {
              const rooms = (residence.zone_names || []).length;
              const people = occupantsOf(residence).length;
              return (
                <div key={residence.id} className="flex items-start gap-2 rounded-lg bg-card/60 border border-border px-2.5 py-2">
                  <Home className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">
                      {residence.name}
                      {residence.residence_type ? <span className="text-muted-foreground/70"> · {residence.residence_type}</span> : null}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {rooms} space{rooms === 1 ? "" : "s"} · {people} resident{people === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    onClick={() => { setAdding(false); setEditingId(residence.id); }}
                    title="Edit this residence"
                    className="p-1 text-muted-foreground hover:text-primary transition-colors rounded-lg"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleRemove(residence.id)}
                    title="Remove this residence (its residents stay on the property)"
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen && (
        <OnSiteResidenceModal
          residence={modalResidence}
          locationName={locationName}
          existingLocation={!!editingLocationId}
          zones={form.zones}
          suggestedZones={suggestedZones}
          lockedZoneNames={lockedZoneNames}
          residentIds={locationResidentIds}
          residentNames={residentNames}
          residenceResidents={
            modalResidence
              ? occupantsOf(modalResidence)
              : residences.length === 0
                ? locationResidentIds
                : []
          }
          otherResidences={otherResidences}
          characters={characters}
          category={form.category}
          subtype={form.subtype}
          locationDescription={form.description}
          onAddPropertyZone={addPropertyZone}
          onAddPropertyZoneImage={addPropertyZoneImage}
          onRemovePropertyZoneImage={removePropertyZoneImage}
          onSave={handleSave}
          onClose={() => { setAdding(false); setEditingId(null); }}
          contextLabel={contextLabel}
        />
      )}
    </>
  );
}