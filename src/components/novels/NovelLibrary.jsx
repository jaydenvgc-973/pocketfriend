import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { BookOpen, Loader2, Plus } from "lucide-react";
import NovelCard from "./NovelCard";
import NovelCreateDialog from "./NovelCreateDialog";
import NovelGeneratingOverlay from "./NovelGeneratingOverlay";
import DeleteNovelDialog from "./DeleteNovelDialog";
import { normalizeNovelError } from "@/lib/novelGenerationError";

export default function NovelLibrary({ character, characters = [], currentUser = null, worldName = "" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const { data: novels = [], isLoading } = useQuery({
    queryKey: ["novels", character?.id],
    queryFn: () => base44.entities.Novel.filter({ character_id: character.id }, "-created_date", 50),
    enabled: !!character?.id,
  });

  const handleCreate = async (form) => {
    setBusy(true);
    setFailure(null);
    try {
      const res = await base44.functions.invoke("generateNovelChapter", {
        mode: "create",
        character_id: character.id,
        title: form.title || undefined,
        focus: form.focus,
        premise: form.premise,
        perspective: form.perspective,
        focus_character_ids: form.focusCharacterIds,
        focus_mode: form.focusMode,
        include_user: form.includeUser,
        exclusions: form.exclusions || [],
      });
      if (res?.data?.error) throw new Error(res.data.error);
      const notices = res.data.notices || [];
      await queryClient.invalidateQueries({ queryKey: ["novels", character.id] });
      setCreating(false);
      // The plates are drawn by the reader in a second request, once the chapter exists.
      const illustrationChapterId = res.data.illustration_pending ? res.data.chapter?.id : null;
      navigate(`/novel/${res.data.novel.id}`, { state: { notices, illustrationChapterId } });
    } catch (err) {
      setFailure(normalizeNovelError(err, { operation: "create" }));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const novel = toDelete;
    setToDelete(null);
    await base44.entities.NovelChapter.deleteMany({ novel_id: novel.id });
    await base44.entities.Novel.delete(novel.id);
    queryClient.setQueryData(["novels", character?.id], (old = []) => old.filter((n) => n.id !== novel.id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-muted-foreground leading-tight max-w-[70%]">
          Novels written from {character?.name}&apos;s life. Nothing is ever generated until you ask for it.
        </p>
        <button
          onClick={() => { setFailure(null); setCreating(true); }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> New novel
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading novels…
        </div>
      ) : novels.length === 0 ? (
        <div className="py-6 text-center border border-dashed border-border rounded-xl">
          <BookOpen className="w-5 h-5 text-muted-foreground/50 mx-auto" />
          <p className="mt-2 text-xs text-muted-foreground">No novels yet.</p>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">Start one and read it chapter by chapter.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {novels.map((novel) => (
            <NovelCard key={novel.id} novel={novel} onDelete={setToDelete} />
          ))}
        </div>
      )}

      {creating && (
        <NovelCreateDialog
          open={creating}
          onOpenChange={setCreating}
          character={character}
          characters={characters}
          worldName={worldName}
          onSubmit={handleCreate}
          busy={busy}
          failure={failure}
        />
      )}

      <NovelGeneratingOverlay open={busy} label="Writing chapter one" />
      <DeleteNovelDialog novel={toDelete} onCancel={() => setToDelete(null)} onConfirm={handleDelete} />
    </div>
  );
}