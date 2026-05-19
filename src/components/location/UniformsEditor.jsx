import { useState } from 'react';
import { ChevronDown, Plus, Upload, Wand2, X, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

/**
 * UNIFORM APPLICABILITY TYPES:
 * - job_title: applies based on matching job title (e.g., "Bartender")
 * - role_status: applies based on character role/status (e.g., "inmate", "officer", "student")
 * - zone: applies based on location zone/area (e.g., "kitchen", "floor")
 * - location_wide: applies to all staff at this location
 * - generic_staff: applies to employees with custom unmatched job titles
 */

const APPLICABILITY_TYPES = [
  { key: 'job_title', label: 'Job Title', description: 'Apply when job title matches' },
  { key: 'role_status', label: 'Role / Status', description: 'Apply based on role (inmate, officer, student, staff, etc.)' },
  { key: 'zone', label: 'Zone / Area', description: 'Apply within specific location zone (kitchen, floor, etc.)' },
  { key: 'location_wide', label: 'Location-Wide', description: 'Default for all staff' },
  { key: 'generic_staff', label: 'Generic Staff', description: 'For unmatched custom employee titles' },
];

function UniformForm({ applicability, uniform, location, onSave, onCancel }) {
  const [name, setName] = useState(uniform?.name || '');
  const [description, setDescription] = useState(uniform?.description || '');
  const [specificity, setSpecificity] = useState(uniform?.job_title || uniform?.role_status || uniform?.zone || '');
  const [imageUrl, setImageUrl] = useState(uniform?.image_url || '');
  const [notes, setNotes] = useState(uniform?.notes || '');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const appType = APPLICABILITY_TYPES.find(a => a.key === applicability);

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
      const context = applicability === 'job_title' ? `for a ${specificity}` :
                      applicability === 'role_status' ? `for ${specificity}` :
                      applicability === 'zone' ? `for the ${specificity}` : 'uniform';
      const prompt = `Professional reference image of a ${name || 'work'} uniform ${context} at "${location?.name || 'a location'}". Description: ${description || 'professional attire'}. Show clothing laid flat or on neutral mannequin, clean background, sharp focus, professional photo.`;
      const res = await base44.integrations.Core.GenerateImage({ prompt });
      if (res?.url) setImageUrl(res.url);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert('Uniform name is required');
      return;
    }
    if ((applicability === 'job_title' || applicability === 'role_status' || applicability === 'zone') && !specificity.trim()) {
      alert(`${appType?.label} is required for this applicability type`);
      return;
    }
    const uniformData = {
      id: uniform?.id || `uniform_${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      image_url: imageUrl,
      notes: notes.trim(),
      applicability,
    };
    if (applicability === 'job_title') uniformData.job_title = specificity.trim();
    if (applicability === 'role_status') uniformData.role_status = specificity.trim();
    if (applicability === 'zone') uniformData.zone = specificity.trim();
    onSave(uniformData);
  };

  return (
    <div className="space-y-3 p-3 bg-secondary/30 rounded-lg border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground">{appType?.label} Uniform</span>
        <button onClick={onCancel} className="text-[10px] text-muted-foreground hover:text-foreground px-1">✕</button>
      </div>

      <input
        type="text"
        placeholder="Uniform name (e.g., 'Black Security Polo')"
        value={name}
        onChange={e => setName(e.target.value)}
        className="w-full h-7 px-2 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground"
      />

      {['job_title', 'role_status', 'zone'].includes(applicability) && (
        <input
          type="text"
          placeholder={applicability === 'job_title' ? 'Job title (e.g., "Bartender")' : 
                       applicability === 'role_status' ? 'Role (e.g., "inmate", "officer", "student")' :
                       'Zone (e.g., "kitchen", "floor")'}
          value={specificity}
          onChange={e => setSpecificity(e.target.value)}
          className="w-full h-7 px-2 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground"
        />
      )}

      <textarea
        placeholder="Detailed description (e.g., 'Black polo shirt with company logo, black slacks')"
        value={description}
        onChange={e => setDescription(e.target.value)}
        className="w-full h-12 px-2 py-1 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground resize-none"
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
                className="p-1.5 rounded-full bg-background/80 text-foreground hover:bg-background disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setImageUrl('')} className="p-1.5 rounded-full bg-destructive/80 text-destructive-foreground hover:bg-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <label className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground cursor-pointer transition-colors text-xs">
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? 'Uploading...' : 'Upload'}
            </label>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground cursor-pointer transition-colors text-xs disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              Generate
            </button>
          </div>
        )}
      </div>

      <textarea
        placeholder="Notes (seasonal variants, special conditions, etc.)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className="w-full h-10 px-2 py-1 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground resize-none"
      />

      <div className="flex gap-1.5 pt-1">
        <button
          onClick={handleSave}
          className="flex-1 h-7 px-2 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
        >
          Save Uniform
        </button>
        <button
          onClick={onCancel}
          className="h-7 px-2 rounded text-xs bg-secondary text-foreground hover:bg-secondary/80"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function UniformsEditor({ location, onUpdate }) {
  const uniforms = location?.uniforms || {};
  const [expanded, setExpanded] = useState(false);
  const [editingType, setEditingType] = useState(null);

  const handleSave = (uniformData) => {
    console.log('[UNIFORM-SAVE-DEBUG] Saving uniform:', uniformData);
    const updated = {
      ...uniforms,
      [uniformData.id]: uniformData,
    };
    console.log('[UNIFORM-SAVE-DEBUG] Updated uniforms object:', updated);
    onUpdate({ uniforms: updated });
    setEditingType(null);
  };

  const handleDelete = (uniformId) => {
    const updated = { ...uniforms };
    delete updated[uniformId];
    console.log('[UNIFORM-DELETE-DEBUG] Deleted uniform:', uniformId, ' Remaining:', updated);
    onUpdate({ uniforms: updated });
  };

  const definedCount = Object.values(uniforms).filter(u => u?.name || u?.image_url).length;

  return (
    <div className="border border-border rounded-lg bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Uniforms & Attire</span>
          {definedCount > 0 && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{definedCount} defined</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2.5 border-t border-border">
          {APPLICABILITY_TYPES.map((appType) => {
            const uniformsOfType = Object.entries(uniforms).filter(([id, u]) => u?.applicability === appType.key);
            const isEditing = editingType === appType.key;

            return (
              <div key={appType.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">{appType.label}</p>
                    <p className="text-[10px] text-muted-foreground">{appType.description}</p>
                  </div>
                  {!isEditing && (
                    <button
                      onClick={() => setEditingType(appType.key)}
                      className="shrink-0 text-[10px] text-primary hover:text-primary/80 font-medium px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>

                {uniformsOfType.map(([uniformId, uniform]) => (
                  <div key={uniformId} className="bg-secondary/40 rounded-lg p-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">{uniform.name}</p>
                        {uniform.job_title && <p className="text-[10px] text-muted-foreground">Job: {uniform.job_title}</p>}
                        {uniform.role_status && <p className="text-[10px] text-muted-foreground">Role: {uniform.role_status}</p>}
                        {uniform.zone && <p className="text-[10px] text-muted-foreground">Zone: {uniform.zone}</p>}
                        {uniform.description && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{uniform.description}</p>}
                      </div>
                      {uniform.image_url && (
                        <img src={uniform.image_url} alt={uniform.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      )}
                      <button
                        onClick={() => handleDelete(uniformId)}
                        className="text-destructive/60 hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors flex-shrink-0"
                        title="Delete uniform"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {isEditing && (
                  <UniformForm
                    applicability={appType.key}
                    uniform={null}
                    location={location}
                    onSave={handleSave}
                    onCancel={() => setEditingType(null)}
                  />
                )}
              </div>
            );
          })}

          <div className="mt-3 p-2 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[10px] text-muted-foreground leading-tight">
              Uniforms apply only while a character functions in that role/status at this location. Visitors/customers do not wear uniforms. Uniforms never permanently replace closet outfits.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}