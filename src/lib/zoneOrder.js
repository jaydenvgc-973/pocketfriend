/**
 * ZONE IDENTITY — renaming and reordering the zones a location already has.
 *
 * A zone is identified by its position in the location's `zones` array. Renaming changes
 * the name only: the zone keeps its place, its images and description, and everything the
 * location records against that name is renamed with it, so no business, residence or
 * environment is disconnected and no replacement zone is created.
 *
 * Reordering changes the list order only. It never moves a character, changes an
 * assignment, or alters a zone's identity.
 */

const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * The form with zone `index` renamed. Returns the same form unchanged when the name is
 * empty or identical. Every reference to the old name inside this location moves with it.
 */
export function renameZoneInForm(form, index, rawName) {
  const trimmed = String(rawName || "").trim();
  const oldName = form?.zones?.[index]?.zone_name;
  if (!trimmed || !oldName || oldName === trimmed) return form;

  return {
    ...form,
    zones: form.zones.map((z, i) => (i === index ? { ...z, zone_name: trimmed } : z)),
    workplaces: (form.workplaces || []).map((w) => ({
      ...w,
      zone_names: (w.zone_names || []).map((n) => (sameName(n, oldName) ? trimmed : n)),
      zone_images: (w.zone_images || []).map((zi) =>
        sameName(zi.zone_name, oldName) ? { ...zi, zone_name: trimmed } : zi
      ),
    })),
    residential_units: (form.residential_units || []).map((u) => ({
      ...u,
      zone_name: sameName(u.zone_name, oldName) ? trimmed : u.zone_name,
      zone_names: (u.zone_names || []).map((n) => (sameName(n, oldName) ? trimmed : n)),
      zone_images: (u.zone_images || []).map((zi) =>
        sameName(zi.zone_name, oldName) ? { ...zi, zone_name: trimmed } : zi
      ),
    })),
    environments: (form.environments || []).map((e) => ({
      ...e,
      zone_names: (e.zone_names || []).map((n) => (sameName(n, oldName) ? trimmed : n)),
      zone_images: (e.zone_images || []).map((zi) =>
        sameName(zi.zone_name, oldName) ? { ...zi, zone_name: trimmed } : zi
      ),
    })),
  };
}

/** The form with zone `index` moved one place up (-1) or down (1). */
export function moveZoneInForm(form, index, direction) {
  const zones = form?.zones || [];
  const target = index + direction;
  if (target < 0 || target >= zones.length) return form;
  const next = [...zones];
  [next[index], next[target]] = [next[target], next[index]];
  return { ...form, zones: next };
}