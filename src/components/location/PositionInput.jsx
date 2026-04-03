import { useState } from "react";
import { getVenuePositions } from "@/lib/venuePositions";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";

/**
 * Hybrid Position Input
 * Allows both dropdown selection and manual typing
 * Dropdown populated based on venue type
 */
export default function PositionInput({ category, value, onChange }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const positions = getVenuePositions(category);
  const hasPositions = positions.length > 0;

  const handleSelect = (pos) => {
    onChange(pos);
    setShowDropdown(false);
  };

  const filteredPositions = hasPositions && value
    ? positions.filter(p => p.toLowerCase().includes(value.toLowerCase()))
    : positions;

  return (
    <div className="relative">
      <div className="relative">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setShowDropdown(true)}
          placeholder={hasPositions ? "Select or type..." : "Enter position..."}
          className="h-8 text-xs pr-6"
        />
        {hasPositions && (
          <button
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>

      {showDropdown && hasPositions && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto">
          {filteredPositions.length > 0 ? (
            filteredPositions.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => handleSelect(pos)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-secondary ${
                  value.toLowerCase() === pos.toLowerCase() ? "bg-primary/10 text-primary" : "text-foreground"
                }`}
              >
                {pos}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              No matching positions
            </div>
          )}
        </div>
      )}
    </div>
  );
}