import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// NOVEL AWARENESS BLOCK
//
// Delegate of buildCanonicalCharacterContext, in the same pattern as
// buildWorldPhoneAwarenessBlock / buildCommitmentAwarenessBlock.
//
// A novel sits on the central character's own profile, so a completed chapter of it
// is that character's own lived experience — never a book they read. This block says
// exactly that, so the character speaks about those experiences as their own.
//
// STRICT BOUNDARIES:
//  • Only novels whose central character is THIS character are read. Nothing from
//    another character's novel reaches this character, even if they appear in it.
//  • Only completed chapters count. A chapter still being written, a failed attempt,
//    and a superseded redo never supply anything.
//  • One chapter — the one the exchange touches, otherwise the latest completed one.
//    The whole novel is never loaded into a conversation.
//  • READ-ONLY. Nothing is written to Memory, the Life Journal, relationships, chat,
//    locations or any other record; the completed chapter itself stays the source.
//  • The block tells the character that recorded facts outrank this account.
// ─────────────────────────────────────────────────────────────────────────────

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const wordsOf = (value) => new Set(
  String(value || '').toLowerCase().split(/[^a-z0-9']+/).filter((word) => word.length > 3)
);

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const characterId = String(body.characterId || '').trim();
  if (!characterId) return Response.json({ error: 'characterId is required' }, { status: 400 });

  const sr = base44.asServiceRole;
  const spokenWords = wordsOf((Array.isArray(body.recentText) ? body.recentText : []).join(' '));

  const novelRows = await sr.entities.Novel
    .filter({ character_id: characterId }, '-created_date', 8).catch(() => []);
  const novels = (Array.isArray(novelRows) ? novelRows : (novelRows?.items || []))
    .filter((novel) => novel && novel.id);
  if (!novels.length) return Response.json({ awarenessBlock: '', completedChapters: 0 });

  const novelIds = novels.map((novel) => novel.id);
  const chapterRows = await sr.entities.NovelChapter
    .filter({ novel_id: { $in: novelIds } }, '-chapter_number', 40).catch(() => []);
  // Only chapters that are actually finished qualify. A chapter still being written is
  // explicitly marked 'writing'; a chapter written before that field existed has no
  // state at all and is complete — a missing newer field never disqualifies a record.
  const completed = (Array.isArray(chapterRows) ? chapterRows : (chapterRows?.items || []))
    .filter((chapter) => chapter
      && chapter.writing_state !== 'writing'
      && String(chapter.content || '').trim().length > 0);
  if (!completed.length) {
    return Response.json({ awarenessBlock: '', completedChapters: 0, novels: novels.length });
  }

  // Relevance: what the chapter is about (its title, the premise it was written from,
  // its summary) counts double, and a word the exchange used that appears in the
  // chapter's own prose counts once — so the chapter actually being discussed wins,
  // not merely one that shares a subject heading with it.
  const spokenList = [...spokenWords].slice(0, 12);
  const ranked = completed.map((chapter) => {
    const own = wordsOf(`${chapter.title || ''} ${chapter.direction || ''} ${chapter.summary || ''}`);
    let score = 0;
    own.forEach((word) => { if (spokenWords.has(word)) score += 2; });
    const prose = String(chapter.content || '').toLowerCase();
    spokenList.forEach((word) => { if (prose.includes(word)) score += 1; });
    return { chapter, score };
  }).sort((a, b) => (b.score - a.score) || ((b.chapter.chapter_number || 0) - (a.chapter.chapter_number || 0)));

  // One chapter: the one this exchange is about, or the latest completed chapter.
  const chosen = ranked[0].chapter;
  const excerpt = String(chosen.content || '').replace(/\s+/g, ' ').trim().slice(0, 2400);
  const label = [
    chosen.title ? ` — ${chosen.title}` : '',
    chosen.chapter_number ? ` (chapter ${chosen.chapter_number})` : '',
  ].join('');

  const awarenessBlock = `

════════════════════════════════════
YOUR OWN LIFE — WHAT YOU LIVED
════════════════════════════════════
The following is your own experience, set down from your own records. It is yours: you lived it, you remember it, and you speak about it the way you speak about anything else that ever happened to you.
NEVER describe it as a book, a novel, a story, a chapter, writing, fiction, generated content, or something you read, were told, or were written into. You did not learn these things — you lived them.
It fills in the details your history leaves open: what you were doing, who you were with, how it felt. It never changes what your records already establish — your age or date of birth, where you live, your family, your work, your relationships, or any other recorded fact. Where this account and a recorded fact disagree, the record wins and you follow the record.
This is your own private experience. Another person does not know these details merely because you do: you may choose to tell them, but never assume they already know, and your own private thoughts stay private unless you share them.
Keep it in proportion. It is your life, available when it is relevant — not a subject to announce.

WHAT YOU LIVED${label}:
${excerpt}
════════════════════════════════════`;

  return Response.json({
    awarenessBlock,
    completedChapters: completed.length,
    novels: novels.length,
    chapterNumber: chosen.chapter_number || null,
    matchedConversation: ranked[0].score > 0,
    chapterUpdatedAt: chosen.updated_date || null,
    // Kept so callers can tell how current the chapter is without re-reading it.
    fresh: !!chosen.updated_date && (Date.now() - new Date(chosen.updated_date).getTime()) < TWENTY_FOUR_HOURS,
  });
});