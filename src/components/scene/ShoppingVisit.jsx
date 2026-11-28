import { useEffect, useRef, useState } from "react";
import ShoppingPreferencesModal from "@/components/scene/ShoppingPreferencesModal";
import { resolveShoppingDestination, readShoppingPreferences, saveShoppingPreferences } from "@/lib/shoppingPreferences";

/**
 * useShoppingVisit — this store visit's stated purpose.
 *
 * It resolves the store the scene is actually inside (a workplace selected within a property,
 * or a standalone retail location), asks once per destination what the visit is for, and
 * keeps the answer with that destination for the visit. Moving between zones of the same
 * store is the same destination, so it never asks again.
 *
 * It owns no records and transacts nothing: preferences only tell the existing shopping
 * activities what the shopper is looking for.
 */
export function useShoppingVisit({ location, spaceId = null }) {
  const [preferences, setPreferences] = useState(null);
  const [open, setOpen] = useState(false);
  const promptedRef = useRef(null);
  const destination = resolveShoppingDestination(location, spaceId);

  useEffect(() => {
    if (!destination) { promptedRef.current = null; setPreferences(null); return; }
    setPreferences(readShoppingPreferences(destination.key));
    if (promptedRef.current === destination.key) return;
    promptedRef.current = destination.key;
    setOpen(true);
  }, [destination?.key]);

  const confirm = (prefs) => {
    if (!destination) return;
    saveShoppingPreferences(destination.key, prefs);
    setPreferences(prefs);
    setOpen(false);
  };

  return { destination, preferences, open, setOpen, confirm };
}

/** The modal itself, mounted from the page without adding any state there. */
export function ShoppingPreferencesGate({ visit }) {
  if (!visit) return null;
  return (
    <ShoppingPreferencesModal
      open={!!visit.open && !!visit.destination}
      destination={visit.destination}
      preferences={visit.preferences}
      onConfirm={visit.confirm}
      onClose={() => visit.setOpen(false)}
    />
  );
}