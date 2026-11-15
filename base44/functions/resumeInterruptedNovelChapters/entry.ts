import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// NOVEL GENERATION RECOVERY SWEEP
//
// Every novel stage runs in its own bounded request: the opening of a chapter is
// saved first, then the finishing request completes the prose, then a third request
// draws the plates. The platform cuts a request that runs past its limit, and when
// that happens the process is killed before it can write anything at all. The
// chapter then keeps writing_state = 'writing', and because each stage is only ever
// started by a write to the chapter — a write a killed request never makes — nothing
// restarts it. Before this sweep, such a chapter waited for a reader who happened to
// open the Novel page and press "Finish this chapter".
//
// This is that restart, on the server. It looks only for chapters whose stage is no
// longer running — nothing written to them for far longer than any stage request can
// last — and hands each one to the existing continuation, which performs just the
// stage the record still needs:
//
//   writing_state = 'writing'                       → finish the prose
//   complete, plate notes recorded, no plates drawn  → draw the plates
//   anything else                                    → nothing; it is never touched
//
// The chapter is the only record this writes, and only its own attempt bookkeeping
// (how many restarts, and when the last one began). Attempts are capped, so a stage
// that keeps failing is tried a few times and then left to the reader's own Finish
// action instead of being retried forever. Prose is never rewritten from scratch: the
// finish continues from the opening already saved on the chapter.
//
// Invoked by the "Novel Recovery Sweep" workflow on a schedule, with no user session,
// exactly like advanceNovelGeneration. It performs no generation of its own and can
// be called repeatedly: a stage that is already done, or still running, is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

// A stage request is cut long before this; anything quieter than this cannot still
// be running.
const ABANDONED_MS = 10 * 60 * 1000;
const MAX_AUTOMATIC_ATTEMPTS = 3;
// Stay well inside this function's own request limit: one stage can take ~100s.
const PER_RUN = 2;

const asArray = (value) => (Array.isArray(value) ? value : (value?.items || []));
const timeOf = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const sr = base44.asServiceRole;
    const now = Date.now();
    const stamp = new Date(now).toISOString();

    // Reading across every account is the point: an interrupted stage belongs to a
    // chapter no one is looking at. Nothing is read that the sweep does not classify.
    const [unfinished, finished] = await Promise.all([
      sr.entities.NovelChapter.filter({ writing_state: 'writing' }, 'updated_date', 40).catch(() => []),
      sr.entities.NovelChapter.filter({ writing_state: 'complete' }, '-updated_date', 40).catch(() => []),
    ]);

    const eligible = [];
    asArray(unfinished).forEach((chapter) => {
      eligible.push({ chapter, stage: 'finish' });
    });
    asArray(finished).forEach((chapter) => {
      const plates = Array.isArray(chapter.illustrations) ? chapter.illustrations : [];
      const specs = Array.isArray(chapter.illustration_specs) ? chapter.illustration_specs : [];
      // Written, its plates chosen, and nothing drawn: the drawing stage was interrupted.
      if (specs.length && !plates.length) eligible.push({ chapter, stage: 'illustrations' });
    });

    const waiting = eligible
      .map((entry) => {
        const last = Math.max(timeOf(entry.chapter.updated_date), timeOf(entry.chapter.writing_last_attempt_at));
        return { ...entry, last, attempts: Number(entry.chapter.writing_attempts) || 0, quietFor: now - last };
      })
      // Still running, or restarted moments ago: not ours to touch.
      .filter((entry) => entry.quietFor >= ABANDONED_MS && entry.attempts < MAX_AUTOMATIC_ATTEMPTS)
      .sort((a, b) => a.last - b.last)
      .slice(0, PER_RUN);

    const report = waiting.map((entry) => ({
      chapter_id: entry.chapter.id,
      novel_id: entry.chapter.novel_id,
      chapter_number: entry.chapter.chapter_number,
      stage: entry.stage,
      attempt: entry.attempts + 1,
      quiet_minutes: Math.round(entry.quietFor / 60000),
    }));

    if (dryRun) {
      return Response.json({ dry_run: true, abandoned_before_restart: report });
    }

    const resumed = [];
    for (const entry of waiting) {
      // The attempt is recorded before the stage runs, so a restart that is itself
      // killed still counts as an attempt and can never loop unrecorded.
      await sr.entities.NovelChapter.update(entry.chapter.id, {
        writing_attempts: entry.attempts + 1,
        writing_last_attempt_at: stamp,
      }).catch(() => null);

      const res = await sr.functions
        .invoke('advanceNovelGeneration', { chapter_id: entry.chapter.id, resume: true })
        .catch((error) => ({ data: { error: String(error?.message || 'continuation request failed') } }));
      const data = res?.data || res;
      resumed.push({
        chapter_id: entry.chapter.id,
        chapter_number: entry.chapter.chapter_number,
        stage: entry.stage,
        ok: !data?.error,
        result_stage: data?.stage || null,
        error: data?.error || null,
      });
      console.log(`[resumeInterruptedNovelChapters] ${entry.chapter.id} (chapter ${entry.chapter.chapter_number}, ${entry.stage}): ${data?.error ? `FAILED — ${data.error}` : 'restarted'}`);
    }

    return Response.json({ checked: eligible.length, restarted: resumed });
  } catch (error) {
    return Response.json({ error: error?.message || 'sweep failed' }, { status: 500 });
  }
});