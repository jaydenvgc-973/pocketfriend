import React from "react";
import { Send } from "lucide-react";

/**
 * GalleryImageGrid — existing gallery image grid, pagination, and states.
 * Kept separate so loading / empty / error are visibly distinct instead of
 * showing an endless spinner or "0 images".
 */
export default function GalleryImageGrid({
  images = [],
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onOpenImage,
  currentPage,
  hasMore,
  onPrev,
  onNext,
  isBeyondGallery,
  pageJumpValue,
  onPageJumpValueChange,
  onPageJump,
  emptyMessage,
}) {
  const showSpinner = isLoading && images.length === 0;
  const showError = isError && images.length === 0;
  const showEmpty = !isLoading && !isError && images.length === 0;

  if (showSpinner) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
      </div>
    );
  }

  if (showError) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-destructive">Could not load images.</p>
        {errorMessage && <p className="text-xs text-muted-foreground">{errorMessage}</p>}
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    );
  }

  if (showEmpty) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        {isBeyondGallery ? `Page ${currentPage} is beyond the gallery.` : (emptyMessage || 'No images match your search.')}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {images.map((item) => (
          <div
            key={item.id}
            className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-border hover:border-primary/50 transition-all"
            onClick={() => onOpenImage(item)}
          >
            <img
              src={item.url}
              alt={item.description || 'Gallery image'}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              onError={(e) => {
                e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23333%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E';
              }}
            />
            {(item.originalPrompt || item.generationPrompt) && (
              <div className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/60 rounded text-[9px] text-white/80 pointer-events-none">
                📝
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <Send className="w-5 h-5 text-white" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-4 mb-8 flex-wrap">
        <button
          onClick={onPrev}
          disabled={currentPage === 1 || isLoading}
          className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Previous
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Page:</span>
          <input
            type="number"
            min="1"
            value={pageJumpValue}
            placeholder={String(currentPage)}
            onChange={(e) => onPageJumpValueChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onPageJump(); }}
            className="w-16 px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:border-primary"
          />
          {pageJumpValue && (
            <button
              onClick={onPageJump}
              className="px-2 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
            >
              Go
            </button>
          )}
        </div>

        <span className="text-sm text-muted-foreground">Page {currentPage}{hasMore ? '+' : ''}</span>

        <button
          onClick={onNext}
          disabled={!hasMore || isLoading || isBeyondGallery}
          className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </>
  );
}