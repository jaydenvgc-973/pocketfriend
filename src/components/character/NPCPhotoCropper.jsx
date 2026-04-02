import { useState, useRef } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NPCPhotoCropper({ photoUrl, npcName, onSave, onClose }) {
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setOffsetX(e.clientX - dragStart.x);
    setOffsetY(e.clientY - dragStart.y);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleReset = () => {
    setScale(1);
    setOffsetX(0);
    setOffsetY(0);
  };

  const handleSave = () => {
    // For now, save the current state (in a real app, you'd generate a cropped canvas image)
    onSave({ scale, offsetX, offsetY });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card border border-border rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">Position Photo — {npcName}</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview Area */}
        <div
          ref={containerRef}
          className="relative w-full h-64 bg-secondary rounded-lg overflow-hidden border border-border cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img
            src={photoUrl}
            alt={npcName}
            draggable={false}
            className="absolute w-full h-full object-cover select-none pointer-events-none"
            style={{
              transform: `scale(${scale}) translate(${offsetX}px, ${offsetY}px)`,
              transformOrigin: 'center',
            }}
          />
          {/* Face guide overlay */}
          <div className="absolute inset-0 border-2 border-primary/30 pointer-events-none flex items-center justify-center">
            <div className="w-24 h-32 border-2 border-primary/50 rounded-full opacity-50" title="Face guide" />
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Zoom</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScale(Math.max(1, scale - 0.2))}
                className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <ZoomOut className="w-4 h-4 text-foreground" />
              </button>
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
                className="flex-1 h-2 rounded-lg appearance-none bg-secondary cursor-pointer"
              />
              <button
                onClick={() => setScale(Math.min(3, scale + 0.2))}
                className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
              >
                <ZoomIn className="w-4 h-4 text-foreground" />
              </button>
              <span className="text-xs text-muted-foreground w-8 text-right">{scale.toFixed(1)}x</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleReset}
              variant="outline"
              size="sm"
              className="flex-1 rounded-lg gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Reset
            </Button>
            <Button
              onClick={handleSave}
              size="sm"
              className="flex-1 rounded-lg"
            >
              Save Position
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center">Drag to reposition, zoom to adjust size. Position face in the center circle.</p>
      </div>
    </div>
  );
}