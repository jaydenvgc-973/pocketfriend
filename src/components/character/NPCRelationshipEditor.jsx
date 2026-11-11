import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Upload, X, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { motion, AnimatePresence } from "framer-motion";
import { resolveRelationshipAvatar, getRelationshipIdentityReferences } from "@/lib/relationshipAvatarResolver";
import { buildCharacterIdentityLock } from "@/lib/characterIdentityLock";

// The existing relationship dimensions for a relationship between two characters.
// Same field names the app already stores on fictional_relationships entries.
const REL_LEVELS = [
  // Respect is stored on relationship entries as user_respect_level (some older entries use respect_level).
  { key: "user_respect_level", label: "Respect", color: "text-blue-400", fallback: 50, readFrom: ["user_respect_level", "respect_level"] },
  { key: "friendship_level", label: "Friendship", color: "text-emerald-400", fallback: 75 },
  { key: "romantic_level", label: "Romantic", color: "text-pink-400", fallback: 0 },
  { key: "attraction_level", label: "Attraction", color: "text-orange-400", fallback: 0 },
  { key: "chosen_family_level", label: "Chosen Family", color: "text-purple-400", fallback: 0 },
];

// Reads the existing stored value without resetting it when the record uses a variant key.
function readLevel(relationship, level) {
  for (const key of level.readFrom || [level.key]) {
    if (relationship?.[key] !== undefined && relationship?.[key] !== null) return relationship[key];
  }
  return level.fallback;
}

export default function NPCRelationshipEditor({ character, relationship, allCharacters = [], onUpdate, onClose }) {
  const [form, setForm] = useState({
    person_name: relationship?.person_name || "",
    relationship_type: relationship?.relationship_type || "",
    description: relationship?.description || "",
    avatar_url: relationship?.avatar_url || "",
  });
  // Values belong to the relationship between THIS character and the selected person.
  const [levels, setLevels] = useState(() =>
    REL_LEVELS.reduce((acc, l) => ({ ...acc, [l.key]: readLevel(relationship, l) }), {})
  );
  // Only values the user actually adjusted are written — untouched stored values stay exactly as they are.
  const [dirtyLevels, setDirtyLevels] = useState({});
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Established identity: the linked character (or name-matched character) record.
  // Its avatar is the authoritative one already used everywhere else in Pocketfriend.
  const resolved = resolveRelationshipAvatar(
    { ...relationship, person_name: form.person_name, avatar_url: form.avatar_url },
    allCharacters
  );
  const linkedCharacter = resolved.character;
  const establishedAvatar = resolved.avatarUrl;

  // USER-PARTICIPANT GUARD: entries with participant_type:"user" or _is_user:true are the
  // authenticated user — they cannot be edited as NPC entries. Avatar comes from User Profile.
  if (relationship?.participant_type === 'user' || relationship?._is_user === true) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">This is You</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          This entry represents you — the authenticated user. Your name and avatar come from your User Profile and cannot be edited here.
        </p>
        <p className="text-xs text-muted-foreground">
          To update your name or appearance, go to <span className="text-primary">My Profile → Settings</span>.
        </p>
      </div>
    );
  }

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
    if (!form.person_name.trim() || generating) return;
    setGenerating(true);
    try {
      if (linkedCharacter) {
        // EXISTING IDENTITY PATHWAY: the character's established avatar + reference images
        // and appearance lock are the visual source of truth. The generated image stays
        // attached to THIS relationship entry only — the character's authoritative avatar,
        // reference images and appearance are never touched.
        const refs = getRelationshipIdentityReferences(linkedCharacter);
        const prompt = `Photorealistic portrait headshot of ${linkedCharacter.name}. ${form.description ? `Context: ${form.description}. ` : ""}${buildCharacterIdentityLock(linkedCharacter)}
This image MUST depict the exact same established person shown in the reference images — identical face shape, features, hair, skin tone and build. Do NOT restyle, age, beautify, recolour or reinterpret this person's identity, and do NOT create a different person.`;
        const res = await base44.integrations.Core.GenerateImage({
          prompt,
          existing_image_urls: refs.length > 0 ? refs : undefined,
        });
        if (res?.url) setForm(p => ({ ...p, avatar_url: res.url }));
      } else {
        // Unlinked world person — no established identity exists to preserve.
        const prompt = `Generate a realistic portrait photo of a person named ${form.person_name}. ${form.description ? `They are: ${form.description}. ` : ""}Create a professional headshot-style photo suitable for a character avatar.`;
        const res = await base44.integrations.Core.GenerateImage({ prompt });
        if (res?.url) setForm(p => ({ ...p, avatar_url: res.url }));
      }
    } finally {
      setGenerating(false);
    }
  };

  const normalizeRelationType = (type) => {
    const normalized = type?.toLowerCase().trim();
    if (normalized === 'mom') return 'mother';
    if (normalized === 'dad') return 'father';
    return normalized;
  };

  const handleSave = async () => {
    if (!form.person_name.trim()) return;
    const originalName = relationship?.person_name?.toLowerCase();
    const originalType = normalizeRelationType(relationship?.relationship_type);
    const originalLinkedId = relationship?.related_character_id || null;
    const newName = form.person_name?.toLowerCase();
    const newType = normalizeRelationType(form.relationship_type);

    // Only these values are written — name, relationship, description, avatar and any
    // relationship level the user actually adjusted. Everything else is preserved untouched.
    const values = { ...form };
    for (const l of REL_LEVELS) {
      if (dirtyLevels[l.key]) values[l.key] = levels[l.key];
    }
    // Older entries store respect under respect_level — keep both in step, never stale.
    if (dirtyLevels.user_respect_level && relationship?.respect_level !== undefined) {
      values.respect_level = levels.user_respect_level;
    }

    try {
      // Always re-fetch the current character record before writing — prevents stale
      // prop data from overwriting newer fictional_relationships saved since last render.
      const fresh = await base44.entities.Character.filter({ id: character.id }).catch(() => []);
      const currentRels = fresh[0]?.fictional_relationships || character.fictional_relationships || [];

      // A linked relationship is matched by its linked character — never by a name that
      // another entry could also share. Unlinked entries keep the existing name+type match.
      const isOriginalEntry = (r) => {
        if (originalLinkedId) return r.related_character_id === originalLinkedId;
        return r.person_name?.toLowerCase() === originalName
          && normalizeRelationType(r.relationship_type) === originalType
          && !r.related_character_id;
      };

      const updated = relationship
        ? currentRels.reduce((acc, r) => {
            if (isOriginalEntry(r)) {
              acc.push({ ...r, ...values });
            } else if (
              originalLinkedId ||
              r.related_character_id ||
              !(r.person_name?.toLowerCase() === newName && normalizeRelationType(r.relationship_type) === newType)
            ) {
              // Linked people and other characters' relationships are never dropped.
              acc.push(r);
            }
            return acc;
          }, [])
        : [...currentRels, values];

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

      <div className="pt-3 border-t border-border space-y-3">
        <label className="text-xs text-muted-foreground uppercase tracking-wider block">
          Relationship Levels — {character?.name || "This character"} &amp; {form.person_name || "this person"}
        </label>
        {REL_LEVELS.map(({ key, label, color, fallback }) => (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={`text-sm font-medium ${color}`}>{label}</label>
              <span className="text-sm font-semibold text-foreground">{levels[key] ?? fallback}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[levels[key] ?? fallback]}
              onValueChange={([v]) => {
                setLevels(p => ({ ...p, [key]: v }));
                setDirtyLevels(p => ({ ...p, [key]: true }));
              }}
              className="w-full"
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground uppercase tracking-wider block">Avatar</label>
        {establishedAvatar ? (
          <div className="relative group">
            <img src={establishedAvatar} alt={form.person_name} className="w-full aspect-square object-cover rounded-xl" />
            {form.avatar_url && (
              <button
                onClick={() => setForm(p => ({ ...p, avatar_url: "" }))}
                className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Clear this relationship's image and use their established avatar"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            )}
            {!form.avatar_url && linkedCharacter && (
              <span className="absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white">Their avatar</span>
            )}
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