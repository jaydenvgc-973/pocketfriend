/**
 * DateSeparator
 * 
 * Displays a visible date divider in the chat/text thread.
 * Shown once per calendar day. Day boundary = 12:00 AM local time.
 * Format: "Monday, April 21, 2026"
 */
export default function DateSeparator({ label }) {
  return (
    <div className="flex items-center gap-3 py-2 px-1 select-none">
      <div className="flex-1 h-px bg-border/60" />
      <span className="text-[11px] font-medium text-muted-foreground/70 whitespace-nowrap tracking-wide">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}