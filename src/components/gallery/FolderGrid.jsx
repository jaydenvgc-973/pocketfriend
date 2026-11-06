import React from "react";
import { Folder, Trash2, Image as ImageIcon } from "lucide-react";

/**
 * FolderGrid — the main Media Gallery view.
 * Folders are resolved on the server from each image's existing generation
 * context (character chat/text conversation, Story Event, or neither).
 * No image is stored, copied, or moved by this component.
 */
export default function FolderGrid({ folders = [], isLoading, error, onOpen, onDeleteRequest, onRetry }) {
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
        <p className="text-sm text-destructive">Could not load your folders.</p>
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

  if (folders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No media found.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {folders.map((folder) => (
        <div
          key={folder.key}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(folder)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(folder); }}
          className="group relative rounded-xl overflow-hidden border border-border bg-card hover:border-primary/50 transition-all cursor-pointer"
        >
          <div className="aspect-square bg-secondary/40 relative">
            {folder.coverImageUrl ? (
              <img
                src={folder.coverImageUrl}
                alt={folder.name}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23222%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E';
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Folder className="w-10 h-10 text-muted-foreground/50" />
              </div>
            )}

            <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 text-white/90">
              <ImageIcon className="w-3 h-3" />
              <span className="text-[11px] font-medium">{folder.imageCount}</span>
            </div>

            {folder.canDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteRequest(folder); }}
                title="Delete folder"
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white/80 hover:text-destructive hover:bg-black/80 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="px-3 py-2.5 flex items-center gap-2 border-t border-border">
            <Folder className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-sm font-medium text-foreground truncate">{folder.name}</p>
          </div>
        </div>
      ))}
    </div>
  );
}