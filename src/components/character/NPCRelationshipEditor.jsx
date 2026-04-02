import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Upload, X, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";

export default function NPCRelationshipEditor({ character, relationship, onUpdate, onClose }) {
  const [form, setForm] = useState({
    person_name: relationship?.person_name || "",
    relationship_type: relationship?.relationship_type || "",
    description: relationship?.description || "",
    avatar_url: relationship?.avatar_url || "",
  });
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      const fileUrl = res?.file_url || res?.url;
      if (fileUrl) {
        setForm(p => ({ ...p, avatar_url: fileUrl }));
      } else {
        console.error('Upload failed: no URL returned', res);
      }
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!form.person_name.trim()) return;
    setGenerating(true);
    const prompt = `Generate a realistic portrait photo of a person named ${form.person_name}. ${form.description ? `They are: ${form.description}. ` : ""}Create a professional headshot-style photo suitable for a character avatar.`;
    const res = await base44.integrations.Core.GenerateImage({ prompt });
    if (res?.url) {
      setForm(p => ({ ...p, avatar_url: res.url }));
    }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!form.person_name.trim()) return;
    const updated = (character.fictional_relationships || []).map(r =>
      r.person_name?.toLowerCase() === relationship?.person_name?.toLowerCase() 
        ? { ...r, ...form } 
        : r
    );
    try {
      await base44.entities.Character.update(character.id, { fictional_relationships: updated });
      onClose?.();
    } catch (err) {
      console.error('Failed to save NPC:', err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-card border border-border rounded-2xl p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Edit NPC</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Name</label>
        <Input
          value={form.person_name}
          onChange={e => setForm(p => ({ ...p, person_name: e.target.value }))}
          placeholder="e.g. Marcus, Sarah"
          className="h-10 rounded-xl"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Relationship</label>
        <Input
          value={form.relationship_type}
          onChange={e => setForm(p => ({ ...p, relationship_type: e.target.value }))}
          placeholder="e.g. Best friend, Sibling, Coworker"
          className="h-10 rounded-xl"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Description</label>
        <Textarea
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          placeholder="Brief description of who they are..."
          className="rounded-xl min-h-[60px] resize-none text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground uppercase tracking-wider block">Avatar</label>
        {form.avatar_url ? (
          <div className="relative group">
            <img src={form.avatar_url} alt={form.person_name} className="w-full aspect-square object-cover rounded-xl" />
            <button
              onClick={() => setForm(p => ({ ...p, avatar_url: "" }))}
              className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        ) : (
          <div className="aspect-square bg-secondary/40 rounded-xl flex items-center justify-center text-muted-foreground text-sm">
            No avatar
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="cursor-pointer">
            <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
            <div className="h-10 rounded-xl border border-dashed border-border bg-card hover:border-primary/40 flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  Upload
                </>
              )}
            </div>
          </label>
          <Button
            onClick={handleGenerate}
            disabled={generating || !form.person_name.trim()}
            variant="outline"
            size="sm"
            className="h-10 rounded-xl gap-1.5 text-xs"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Generate
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!form.person_name.trim()} className="flex-1 rounded-xl">
          Save
        </Button>
      </div>
    </motion.div>
  );
}