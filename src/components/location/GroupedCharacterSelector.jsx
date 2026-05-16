import React, { useState, useMemo } from "react";
import { Search, ChevronDown } from "lucide-react";

/**
 * Grouped character selector showing active_created, npc_fictitious, npc_family_member
 * Sorted alphabetically within each group.
 */
export default function GroupedCharacterSelector({
  allCharacters = [],
  selectedIds = [],
  onSelect,
  placeholder = "Search characters...",
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState({
    active_created: true,
    npc_fictitious: true,
    npc_family_member: true,
  });

  // Group and sort characters
  const grouped = useMemo(() => {
    const groups = {
      active_created: [],
      npc_fictitious: [],
      npc_family_member: [],
    };

    allCharacters.forEach((char) => {
      const type = char.character_type || "active_created_character";
      if (type === "active_created_character") {
        groups.active_created.push(char);
      } else if (type === "npc_fictitious") {
        groups.npc_fictitious.push(char);
      } else if (type === "npc_family_member") {
        groups.npc_family_member.push(char);
      }
    });

    // Sort each group alphabetically
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    });

    return groups;
  }, [allCharacters]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return grouped;

    const q = searchQuery.toLowerCase();
    const filtered = {};
    Object.keys(grouped).forEach((groupKey) => {
      filtered[groupKey] = grouped[groupKey].filter((char) =>
        (char.name || "").toLowerCase().includes(q)
      );
    });
    return filtered;
  }, [grouped, searchQuery]);

  const toggleGroup = (groupKey) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const groupLabels = {
    active_created: "Active Created Characters",
    npc_fictitious: "NPC Fictitious",
    npc_family_member: "NPC Family Members",
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {Object.keys(filtered).map((groupKey) => {
          const chars = filtered[groupKey];
          if (chars.length === 0) return null;

          const isExpanded = expandedGroups[groupKey];

          return (
            <div key={groupKey} className="border border-border/50 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleGroup(groupKey)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/40 hover:bg-secondary/60 transition-colors text-xs font-medium text-foreground"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    isExpanded ? "rotate-0" : "-rotate-90"
                  }`}
                />
                {groupLabels[groupKey]} ({chars.length})
              </button>

              {isExpanded && (
                <div className="bg-card/40 space-y-0 border-t border-border/20">
                  {chars.map((char) => {
                    const isSelected = selectedIds.includes(char.id);
                    return (
                      <button
                        key={char.id}
                        onClick={() => onSelect(char.id, !isSelected)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors border-b border-border/10 last:border-b-0 ${
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-secondary/30 text-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 rounded accent-primary cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{char.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {char.character_type === "active_created_character"
                              ? "Active Created"
                              : char.character_type === "npc_fictitious"
                              ? "NPC Fictitious"
                              : "NPC Family Member"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {Object.values(filtered).every((group) => group.length === 0) && (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground">No characters found</p>
          </div>
        )}
      </div>
    </div>
  );
}