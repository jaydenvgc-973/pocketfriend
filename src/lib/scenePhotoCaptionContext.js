import { getDaypart } from "@/lib/temporalStateEngine";
import { resolveSceneZone } from "@/lib/sceneSpaceZone";

/**
 * THE MOMENT A SCENE PHOTO IS ACTUALLY TAKEN IN.
 *
 * The photo caption is written from the same authorities the scene itself uses, and from
 * nothing else:
 *   - the space: the location's own zone, resolved by resolveSceneZone — the exact same
 *     resolver every Scenes picture uses. A residence with no lobby has no lobby here either.
 *   - the hour: Pocketfriend's authoritative time (America/New_York) through getDaypart,
 *     the same daypart buckets every narrative and image uses.
 *   - what happened: the scene's own transcript, verbatim.
 *
 * A caption is never allowed to invent a room, a setting or a time of day that is not in
 * this block.
 */
export function buildPhotoMomentContext({ location, activeZone, transcript, peopleNames }) {
  if (!location) return "";

  const zoneName = resolveSceneZone(location, activeZone);
  const category = String(location.category || "place").replace(/_/g, " ");

  // The hour the whole app runs on: Eastern.
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const daypart = getDaypart(nowET.getHours());
  const clock = nowET.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const lines = (transcript || [])
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .filter((m) => ["character", "user", "narrative", "activity"].includes(m.sender))
    .filter((m) => !String(m.id || "").startsWith("obs_hint_"))
    .slice(-10)
    .map((m) => {
      const who = m.sender === "user"
        ? "You"
        : m.sender === "narrative"
          ? "Narration"
          : m.sender === "activity"
            ? "Activity"
            : (m.senderName || "Character");
      return `- ${who}: ${String(m.content).replace(/\s+/g, " ").trim().slice(0, 220)}`;
    });

  return `WHERE THIS PHOTO IS TAKEN — authoritative, the only place it was taken:
- Venue: ${location.name}${location.venue_identity ? ` (${location.venue_identity})` : ""} — a ${category}
- Space inside it: ${zoneName ? zoneName : `no separate room is established; the venue itself (${location.name}) is the whole setting`}

WHEN IT IS — authoritative:
- ${clock} Eastern, which is ${daypart.label}

WHAT HAS ACTUALLY HAPPENED IN THIS SCENE — the only events that exist:
${lines.length > 0 ? lines.join("\n") : "- Nothing has happened yet; the scene has only just begun."}

People in this photo: ${peopleNames || "no one"}.`;
}

/**
 * The rules a caption may never break. Stated once, used by the caption request.
 */
export const PHOTO_CAPTION_RULES = `Write ONE sentence, at most 25 words, present tense, describing the moment as a photo prompt.

RULES — these are absolute:
- Describe ONLY the venue and the space named above. ⛔ Never invent, assume or add a room, area or feature the block does not name: no lobby, no hallway, no bar, no street, no garden, no counter, no office, no outdoor setting. If no separate room is named, the venue itself is the whole setting and you name nothing smaller.
- The time of day above is the only time of day. ⛔ Never say morning, midday, afternoon, evening or night unless it matches the stated hour. Never describe daylight at night or night at midday.
- Ground the sentence in the events listed above when there are any. When there are none, describe something these specific people would plausibly be doing in exactly this space at exactly this hour.
- Keep them in this space: if they are inside, they stay inside; if they are seated, they stay seated. ⛔ Never move them outside, into the street, or into any other place.
- Never invent props, objects, weather or events that are not established above.
- No hashtags, no quotation marks, no emoji, no camera or technical language.`;

/**
 * A caption must never state a daypart the hour contradicts, and never a room the venue does
 * not have. This is the last check before a generated caption reaches the input.
 */
export function violatesPhotoMoment(caption, { location, activeZone }) {
  if (!caption) return false;
  const text = String(caption).toLowerCase();
  const zoneName = resolveSceneZone(location, activeZone);
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = nowET.getHours();
  const daypart = getDaypart(hour);

  // Words that contradict the hour it actually is, per established daypart bucket.
  const CONTRADICTING = {
    deep_night: ["midday", "morning", "afternoon", "evening", "noon", "sunlight"],
    pre_dawn: ["midday", "afternoon", "evening", "noon", "sunlight"],
    early_morning: ["midday", "afternoon", "evening", "midnight"],
    morning: ["midday", "afternoon", "evening", "midnight"],
    midday: ["midnight", "late night"],
    afternoon: ["midday", "midnight", "late night"],
    evening: ["midday", "morning", "midnight"],
    night: ["midday", "morning", "afternoon"],
    late_night: ["midday", "morning", "afternoon"],
  };
  if ((CONTRADICTING[daypart.id] || []).some((w) => text.includes(w))) return true;

  // A room word the property does not have. Only checked when the venue itself has no such
  // zone — a venue that really has a lobby is free to say lobby.
  const ROOM_WORDS = ["lobby", "hallway", "corridor", "bar", "counter", "balcony", "patio", "rooftop", "courtyard", "street", "sidewalk"];
  const venueZones = (location?.zones || []).map((z) => String(z.zone_name || "").toLowerCase());
  const space = String(zoneName || "").toLowerCase();
  for (const word of ROOM_WORDS) {
    if (!text.includes(word)) continue;
    const venueHasIt = venueZones.some((z) => z.includes(word)) || space.includes(word)
      || String(location?.name || "").toLowerCase().includes(word)
      || String(location?.description || "").toLowerCase().includes(word);
    if (!venueHasIt) return true;
  }
  return false;
}