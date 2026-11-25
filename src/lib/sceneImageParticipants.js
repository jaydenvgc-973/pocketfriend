/**
 * sceneImageParticipants.js — WHO IS IN A SCENE'S PICTURE
 *
 * Extracted unchanged from Scene.jsx. Selects a subset of the scene participants by stable
 * ID: a directed moment's own people, the watched cast, or the people the user actually
 * chose from Who's Here. The user is already a participant. Background people of a venue
 * only ever fill a remaining slot, never a real character's.
 */
export function createImageParticipantSelector({
  sceneParticipants = [],
  characters = [],
  observeMode = false,
  observeCast = [],
  isHomeLocation = false,
  broughtCharacters = [],
  selectedNpcIdList = [],
  supervisedChildIds = [],
  userParticipant = null,
  selectedNpcIds = null,
  presentHereIds = [],
}) {
  return (focusIds = null) => {
    const userId = userParticipant?.id;
    // A directed action names exactly who it involves — those two people are the image,
    // whichever of them is playing the scene.
    if (Array.isArray(focusIds) && focusIds.length > 0) {
      // The focused people are exactly the ones the user chose for this moment — a
      // directed pair, or everyone taking part in a shared activity. None of them is
      // dropped from the picture because a fifth person joined in.
      const focused = sceneParticipants.filter((p) => focusIds.includes(p.id));
      // Someone who has only just joined from the directory is resolved from their own
      // record until the participant collection catches up, so a chosen person is never
      // missing from the picture of the moment they are in.
      const focusedSeen = new Set(focused.map((p) => p.id));
      focusIds.forEach((id) => {
        if (focusedSeen.has(id)) return;
        const record = characters.find((c) => c.id === id);
        if (!record) return;
        focusedSeen.add(id);
        focused.push({ ...record, isNpc: false });
      });
      if (focused.length > 0) return focused;
    }
    // Observed scene: the people actually in the moment are the ones in the image.
    // An chosen character is resolved from the completed participant collection when it
    // is there, and otherwise from their own character record — a character is never
    // dropped out of the picture (and so out of the frame entirely) just because the
    // participant collection lags behind the arrival. Background people of the venue are
    // never part of this cast.
    if (observeMode) {
      const byId = new Map(sceneParticipants.map((p) => [p.id, p]));
      return observeCast
        .filter((c) => c?.id && c.isNpc !== true && c.isRemoteParticipant !== true && !String(c.id).startsWith("npc_"))
        .map((c) => {
          const resolved = byId.get(c.id);
          if (resolved) return resolved;
          const rec = characters.find((x) => x.id === c.id) || {};
          return {
            ...rec,
            ...c,
            name: c.name || rec.name,
            avatar_url: c.avatar_url || rec.avatar_url,
            image_avatar_url: rec.image_avatar_url || c.avatar_url,
            reference_image_urls: rec.reference_image_urls || [],
          };
        })
        .slice(0, 4);
    }
    if (isHomeLocation) {
      // A supervised household is pictured as it is: the caregiver on duty AND the
      // children they are looking after. The image never shows the child alone, and never
      // pulls in a neighbour's child from another unit of the same building.
      // The Who's Here selection is the authority for who is in the picture. A character
      // the user deselected is not rendered, even inside their own home — including
      // someone who traveled here with the user. Only the supervision rule adds anyone:
      // a child on duty care is never pictured alone.
      // Only the selection decides the picture. A coworker on shift in this workplace is
      // physically here, not selected — so they are not in the frame. The same applies to
      // the property's residents, staff and visitors.
      const selectedIds = new Set([
        ...broughtCharacters.filter((c) => selectedNpcIdList.includes(c.id)).map((c) => c.id),
        ...selectedNpcIdList, ...supervisedChildIds, ...(userId ? [userId] : []),
      ]);
      return sceneParticipants.filter((p) => selectedIds.has(p.id));
    }
    // At a public venue the chosen cast still decides the picture: whoever the user
    // brought or picked is who appears. Other people present only fill in when the
    // user has chosen nobody.
    const chosenIds = new Set([
      ...broughtCharacters.filter((c) => selectedNpcIdList.includes(c.id)).map((c) => c.id),
      ...selectedNpcIdList, ...(userId ? [userId] : []),
    ]);
    const chosen = sceneParticipants.filter((p) => chosenIds.has(p.id));
    // An established character always keeps a place in the frame. A background person of
    // the venue only ever fills a remaining slot — never a slot ahead of a real character.
    const isBackgroundPerson = (p) => p.isNpc === true || String(p.id).startsWith("npc_");
    if (chosen.length > 0) return [...chosen.filter((p) => !isBackgroundPerson(p)), ...chosen.filter(isBackgroundPerson)].slice(0, 4);
    // Nobody has been chosen yet: the place's own people fill the frame. Once the user has
    // made a selection — even an empty one — the picture follows that selection and never
    // re-injects people they removed.
    if (selectedNpcIds === null) {
      // Nobody has been chosen yet, so the people actually in this space fill the frame —
      // the unit's occupants, or the business's people on shift. Never everyone else in
      // the building. Once the user picks or un-picks anyone, only that selection is
      // pictured, so the frame always matches the checkmarks in Who's Here.
      const selectedIds = new Set([...broughtCharacters.map((c) => c.id), ...presentHereIds, ...(userId ? [userId] : [])]);
      const fallbackCast = sceneParticipants.filter((p) => selectedIds.has(p.id));
      return [...fallbackCast.filter((p) => !isBackgroundPerson(p)), ...fallbackCast.filter(isBackgroundPerson)].slice(0, 4);
    }
    return [];
  };
}