import { base44 } from '@/api/base44Client';

/**
 * NOVEL DELETION BOUNDARY
 *
 * Deleting a novel removes only what a novel owns:
 *   - the Novel record itself
 *   - the NovelChapter records belonging to that novel
 *   - the illustrations and illustration specs stored on those chapters
 *   - the chapter titles, summaries, directions and writing briefs of those chapters
 *
 * It never removes anything else, and in particular it never removes a character:
 * not the character whose profile the novel appears on, and not anyone written into
 * it. Deleting a novel is not permission to delete the character it was written
 * about, whatever that character's Test Character toggle says. Characters,
 * memories, life journals, family and established relationships, conversations,
 * messages, story events, residences and avatars are outside this boundary and are
 * untouched by every function below.
 */
export async function deleteNovelRecords(novelId) {
  if (!novelId) throw new Error('A novel id is required to delete a novel.');
  const chapters = await base44.entities.NovelChapter.filter({ novel_id: novelId }, null, 500);
  if (chapters.length) {
    // Scoped by novel_id: only this novel's chapters can ever match.
    await base44.entities.NovelChapter.deleteMany({ novel_id: novelId });
  }
  await base44.entities.Novel.delete(novelId);
  return chapters.length;
}

/**
 * Deleting one chapter removes only that chapter record, with its illustrations and
 * specs. The novel it belongs to, and every other record, is left as it is.
 */
export async function deleteNovelChapterRecords(chapterId) {
  if (!chapterId) throw new Error('A chapter id is required to delete a chapter.');
  await base44.entities.NovelChapter.delete(chapterId);
}