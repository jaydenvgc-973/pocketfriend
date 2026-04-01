import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X, MapPin, Check, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

/**
 * LocationMatchSuggestion
 * 
 * After a new location is created, check if any characters match.
 * Shows a dismissable suggestion to link characters to the location.
 * 
 * Props:
 *   locationId: string
 *   locationName: string
 *   locationCategory: string
 *   characters: Character[] (for avatar display)
 *   onClose: () => void
 *   onLinked: () => void (to refresh location data)
 */
export default function LocationMatchSuggestion({ locationId, locationName, locationCategory, characters, onClose, onLinked }) {
  const [matches, setMatches] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const [linking, setLinking] = useState(new Set());

  useEffect(() => {
    if (!locationId) return;
    base44.functions.invoke('checkLocationMatches', {
      locationId,
      locationName,
      locationCategory,
    }).then(res => {
      setMatches(res?.data?.matches || []);
    }).catch(() => {});
  }, [locationId]);

  const visibleMatches = matches.filter(m => !dismissed.has(m.characterId));

  if (visibleMatches.length === 0) return null;

  const handleLink = async (match) => {
    setLinking(prev => new Set([...prev, match.characterId]));
    await base44.functions.invoke('linkOccupationToLocation', {
      characterId: match.characterId,
      locationId,
      linkType: match.matchType,
      title: match.currentText,
    });
    setLinking(prev => { const n = new Set(prev); n.delete(match.characterId); return n; });
    setDismissed(prev => new Set([...prev, match.characterId]));
    onLinked?.();
  };

  const handleDismiss = (charId) => {
    setDismissed(prev => new Set([...prev, charId]));
  };

  return createPortal(
    <div className="fixed bottom-24 right-4 z-40 w-80 space-y-2">
      <AnimatePresence>
        {visibleMatches.map(match => {
          const char = characters.find(c => c.id === match.characterId);
          return (
            <motion.div
              key={match.characterId}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-3 shadow-lg"
            >
              <div className="flex items-start gap-2 mb-2">
                <MapPin className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-foreground font-medium flex-1">Possible location match</p>
                <button onClick={() => handleDismiss(match.characterId)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>

              <div className="flex items-center gap-2 mb-2">
                {char && <CharacterAvatar character={char} size="sm" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{match.characterName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{match.currentText}</p>
                </div>
                <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  {match.confidence}% match
                </span>
              </div>

              <p className="text-[10px] text-muted-foreground mb-2">
                Add {match.characterName} as a {match.matchType === 'occupation' ? 'worker' : 'student'} at "{locationName}"?
              </p>

              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDismiss(match.characterId)}
                  className="flex-1 h-7 text-[10px] rounded-lg"
                >
                  No
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleLink(match)}
                  disabled={linking.has(match.characterId)}
                  className="flex-1 h-7 text-[10px] rounded-lg gap-1"
                >
                  <LinkIcon className="w-3 h-3" />
                  {linking.has(match.characterId) ? "Linking..." : "Yes, link"}
                </Button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}