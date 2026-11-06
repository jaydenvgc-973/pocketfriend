import React from "react";
import { Calendar, Image as ImageIcon } from "lucide-react";

/**
 * MonthGrid — the month-and-year subfolders inside a character's Media Gallery folder.
 * Month buckets come from the server, built from each image's existing generation
 * date. A month with no images never appears here, and no images are loaded until
 * a month is opened.
 */
export default function MonthGrid({ months = [], isLoading, error, onOpen, onRetry }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-destructive">Could not load this folder's months.</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No images in this folder yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {months.map((month) => (
        <div
          key={month.key}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(month)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(month); }}
          className="group relative rounded-xl overflow-hidden border border-border bg-card hover:border-primary/50 transition-all cursor-pointer"
        >
          <div className="aspect-square bg-secondary/40 relative">
            {month.coverImageUrl ? (
              <img
                src={month.coverImageUrl}
                alt={month.label}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23222%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E';
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Calendar className="w-10 h-10 text-muted-foreground/50" />
              </div>
            )}

            <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 text-white/90">
              <ImageIcon className="w-3 h-3" />
              <span className="text-[11px] font-medium">{month.imageCount}</span>
            </div>
          </div>

          <div className="px-3 py-2.5 flex items-center gap-2 border-t border-border">
            <Calendar className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-sm font-medium text-foreground truncate">{month.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}