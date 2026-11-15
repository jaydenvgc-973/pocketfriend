import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, ChevronLeft, ChevronRight, List, Loader2 } from "lucide-react";
import NovelChapterText from "@/components/novels/NovelChapterText";
import NovelTableOfContents from "@/components/novels/NovelTableOfContents";
import ContinueNovelPanel from "@/components/novels/ContinueNovelPanel";
import NovelGeneratingOverlay from "@/components/novels/NovelGeneratingOverlay";
import NovelChapterActions from "@/components/novels/NovelChapterActions";
import NovelGenerationFailure from "@/components/novels/NovelGenerationFailure";
import { normalizeNovelError } from "@/lib/novelGenerationError";

export default function NovelReader() {
  const { novelId } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [activeNumber, setActiveNumber] = useState(null);
  const [showToc, setShowToc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [failure, setFailure] = useState(null);
  const [exclusions, setExclusions] = useState([]);
  // Notices carried over from an earlier request, e.g. a plate that failed to render.
  const [notices, setNotices] = useState(location.state?.notices || []);
  // Delete is not a generation attempt: its failures stay a plain line of text.
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
  // A chapter whose finishing request has not completed is never shown as a
  // finished chapter: it says so, and finishing it continues from where it stops.
  const incomplete = current?.writing_state === "writing";

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

  // The plates are drawn in their own request, after the chapter is already saved.
  // A failure here costs the illustrations, never the prose.
  const drawIllustrations = async (chapterId) => {
    if (!chapterId) return;
    setBusyLabel("Adding illustrations");
    try {
      const res = await base44.functions.invoke("generateNovelIllustrations", {
        novel_id: novelId,
        chapter_id: chapterId,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      await refreshNovel();
      setNotices((prev) => [...new Set([...prev, ...(res.data.notices || [])])]);
    } catch {
      setNotices((prev) => [...new Set([...prev, "The illustrations could not be created this time. The chapter itself is complete and saved."])]);
    }
  };

  // A chapter is written in two bounded requests: the opening, then the finish that
  // completes it. Each one stays inside the platform's request limit, and the
  // opening is saved as soon as it exists, so a failed finish never loses prose.
  const openChapter = async (payload, label) => {
    setBusy(true);
    setBusyLabel(label);
    setFailure(null);
    setNotices([]);
    setActionError(null);
    try {
      const res = await base44.functions.invoke("generateNovelChapter", payload);
      if (res?.data?.error) throw new Error(res.data.error);
      await refreshNovel();
      setActiveNumber(res.data.chapter?.chapter_number ?? null);
      return res.data;
    } catch (err) {
      setFailure(normalizeNovelError(err, { operation: payload.mode === "redo" ? "redo" : "open" }));
      return null;
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const finishChapter = async (chapterId, numberHint = null) => {
    if (!chapterId) return false;
    setBusy(true);
    setBusyLabel(`Finishing chapter ${numberHint || nextChapterNumber}`);
    setFailure(null);
    setActionError(null);
    let completed = false;
    try {
      const res = await base44.functions.invoke("generateNovelChapter", {
        mode: "continue",
        part: "finish",
        novel_id: novelId,
        chapter_id: chapterId,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      await refreshNovel();
      setActiveNumber(res.data.chapter?.chapter_number ?? numberHint ?? null);
      setNotices((prev) => [...new Set([...prev, ...(res.data.notices || [])])]);
      completed = true;
      if (res.data.illustration_pending) await drawIllustrations(res.data.chapter?.id);
    } catch (err) {
      setFailure({ ...normalizeNovelError(err, { operation: "finish" }), chapterId });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
    return completed;
  };

  // One chapter, start to finish: opening, finish, then its plates.
  const handleContinue = async (direction, exclusionsForAttempt = exclusions) => {
    const plainDirection = typeof direction === "string" ? direction : "";
    const opened = await openChapter(
      {
        mode: "continue",
        novel_id: novelId,
        direction: plainDirection,
        exclusions: exclusionsForAttempt,
      },
      `Writing chapter ${nextChapterNumber}`,
    );
    if (!opened) {
      setFailure((prev) => (prev ? { ...prev, direction: plainDirection } : prev));
      return;
    }
    if (opened.needs_finish && opened.chapter?.id) {
      await finishChapter(opened.chapter.id, opened.chapter?.chapter_number || nextChapterNumber);
    }
  };

  // Rewrite only the chapter being read — the rest of the novel is untouched.
  const handleRedoChapter = async (exclusionsForAttempt = exclusions) => {
    if (!current) return;
    const number = current.chapter_number;
    const opened = await openChapter(
      {
        mode: "redo",
        novel_id: novelId,
        chapter_id: current.id,
        exclusions: exclusionsForAttempt,
      },
      `Rewriting chapter ${number}`,
    );
    if (!opened) return;
    if (opened.needs_finish && opened.chapter?.id) {
      await finishChapter(opened.chapter.id, number);
    }
  };

  // A chapter written from the library arrives here with its finish still to do.
  useEffect(() => {
    const pendingFinish = location.state?.finishChapterId;
    if (pendingFinish) finishChapter(pendingFinish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.finishChapterId]);

  // A chapter written from the library arrives here with its plates still to draw.
  useEffect(() => {
    const pending = location.state?.illustrationChapterId;
    if (!pending) return;
    setBusy(true);
    drawIllustrations(pending).finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.illustrationChapterId]);

  // Delete only this chapter and its illustrations, then keep the numbering coherent.
  const handleDeleteChapter = async () => {
    if (!current) return;
    const target = current;
    setBusy(true);
    setBusyLabel(`Removing chapter ${target.chapter_number}`);
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

  const retry = () => {
    if (failure?.operation === "finish") {
      finishChapter(failure.chapterId || current?.id, current?.chapter_number);
      return;
    }
    if (failure?.operation === "redo") {
      handleRedoChapter(exclusions);
      return;
    }
    handleContinue(failure?.direction || "", exclusions);
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

            {incomplete && (
              <div className="mb-7 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  This chapter is only partly written. What you read below is its opening, saved as it was
                  written; the rest has not been written yet.
                </p>
                <button
                  onClick={() => finishChapter(current.id, current.chapter_number)}
                  disabled={busy}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Finish this chapter
                </button>
              </div>
            )}

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
              onRedo={() => handleRedoChapter()}
              onDelete={handleDeleteChapter}
              onIllustrate={() => {
                setBusy(true);
                drawIllustrations(current.id).finally(() => setBusy(false));
              }}
              disabled={busy || incomplete}
              error={actionError}
            />

            {failure && (
              <NovelGenerationFailure
                failure={failure}
                exclusions={exclusions}
                onExclude={(value) => setExclusions((prev) => (prev.includes(value) ? prev : [...prev, value]))}
                onRemoveExclusion={(value) => setExclusions((prev) => prev.filter((v) => v !== value))}
                onRetry={retry}
                busy={busy}
                onDismiss={() => setFailure(null)}
                retryLabel={
                  failure.operation === "redo"
                    ? "Rewrite chapter"
                    : failure.operation === "finish"
                      ? "Finish this chapter"
                      : `Write chapter ${nextChapterNumber}`
                }
              />
            )}

            {notices.length > 0 && (
              <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-3 space-y-1">
                {notices.map((notice) => (
                  <p key={notice} className="text-[11px] leading-relaxed text-muted-foreground">{notice}</p>
                ))}
              </div>
            )}

            {isLast && !incomplete && (
              <ContinueNovelPanel
                nextChapterNumber={nextChapterNumber}
                onGenerate={handleContinue}
                busy={busy}
              />
            )}
          </>
        )}
      </article>

      <NovelGeneratingOverlay open={busy} label={busyLabel || `Writing chapter ${nextChapterNumber}`} />
    </div>
  );
}