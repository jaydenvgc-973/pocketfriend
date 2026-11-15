import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// NOVEL GENERATION CONTINUATION
//
// Called by the "Novel Generation Continuation" workflow whenever a NovelChapter is
// written. It reads that chapter and performs the stage the chapter is waiting on:
//
//   1. writing_state = 'writing'  → finish the chapter's prose (generateNovelChapter)
//   2. complete, notes but no plates → draw the illustrations (generateNovelIllustrations)
//   3. anything else → nothing to do
//
// This is what makes a chapter survive the reader leaving: the stage that used to be
// started by the Novel page after its own request returned is now started here, on
// the server, by the write itself. The chapter is re-read every time, so a stage is
// only ever performed when the record still says it is needed — a stage that has
// already run is a no-op, never a second generation.
//
// READ-ONLY on every Pocketfriend record. The only writes are the Novel and
// NovelChapter records the two stage functions already own.
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Workflow execution context: no user session, trusted server-side caller — the
  // same pattern as the app's other entity-triggered functions. Every read is by ID.
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const chapterId = String(body.chapter_id || body.event?.entity_id || '').trim();
  if (!chapterId) return Response.json({ error: 'chapter_id is required' }, { status: 400 });

  const sr = base44.asServiceRole;
  const chapter = await sr.entities.NovelChapter.get(chapterId).catch(() => null);
  if (!chapter) return Response.json({ stage: 'none', reason: 'chapter_not_found' });

  const specs = Array.isArray(chapter.illustration_specs) ? chapter.illustration_specs : [];
  const plates = Array.isArray(chapter.illustrations) ? chapter.illustrations : [];

  // ── STAGE 1: THE PROSE IS ONLY PARTLY WRITTEN ──────────────────────────────
  // The opening is saved and the finishing request has not completed. Finishing
  // continues from what is already on the record; it never restarts the chapter.
  if (chapter.writing_state === 'writing') {
    // A finishing request that is running, or that has just failed and been handed
    // back, must not be started a second time by a second trigger: two finishes at
    // once would cost two generations and race over one chapter. Only the recovery
    // sweep may restart it, and it says so explicitly with resume: true.
    const lastAttempt = Date.parse(chapter.writing_last_attempt_at || '') || 0;
    if (!body.resume && Date.now() - lastAttempt < 5 * 60 * 1000) {
      console.log(`[advanceNovelGeneration] ${chapter.id}: finish skipped — attempt ${new Date(lastAttempt).toISOString()} is recent`);
      return Response.json({ stage: 'finish', ok: false, skipped: 'recent_attempt' });
    }
    const res = await sr.functions
      .invoke('generateNovelChapter', {
        mode: 'continue',
        part: 'finish',
        novel_id: chapter.novel_id,
        chapter_id: chapter.id,
      })
      .catch((error) => ({ data: { error: String(error?.message || 'finishing request failed') } }));
    const data = res?.data || res;
    const ok = !data?.error;
    console.log(`[advanceNovelGeneration] ${chapter.id}: finish ${ok ? 'complete' : `FAILED — ${data?.error}`}`);
    return Response.json({ stage: 'finish', ok, error: data?.error || null });
  }

  // ── STAGE 2: THE CHAPTER IS WRITTEN, ITS PLATES ARE NOT ────────────────────
  // The notes stay on the chapter until the plates exist, so this stage is only
  // taken when the record genuinely has nothing drawn yet.
  if (specs.length && !plates.length) {
    const res = await sr.functions
      .invoke('generateNovelIllustrations', {
        novel_id: chapter.novel_id,
        chapter_id: chapter.id,
      })
      .catch((error) => ({ data: { error: String(error?.message || 'illustration request failed') } }));
    const data = res?.data || res;
    const ok = !data?.error;
    console.log(`[advanceNovelGeneration] ${chapter.id}: illustrations ${ok ? 'complete' : `FAILED — ${data?.error}`}`);
    return Response.json({ stage: 'illustrations', ok, error: data?.error || null });
  }

  return Response.json({ stage: 'none' });
});