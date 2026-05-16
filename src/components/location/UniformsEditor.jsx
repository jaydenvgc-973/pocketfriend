import { useState } from 'react';
import { ChevronDown, Plus, Trash2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const UNIFORM_CATEGORIES = [
  { key: 'inmate', label: 'Inmate / Confined Person', color: 'bg-orange-500/10' },
  { key: 'correctional_officer', label: 'Correctional Officer / Guard', color: 'bg-blue-500/10' },
  { key: 'warden', label: 'Warden / Administration', color: 'bg-purple-500/10' },
  { key: 'medical', label: 'Medical Staff', color: 'bg-green-500/10' },
  { key: 'support', label: 'Maintenance / Kitchen / Support Staff', color: 'bg-gray-500/10' },
];

export default function UniformsEditor({ location, onUpdate }) {
  const uniforms = location?.correctional_attire?.by_role || {};
  const [expanded, setExpanded] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({});

  const handleAddCategory = (categoryKey) => {
    setEditingCategory(categoryKey);
    setFormData(uniforms[categoryKey] || { description: '', color: '', image_url: '', notes: '' });
  };

  const handleSaveUniform = () => {
    if (!editingCategory) return;
    const updated = {
      ...location.correctional_attire,
      by_role: {
        ...uniforms,
        [editingCategory]: {
          description: formData.description || '',
          color: formData.color || '',
          image_url: formData.image_url || '',
          notes: formData.notes || '',
        },
      },
    };
    onUpdate({ correctional_attire: updated });
    setEditingCategory(null);
  };

  const handleDeleteUniform = (categoryKey) => {
    const updated = { ...uniforms };
    delete updated[categoryKey];
    onUpdate({
      correctional_attire: {
        ...location.correctional_attire,
        by_role: updated,
      },
    });
  };

  return (
    <div className="border border-border rounded-lg bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-secondary/30 transition-colors"
      >
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Uniforms by Role</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2 border-t border-border">
          {UNIFORM_CATEGORIES.map((cat) => {
            const uniform = uniforms[cat.key];
            const isEditing = editingCategory === cat.key;

            return (
              <div key={cat.key} className={`p-2 rounded-lg border border-border ${cat.color}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-foreground">{cat.label}</span>
                      <button
                        onClick={() => setEditingCategory(null)}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        ✕
                      </button>
                    </div>

                    <input
                      type="text"
                      placeholder="e.g., Orange jumpsuit with white undershirt"
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full h-7 px-2 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground"
                    />

                    <input
                      type="text"
                      placeholder="Color (e.g., orange, gray, blue)"
                      value={formData.color || ''}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="w-full h-7 px-2 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground"
                    />

                    <input
                      type="text"
                      placeholder="Image/reference URL (optional)"
                      value={formData.image_url || ''}
                      onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                      className="w-full h-7 px-2 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground"
                    />

                    <textarea
                      placeholder="Additional notes (e.g., seasonal variants, special conditions)"
                      value={formData.notes || ''}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full h-12 px-2 py-1 rounded text-xs bg-background border border-border text-foreground placeholder-muted-foreground resize-none"
                    />

                    <div className="flex gap-1">
                      <button
                        onClick={handleSaveUniform}
                        className="flex-1 h-6 px-2 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
                      >
                        Save
                      </button>
                      {uniform && (
                        <button
                          onClick={() => {
                            handleDeleteUniform(cat.key);
                            setEditingCategory(null);
                          }}
                          className="h-6 px-2 rounded text-xs bg-destructive/20 text-destructive hover:bg-destructive/30"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ) : uniform ? (
                  <div
                    onClick={() => handleAddCategory(cat.key)}
                    className="cursor-pointer space-y-1 group"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-xs font-medium text-foreground">{cat.label}</span>
                      <button className="opacity-0 group-hover:opacity-100 text-[10px] text-primary transition-opacity">
                        Edit
                      </button>
                    </div>
                    {uniform.description && (
                      <p className="text-[10px] text-muted-foreground leading-tight">{uniform.description}</p>
                    )}
                    {uniform.color && (
                      <p className="text-[10px] text-muted-foreground">Color: {uniform.color}</p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => handleAddCategory(cat.key)}
                    className="w-full flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Define {cat.label}
                  </button>
                )}
              </div>
            );
          })}

          <div className="mt-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[10px] text-muted-foreground leading-tight">
              Inmates will automatically wear their facility's inmate uniform while confined.
              Staff will wear the uniform matching their job title category. Visitors keep normal clothing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}