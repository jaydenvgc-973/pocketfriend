import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, ChevronLeft, ChevronRight, List, Loader2 } from "lucide-react";
import NovelChapterText from "@/components/novels/NovelChapterText";
import NovelTableOfContents from "@/components/novels/NovelTableOfContents";
import ContinueNovelPanel from "@/components/novels/ContinueNovelPanel";
import NovelGeneratingOverlay from "@/components/novels/NovelGeneratingOverlay";
import NovelChapterActions from "@/components/novels/NovelChapterActions";

export default function NovelReader() {
  const { novelId } = useParams();
  const queryClient = useQueryClient();
  const [activeNumber, setActiveNumber] = useState(null);
  const [showToc, setShowToc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const { data: novel, isLoading: loadingNovel, isError: novelError } = useQuery({
    queryKey: ["novel", novelId],
    queryFn: () => base44.entities.Novel.get(novelId),
    enabled: !!novelId,
    retry: false,
  });

  const { data: chapters = [], isLoading: loadingChapters } = useQuery({
    queryKey: ["novel-chapters", novelId],
    queryFn: async () => {
      const rows = await base44.entities.NovelChapter.filter({ novel_id: novelId }, "chapter_number", 100);
      return [...rows].sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0));
    },
    enabled: !!novelId,
  });

  const current = activeNumber
    ? chapters.find((c) => c.chapter_number === activeNumber) || chapters[chapters.length - 1]
    : chapters[chapters.length - 1];
  const index = current ? chapters.findIndex((c) => c.id === current.id) : -1;
  const previous = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;
  const isLast = index >= 0 && index === chapters.length - 1;
  const nextChapterNumber = (chapters[chapters.length - 1]?.chapter_number || 0) + 1;

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setShowToc(false);
  }, [current?.id]);

  // A novel that does not exist is a real 404 for crawlers, once loading has finished.
  useEffect(() => {
    if (!novelError || loadingNovel) return;
    const meta = document.createElement("meta");
    meta.name = "prerender-status-code";
    meta.content = "404";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [novelError, loadingNovel]);

  const refreshNovel = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["novel-chapters", novelId] }),
    queryClient.invalidateQueries({ queryKey: ["novel", novelId] }),
    queryClient.invalidateQueries({ queryKey: ["novels", novel?.character_id] }),
  ]);

  const handleContinue = async (direction) => {
    setBusy(true);
    setBusyLabel(`Writing chapter ${nextChapterNumber}`);
    setError(null);
    setActionError(null);
    try {
      const res = await base44.functions.invoke("generateNovelChapter", {
        mode: "continue",
        novel_id: novelId,
        direction,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      await refreshNovel();
      setActiveNumber(res.data.chapter?.chapter_number ?? null);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "That chapter could not be written.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  // Rewrite only the chapter being read — the rest of the novel is untouched.
  const handleRedoChapter = async () => {
    if (!current) return;
    setBusy(true);
    setBusyLabel(`Rewriting chapter ${current.chapter_number}`);
    setError(null);
    setActionError(null);
    try {
      const res = await base44.functions.invoke("generateNovelChapter", {
        mode: "redo",
        novel_id: novelId,
        chapter_id: current.id,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      await refreshNovel();
      setActiveNumber(res.data.chapter?.chapter_number ?? current.chapter_number);
    } catch (err) {
      setActionError(err?.response?.data?.error || err?.message || "That chapter could not be rewritten.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  // Delete only this chapter and its illustrations, then keep the numbering coherent.
  const handleDeleteChapter = async () => {
    if (!current) return;
    const target = current;
    setBusy(true);
    setBusyLabel(`Removing chapter ${target.chapter_number}`);
    setError(null);
    setActionError(null);
    try {
      await base44.entities.NovelChapter.delete(target.id);
      const later = chapters.filter((c) => (c.chapter_number || 0) > (target.chapter_number || 0));
      if (later.length) {
        await base44.entities.NovelChapter.bulkUpdate(
          later.map((c, i) => ({ id: c.id, chapter_number: (target.chapter_number || 0) + i }))
        );
      }
      const remaining = chapters.length - 1;
      await base44.entities.Novel.update(novelId, { chapter_count: remaining });
      await refreshNovel();
      setActiveNumber(remaining > 0 ? Math.min(target.chapter_number || 1, remaining) : null);
    } catch (err) {
      setActionError(err?.response?.data?.error || err?.message || "That chapter could not be removed.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  if (loadingNovel || loadingChapters) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      </div>
    );
  }

  if (novelError || !novel) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium text-foreground">This novel no longer exists.</p>
        <Link to="/home" className="mt-3 text-xs text-primary hover:underline">Back to Pocketfriend</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center gap-2">
          <Link
            to={`/profile/${novel.character_id}`}
            className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Back to the novel library"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <p className="text-xs font-medium text-foreground flex-1 truncate">{novel.title}</p>
          <button
            onClick={() => setShowToc((v) => !v)}
            className={`p-1.5 rounded-lg transition-colors ${showToc ? "bg-primary/15 text-primary" : "hover:bg-secondary text-muted-foreground"}`}
            title="Contents"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
        {showToc && (
          <div className="max-w-2xl mx-auto px-4 pb-3">
            <NovelTableOfContents
              chapters={chapters}
              activeNumber={current?.chapter_number}
              onSelect={setActiveNumber}
            />
          </div>
        )}
      </div>

      <article className="max-w-2xl mx-auto px-5 pt-8">
        <header className="text-center mb-10">
          <h1 className="text-2xl font-semibold text-foreground leading-tight font-serif">{novel.title}</h1>
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {novel.perspective === "outside_narrator" ? "An outside narrator" : `Told by ${novel.character_name}`}
          </p>
          {(novel.focus_character_names || []).length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              with {novel.focus_character_names.join(", ")}
            </p>
          )}
          <div className="mt-4 mx-auto w-12 border-t border-border" />
        </header>

        {!current ? (
          <p className="text-sm text-muted-foreground text-center">No chapters yet.</p>
        ) : (
          <>
            <div className="text-center mb-7">
              <p className="text-[10px] uppercase tracking-[0.22em] text-primary/80">
                Chapter {current.chapter_number}
              </p>
              <h2 className="mt-1.5 text-lg font-semibold text-foreground font-serif">{current.title}</h2>
            </div>

            <NovelChapterText chapter={current} />

            <div className="flex items-center justify-between mt-10">
              <button
                onClick={() => previous && setActiveNumber(previous.chapter_number)}
                disabled={!previous}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <span className="text-[10px] text-muted-foreground">{current.word_count || 0} words</span>
              <button
                onClick={() => next && setActiveNumber(next.chapter_number)}
                disabled={!next}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <NovelChapterActions
              chapter={current}
              onRedo={handleRedoChapter}
              onDelete={handleDeleteChapter}
              disabled={busy}
              error={actionError}
            />

            {isLast && (
              <ContinueNovelPanel
                nextChapterNumber={nextChapterNumber}
                onGenerate={handleContinue}
                busy={busy}
                error={error}
              />
            )}
          </>
        )}
      </article>

      <NovelGeneratingOverlay open={busy} label={busyLabel || `Writing chapter ${nextChapterNumber}`} />
    </div>
  );
}