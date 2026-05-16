import { useState } from 'react';
import { ChevronDown, Plus, Upload, Wand2, X, Loader2, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

const UNIFORM_CATEGORIES = [
  { key: 'inmate', label: 'Inmate / Confined Person', color: 'bg-orange-500/10 border-orange-500/20' },
  { key: 'correctional_officer', label: 'Correctional Officer / Guard', color: 'bg-blue-500/10 border-blue-500/20' },
  { key: 'warden', label: 'Warden / Administration', color: 'bg-purple-500/10 border-purple-500/20' },
  { key: 'medical', label: 'Medical Staff', color: 'bg-green-500/10 border-green-500/20' },
  { key: 'support', label: 'Maintenance / Kitchen / Support Staff', color: 'bg-secondary border-border' },
];

function UniformCategoryEditor({ cat, uniform, locationName, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState(uniform?.description || '');
  const [color, setColor] = useState(uniform?.color || '');
  const [imageUrl, setImageUrl] = useState(uniform?.image_url || '');
  const [notes, setNotes] = useState(uniform?.notes || '');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Sync if parent changes (e.g. save from outside)
  const handleOpen = () => {
    setDesc(uniform?.description || '');
    setColor(uniform?.color || '');
    setImageUrl(uniform?.image_url || '');
    setNotes(uniform?.notes || '');
    setOpen(true);
  };

  const handleSave = () => {
    onSave(cat.key, { description: desc, color, image_url: imageUrl, notes });
    setOpen(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      if (res?.file_url) setImageUrl(res.file_url);
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const descText = desc || cat.label;
      const colorText = color ? `, color: ${color}` : '';
      const prompt = `Photorealistic reference image of a ${cat.label} uniform for a correctional facility called "${locationName}". The uniform is described as: ${descText}${colorText}. Show the clothing laid flat or on a neutral mannequin, clean white or grey background. Professional reference photo, no text, no logo, sharp focus.`;
      const res = await base44.integrations.Core.GenerateImage({ prompt });
      if (res?.url) setImageUrl(res.url);
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteImage = () => setImageUrl('');

  return (
    <div className={`p-2.5 rounded-lg border ${cat.color}`}>
      {!open ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">{cat.label}</p>
            {uniform ? (
              <div className="flex items-start gap-2 mt-1">
                {uniform.image_url && (
                  <img src={uniform.image_url} alt={cat.label} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                )}
                <div className="min-w-0">
                  {uniform.description && <p className="text-[10px] text-muted-foreground truncate">{uniform.description}</p>}
                  {uniform.color && <p className="text-[10px] text-muted-foreground">Color: {uniform.color}</p>}
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Not defined</p>
            )}
          </div>
          <button
            onClick={handleOpen}
            className="shrink-0 text-[10px] text-primary hover:text-primary/80 font-medium px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            {uniform ? 'Edit' : '+ Define'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">{cat.label}</span>
            <button onClick={() => setOpen(false)} className="text-[10px] text-muted-foreground hover:text-foreground px-1">✕</button>
          </div>

          <input
            type="text"
            placeholder="Description (e.g., Orange jumpsuit with white undershirt)"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="w-full h-7 px-2 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground"
          />

          <input
            type="text"
            placeholder="Color (e.g., orange, gray, navy blue)"
            value={color}
            onChange={e => setColor(e.target.value)}
            className="w-full h-7 px-2 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground"
          />

          {/* Image section */}
          <div className="space-y-1.5">
            {imageUrl ? (
              <div className="relative group rounded-lg overflow-hidden border border-border w-full aspect-video bg-secondary">
                <img src={imageUrl} alt="uniform reference" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <label className="cursor-pointer p-1.5 rounded-full bg-background/80 text-foreground hover:bg-background">
                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </label>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="p-1.5 rounded-full bg-background/80 text-foreground hover:bg-background"
                  >
                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={handleDeleteImage} className="p-1.5 rounded-full bg-destructive/80 text-destructive-foreground hover:bg-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <label className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground cursor-pointer transition-colors text-xs">
                  <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  {uploading ? 'Uploading...' : 'Upload image'}
                </label>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground cursor-pointer transition-colors text-xs disabled:opacity-50"
                >
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  {generating ? 'Generating...' : 'Generate'}
                </button>
              </div>
            )}
          </div>

          <textarea
            placeholder="Notes (e.g. seasonal variants, special conditions)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full h-10 px-2 py-1 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground resize-none"
          />

          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={handleSave}
              className="flex-1 h-7 px-2 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              Save
            </button>
            {uniform && (
              <button
                onClick={() => { onDelete(cat.key); setOpen(false); }}
                className="h-7 px-2 rounded text-xs bg-destructive/20 text-destructive hover:bg-destructive/30"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UniformsEditor({ location, onUpdate }) {
  const uniforms = location?.correctional_attire?.by_role || {};
  const [expanded, setExpanded] = useState(false);

  const handleSave = (categoryKey, data) => {
    const updated = {
      ...(location?.correctional_attire || {}),
      by_role: {
        ...uniforms,
        [categoryKey]: data,
      },
    };
    onUpdate({ correctional_attire: updated });
  };

  const handleDelete = (categoryKey) => {
    const updated = { ...uniforms };
    delete updated[categoryKey];
    onUpdate({
      correctional_attire: {
        ...(location?.correctional_attire || {}),
        by_role: updated,
      },
    });
  };

  const definedCount = Object.values(uniforms).filter(u => u?.description || u?.image_url).length;

  return (
    <div className="border border-border rounded-lg bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Uniforms by Role</span>
          {definedCount > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{definedCount} defined</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2 border-t border-border">
          {UNIFORM_CATEGORIES.map((cat) => (
            <UniformCategoryEditor
              key={cat.key}
              cat={cat}
              uniform={uniforms[cat.key]}
              locationName={location?.name || 'this facility'}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}

          <div className="mt-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[10px] text-muted-foreground leading-tight">
              🔒 Confined inmates → inmate uniform. Assigned staff → matching role uniform. Visitors and non-staff keep their normal clothing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}