import { Check, Globe2 } from "lucide-react";

/**
 * CrossAccountCharacterList
 *
 * Renders characters from other user accounts at the bottom of a character
 * selection list. Grouped by owning account (alphabetically), with characters
 * alphabetized inside each account group, and visually separated from the
 * current account's own roster.
 */
export default function CrossAccountCharacterList({ characters = [], selectedIds = [], onToggle }) {
  if (!characters.length) return null;

  const byAccount = {};
  for (const c of characters) {
    const key = c.account_email || "other";
    if (!byAccount[key]) byAccount[key] = [];
    byAccount[key].push(c);
  }
  const accounts = Object.keys(byAccount).sort((a, b) => a.localeCompare(b));

  return (
    <div className="pt-2">
      <p className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Globe2 className="w-3 h-3" /> From other accounts
      </p>
      {accounts.map(account => (
        <div key={account}>
          <p className="px-3 py-1 text-[9px] text-muted-foreground/80 uppercase tracking-wider border-t border-dashed border-border">
            {account}
          </p>
          {byAccount[account]
            .slice()
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
            .map(char => {
              const selected = selectedIds.includes(char.id);
              return (
                <button
                  key={char.id}
                  onClick={() => onToggle(char.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-b border-dashed border-border last:border-b-0 transition-colors ${
                    selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary/60"
                  }`}
                >
                  {selected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                  {char.avatar_url && char.avatar_url.trim() ? (
                    <img
                      src={char.avatar_url}
                      alt={char.name}
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0 ring-1 ring-dashed ring-border"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0">
                      {(char.name || "?")[0]}
                    </div>
                  )}
                  <span className="font-medium truncate">{char.name}</span>
                  <span className="ml-auto text-[9px] text-muted-foreground uppercase tracking-wider">Other account</span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}