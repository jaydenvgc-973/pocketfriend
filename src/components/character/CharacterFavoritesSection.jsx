import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * CharacterFavoritesSection — this character's own established preferences.
 *
 * They are read from and written to the character record itself, so every surface
 * (chat, World Phone, scenes) sees the same preferences, and they are only created
 * once: a character who already has favorites never has them regenerated.
 * Favorite Restaurant and Favorite Place can only name a place that actually exists
 * in this account's world — the picker is built from the real location records.
 */
const TEXT_FIELDS = [
  ["favorite_food", "Favorite Food", "e.g. lasagna"],
  ["favorite_song", "Favorite Song", "Song title"],
  ["favorite_music_genre", "Favorite Music Genre", "e.g. neo-soul"],
  ["favorite_music_artist", "Favorite Music Artist", "Artist name"],
  ["favorite_color", "Favorite Color", "e.g. deep green"],
  ["favorite_hobby", "Favorite Hobby", "e.g. restoring old furniture"],
  ["favorite_season", "Favorite Season", "e.g. early autumn"],
  ["favorite_animal", "Favorite Animal", "e.g. dogs"],
];

const ALL_KEYS = [
  "favorite_food", "favorite_restaurant", "favorite_song", "favorite_music_genre",
  "favorite_music_artist", "favorite_color", "favorite_hobby", "favorite_season",
  "favorite_animal", "favorite_place",
];

export default function CharacterFavoritesSection({ character }) {
  const queryClient = useQueryClient();
  const favorites = character?.favorites || {};
  const [busy, setBusy] = useState(false);
  const attemptedRef = useRef(false);

  // The real places this character could actually know.
  const { data: locations = [] } = useQuery({
    queryKey: ["favorites-locations", character?.owner_email],
    queryFn: async () => {
      if (character?.owner_email) {
        return base44.entities.LocationReference.filter(
          { owner_email: character.owner_email }, "-created_date", 300
        );
      }
      return base44.entities.LocationReference.list("-created_date", 300);
    },
    enabled: !!character?.id,
    staleTime: 10 * 60 * 1000,
  });

  const placeOptions = (locations || [])
    .filter((l) => l?.id && l?.name)
    .map((l) => ({ id: l.id, name: l.name }));

  const restaurantOptions = (locations || []).flatMap((l) => {
    if (!l?.id) return [];
    const out = [];
    if (l.category === "food_drink") out.push({ id: l.id, name: l.name });
    (l.workplaces || []).forEach((w) => {
      if (w?.business_category === "food_drink" && w?.name) out.push({ id: l.id, name: w.name });
    });
    return out;
  });

  const hasAny = ALL_KEYS.some((k) => (favorites[k] || "").trim());

  const save = async (patch) => {
    const next = { ...favorites, ...patch };
    if (!favorites.established_at) next.established_at = new Date().toISOString();
    await base44.entities.Character.update(character.id, { favorites: next });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  // Established once, from who this character already is. A character who has favorites
  // is never regenerated here — their own experiences change them, not this section.
  useEffect(() => {
    if (!character?.id || hasAny || attemptedRef.current || !locations) return;
    attemptedRef.current = true;
    const run = async () => {
      setBusy(true);
      try {
        const result = await base44.integrations.Core.InvokeLLM({
          prompt: `You are establishing the personal preferences of one character in a story world. Use ONLY what this character's own profile and life establish — never stereotypes about age, gender, race, ethnicity or religion.

CHARACTER: ${character.name}
AGE: ${character.age || "unknown"}
OCCUPATION: ${character.occupation || "unknown"}
PERSONALITY: ${character.personality_summary || ""}
BACKGROUND: ${character.background_story || character.backstory || ""}
CURRENT LIFE: ${character.current_situation || ""}
TRAITS: ${(character.personality_traits || []).join(", ")}
QUIRKS: ${(character.quirks || []).map((q) => q?.quirk || q?.name || q?.title || "").filter(Boolean).join(", ")}
MUSIC THEY'VE BEEN AROUND: ${(character.songs_heard || []).slice(0, 8).map((s) => `${s.title} by ${s.artist}`).join("; ")}

REAL RESTAURANTS THAT EXIST IN THEIR WORLD: ${restaurantOptions.map((r) => r.name).join(", ") || "none"}
REAL PLACES THAT EXIST IN THEIR WORLD: ${placeOptions.map((p) => p.name).join(", ") || "none"}

Return their favorites. For favorite_restaurant use EXACTLY one name from the restaurant list, or an empty string if none fits them. For favorite_place use EXACTLY one name from the places list, or an empty string. Never invent a restaurant or place. Keep every other answer short (a few words).`,
          response_json_schema: {
            type: "object",
            properties: {
              favorite_food: { type: "string" },
              favorite_restaurant: { type: "string" },
              favorite_song: { type: "string" },
              favorite_music_genre: { type: "string" },
              favorite_music_artist: { type: "string" },
              favorite_color: { type: "string" },
              favorite_hobby: { type: "string" },
              favorite_season: { type: "string" },
              favorite_animal: { type: "string" },
              favorite_place: { type: "string" },
            },
          },
        });

        const pick = (list, name) => {
          const match = list.find((o) => o.name.toLowerCase() === String(name || "").trim().toLowerCase());
          return match || null;
        };
        const restaurant = pick(restaurantOptions, result?.favorite_restaurant);
        const place = pick(placeOptions, result?.favorite_place);

        await save({
          favorite_food: result?.favorite_food || "",
          favorite_song: result?.favorite_song || "",
          favorite_music_genre: result?.favorite_music_genre || "",
          favorite_music_artist: result?.favorite_music_artist || "",
          favorite_color: result?.favorite_color || "",
          favorite_hobby: result?.favorite_hobby || "",
          favorite_season: result?.favorite_season || "",
          favorite_animal: result?.favorite_animal || "",
          favorite_restaurant: restaurant?.name || "",
          favorite_restaurant_location_id: restaurant?.id || "",
          favorite_place: place?.name || "",
          favorite_place_location_id: place?.id || "",
        });
      } catch {
        // Nothing is written when it cannot be established — the fields simply stay open.
      } finally {
        setBusy(false);
      }
    };
    run();
  }, [character?.id, hasAny, locations]);

  const selectValue = (name) => {
    const match = (name === "restaurant" ? restaurantOptions : placeOptions)
      .find((o) => o.name === (name === "restaurant" ? favorites.favorite_restaurant : favorites.favorite_place));
    return match ? match.name : "";
  };

  const handleSelect = (kind, value) => {
    const list = kind === "restaurant" ? restaurantOptions : placeOptions;
    const match = list.find((o) => o.name === value);
    save(
      kind === "restaurant"
        ? { favorite_restaurant: match?.name || "", favorite_restaurant_location_id: match?.id || "" }
        : { favorite_place: match?.name || "", favorite_place_location_id: match?.id || "" }
    );
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        What they love — their own preferences, reflected in how they talk and choose.
      </p>
      {busy && <p className="text-xs text-primary">Learning what {character.name?.split(" ")[0] || "they"} loves…</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TEXT_FIELDS.map(([key, label, placeholder]) => (
          <FavoriteText key={key} label={label} placeholder={placeholder} value={favorites[key] || ""} onSave={(v) => save({ [key]: v })} />
        ))}

        <FavoriteSelect
          label="Favorite Restaurant"
          value={selectValue("restaurant")}
          options={restaurantOptions}
          onChange={(v) => handleSelect("restaurant", v)}
        />
        <FavoriteSelect
          label="Favorite Place"
          value={selectValue("place")}
          options={placeOptions}
          onChange={(v) => handleSelect("place", v)}
        />
      </div>
    </div>
  );
}

function FavoriteText({ label, value, placeholder, onSave }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onSave(draft.trim()); }}
        placeholder={placeholder}
        className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground"
      />
    </div>
  );
}

function FavoriteSelect({ label, value, options, onChange }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50"
      >
        <option value="">Not established</option>
        {options.map((o) => (
          <option key={`${o.id}:${o.name}`} value={o.name}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}