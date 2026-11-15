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
import ChapterCopyDialog from "@/components/novels/ChapterCopyDialog";
import useLongPress from "@/hooks/useLongPress";
import RegenerateImageModal from "@/components/chat/RegenerateImageModal";
import NovelGenerationFailure from "@/components/novels/NovelGenerationFailure";
import { normalizeNovelError } from "@/lib/novelGenerationError";
import { deleteNovelChapterRecords } from "@/lib/novelDeletion";

/** The moment a plate sits in, used when a plate has no stored scene note. */
function plateScene(chapter, plate) {
  const paragraphs = (chapter?.content || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const index = Math.min(paragraphs.length, Math.max(1, Number(plate?.after_paragraph) || 1)) - 1;
  const paragraph = paragraphs[index] || "";
  const caption = plate?.caption ? `Moment: ${plate.caption}` : "";
  return [paragraph, caption].filter(Boolean).join("\n");
}

export default function NovelReader() {
  const { novelId } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [activeNumber, setActiveNumber] = useState(null);
  const [showToc, setShowToc] = useState(false);
  // The chapter title's press-and-hold is deliberately undisclosed: no control, label or
  // hint anywhere in the reader. Holding it asks whether to copy the chapter's prose.
  const [copyOpen, setCopyOpen] = useState(false);
  const titlePress = useLongPress(() => setCopyOpen(true));
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [failure, setFailure] = useState(null);
  const [exclusions, setExclusions] = useState([]);
  // The premise confirmed in the Redo box, kept so a retry rewrites from the same one.
  const [redoPremise, setRedoPremise] = useState("");
  // Notices carried over from an earlier request, e.g. a plate that failed to render.
  const [notices, setNotices] = useState(location.state?.notices || []);
  // Delete is not a generation attempt: its failures stay a plain line of text.
  const [actionError, setActionError] = useState(null);
  // Why Regenerate on ONE plate: which plate, and what happened to it.
  const [regenIndex, setRegenIndex] = useState(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState(null);

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
    // The chapter is finished and illustrated on the server, so this page never drives
    // it. While one is still being written the reader keeps the record in step; as soon
    // as nothing is in progress it stops asking.
    refetchInterval: (query) => (
      (query.state.data || []).some((chapter) => chapter.writing_state === "writing") ? 6000 : false
    ),
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

  // ── WHY REGENERATE, ONE PLATE ────────────────────────────────────────────
  // The plate's own note is the scene description; a chapter drawn before notes were
  // kept falls back to the paragraph the plate follows. The chapter's prose, title and
  // every other plate stay exactly as they are.
  const orderedPlates = [...(current?.illustrations || [])]
    .sort((a, b) => (Number(a.after_paragraph) || 0) - (Number(b.after_paragraph) || 0));
  const regenPlate = regenIndex != null ? orderedPlates[regenIndex] : null;
  const regenSpec = regenIndex != null ? (current?.illustration_specs || [])[regenIndex] || null : null;
  const regenPrompt = regenSpec?.scene || (regenPlate ? plateScene(current, regenPlate) : "");
  const regenContext = {
    character_id: (regenSpec?.person_ids || [])[0] || null,
    character_name: null,
    subjects: (regenSpec?.person_ids || []).map((id) => ({ subject_type: "character", subject_id: id })),
    location_id: regenSpec?.location_id || null,
    zone_name: regenSpec?.zone_name || null,
    location_name: regenSpec?.location_label || null,
  };

  const handlePlateRegenerate = async (reasonId, customPrompt, locationId, zoneName, locationImages, locationName, subjectPayload) => {
    if (regenIndex == null || !current) return;
    setRegenBusy(true);
    setRegenError(null);
    try {
      const res = await base44.functions.invoke("generateNovelIllustrations", {
        novel_id: novelId,
        chapter_id: current.id,
        mode: "regenerate",
        illustration_index: regenIndex,
        reason: reasonId,
        custom_prompt: customPrompt || undefined,
        location_id: locationId || undefined,
        zone_name: zoneName || undefined,
        location_name: locationName || undefined,
        location_images: locationImages?.length ? locationImages : undefined,
        // A subject answer from the picker is authoritative; without one, the plate's
        // own recorded people decide who is in it.
        subject_picker_used: !!subjectPayload,
        intended_subject_ids: subjectPayload?.intendedSubjectIds?.length ? subjectPayload.intendedSubjectIds : undefined,
        include_user: subjectPayload?.includeUser === true,
        user_ref_images: subjectPayload?.userRefImages || undefined,
        user_name: subjectPayload?.userName || undefined,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      await refreshNovel();
      setRegenIndex(null);
    } catch (err) {
      setRegenError(err?.response?.data?.error || err?.message || "That illustration could not be redrawn. The plate you have is unchanged.");
    } finally {
      setRegenBusy(false);
    }
  };

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
      // The chapter's plates are drawn by the continuation workflow that this write
      // starts — the page does not start a second round of generation.
    } catch (err) {
      setFailure({ ...normalizeNovelError(err, { operation: "finish" }), chapterId });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
    return completed;
  };

  // A new chapter: only its opening is requested here. The finish and the plates are
  // performed by the server-side continuation the saved chapter starts, so the chapter
  // completes whether or not this page is still open.
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
    }
  };

  // Rewrite only the chapter being read — the rest of the novel is untouched. The
  // replacement is written from the premise the reader confirmed in the Redo box; the
  // chapter being replaced stays on the record until the new version is saved.
  const handleRedoChapter = async (premise, exclusionsForAttempt = exclusions) => {
    if (!current) return;
    const number = current.chapter_number;
    setRedoPremise(premise || "");
    const opened = await openChapter(
      {
        mode: "redo",
        novel_id: novelId,
        chapter_id: current.id,
        direction: premise || undefined,
        exclusions: exclusionsForAttempt,
      },
      `Rewriting chapter ${number}`,
    );
    if (!opened) return;
  };

  // A chapter's remaining stages are started by the write that saves its opening —
  // on the server, by the continuation, and restarted by the recovery sweep if that
  // request is cut off. The reader never starts them, so closing this page (or
  // leaving the app) cannot leave a chapter half-written.

  // Delete only this chapter and its illustrations, then keep the numbering coherent.
  const handleDeleteChapter = async () => {
    if (!current) return;
    const target = current;
    setBusy(true);
    setBusyLabel(`Removing chapter ${target.chapter_number}`);
    setActionError(null);
    try {
      // Chapter-scoped only: this chapter and its illustrations, never the novel's
      // character or any other record.
      await deleteNovelChapterRecords(target.id);
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
      // Retried with the premise that was confirmed for this rewrite.
      handleRedoChapter(redoPremise, exclusions);
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
              {/* Unchanged visually. Holding the title (touch or pointer) is the only way
                  in; a plain tap, scroll or text selection never opens it. */}
              <h2
                {...titlePress}
                style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                className="mt-1.5 text-lg font-semibold text-foreground font-serif"
              >
                {current.title}
              </h2>
            </div>

            {incomplete && (
              <div className="mb-7 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  This chapter is still being written. Its opening is saved below and the rest is being
                  finished for you now — you can leave this page or close the app and come back. If it has
                  not continued, finish it here.
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

            <NovelChapterText
              chapter={current}
              onWhyRegenerate={(index) => { setRegenError(null); setRegenIndex(index); }}
              regeneratingIndex={regenBusy ? regenIndex : null}
            />

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
              defaultPremise={current.direction || novel.premise || ""}
              onRedo={(premise) => handleRedoChapter(premise)}
              onDelete={handleDeleteChapter}
              onIllustrate={() => {
                setBusy(true);
                drawIllustrations(current.id).finally(() => setBusy(false));
              }}
              disabled={busy || incomplete}
              redoDisabled={busy}
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

      <ChapterCopyDialog
        chapter={current}
        open={copyOpen && !!current}
        onClose={() => setCopyOpen(false)}
      />

      <RegenerateImageModal
        isOpen={regenIndex != null}
        onClose={() => { setRegenIndex(null); setRegenError(null); }}
        onSelect={handlePlateRegenerate}
        isRegenerating={regenBusy}
        error={regenError}
        originalPrompt={regenPrompt}
        generationContext={regenContext}
      />
    </div>
  );
}