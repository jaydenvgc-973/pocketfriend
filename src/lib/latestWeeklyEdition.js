import { base44 } from '@/api/base44Client';

/**
 * An edition that actually contains something to read.
 * A "quiet week" edition (no headliner, no sections, no briefs) is still a real
 * record, but it must never stand in front of an edition that has stories.
 */
export function hasEditionContent(edition) {
  if (!edition) return false;
  return !!edition.headliner
    || (edition.sections || []).length > 0
    || (edition.around_town || []).length > 0;
}

/**
 * The edition a reader should see: the newest one that has content. Only when no
 * edition anywhere has content does the newest record win, so a genuinely quiet
 * week still reads as a quiet week instead of showing nothing.
 */
export async function fetchLatestWeeklyEdition() {
  const rows = await base44.entities.WeeklyPublication.list('-published_at', 20);
  const editions = rows || [];
  return editions.find(hasEditionContent) || editions[0] || null;
}