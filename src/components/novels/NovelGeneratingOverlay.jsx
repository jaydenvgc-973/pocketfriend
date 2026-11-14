import { Loader2 } from "lucide-react";

export default function NovelGeneratingOverlay({ open, label = "Writing chapter one" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-background/90 backdrop-blur-sm flex items-center justify-center px-8">
      <div className="text-center max-w-xs">
        <Loader2 className="w-7 h-7 text-primary animate-spin mx-auto" />
        <p className="mt-4 text-sm font-medium text-foreground">{label}…</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Reading their recorded life, then writing the chapter and illustrating it. This usually takes about a minute.
        </p>
      </div>
    </div>
  );
}