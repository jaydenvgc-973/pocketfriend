/**
 * SettingsCharacterList
 *
 * Shared character-selection list for ALL Settings subpages.
 * Renders characters grouped by type in the mandatory hierarchy:
 *   1. Active Characters
 *   2. NPC Fictitious
 *   3. NPC Family Members (only where module allows)
 *
 * Usage:
 *   <SettingsCharacterList
 *     sections={sections}          // from resolveSettingsCharacterLists()
 *     onSelect={char => ...}
 *     renderSubtitle={char => ...} // optional: what to show under name
 *     emptyMessage="No characters yet."
 *   />
 */

import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { ChevronRight } from "lucide-react";

export default function SettingsCharacterList({
  sections = [],
  onSelect,
  renderSubtitle,
  emptyMessage = "No characters yet.",
}) {
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  if (totalItems === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">{emptyMessage}</p>
    );
  }

  return (
    <div className="space-y-5">
      {sections.map(({ section, label, items }) => (
        <div key={section} className="space-y-2">
          {/* Section header — always visible so type separation is obvious */}
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
            {label} ({items.length})
          </p>
          <div className="space-y-2">
            {items.map(char => (
              <button
                key={char.id}
                onClick={() => onSelect(char)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left"
              >
                <CharacterAvatar character={char} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{char._displayName || char.name}</p>
                  {renderSubtitle && (
                    <p className="text-xs text-muted-foreground truncate">
                      {renderSubtitle(char)}
                    </p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}