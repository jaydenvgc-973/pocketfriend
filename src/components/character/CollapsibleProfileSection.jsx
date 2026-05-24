import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Wrapper for collapsible profile sections.
 * Preserves existing section UI when expanded.
 */
export default function CollapsibleProfileSection({ icon: Icon, title, children }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 py-3 px-4 hover:bg-secondary/30 transition-colors text-left"
      >
        {Icon && <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        <span className="text-sm font-medium text-foreground flex-1">{title}</span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {isExpanded && <div className="px-4 py-3 border-t border-border/50">{children}</div>}
    </div>
  );
}