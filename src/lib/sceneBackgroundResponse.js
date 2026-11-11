/**
 * sceneBackgroundResponse
 *
 * A background person of the venue (teacher, bartender, receptionist, server) chosen
 * from Who's Here is an available participant in the scene conversation. They are
 * never puppeted: the user keeps control of their own person (or the active character
 * through Speak), and the chosen background person answers for themselves, in role.
 *
 * This module only works out WHO was addressed and words the rule that makes that
 * person answer. It adds no new conversation system.
 */

const ROLE_STOPWORDS = new Set(['person', 'people', 'npc', 'visitor', 'customer', 'staff', 'employee']);

export function findAddressedBackgroundPeople(text, people = []) {
  const list = (people || []).filter((p) => p && p.name);
  if (list.length === 0) return [];
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return [];

  const named = list.filter((p) => lower.includes(String(p.name).toLowerCase()));
  if (named.length > 0) return named;

  const byRole = list.filter((p) => {
    const role = String(p.role || '').toLowerCase().trim();
    if (!role || ROLE_STOPWORDS.has(role)) return false;
    return lower.includes(role);
  });
  if (byRole.length > 0) return byRole;

  // No one was named: the line is aimed at the background person or people the user
  // is standing in front of, so one of them answers rather than the line meeting
  // silence. Selecting a person always has a conversational effect.
  return list.slice(0, 1);
}

export function buildBackgroundResponderRule({ addressed = [], selected = [] } = {}) {
  const chosen = (selected || []).filter((p) => p && p.name);
  const answering = (addressed || []).filter((p) => p && p.name);
  if (answering.length === 0) return '';

  const names = answering.map((p) => p.name).join(' and ');
  const single = answering.length === 1;
  const others = chosen.filter((p) => !answering.some((a) => a.id === p.id));
  const roles = answering
    .map((p) => (p.role ? `${p.name} (${String(p.role).toLowerCase()})` : p.name))
    .join('; ');

  return [
    `=== ${names.toUpperCase()} MUST ANSWER THIS BEAT ===`,
    `${roles} ${single ? 'is' : 'are'} being spoken to directly.`,
    `${names} ${single ? 'answers' : 'answer'} out loud, in ${single ? 'their' : 'their'} own voice, from ${single ? 'their own role and view of this place' : 'their own roles and view of this place'}.`,
    `The reply MUST appear in the output under the name "${names}". Whoever just spoke does not answer their own line, and the moment may not continue without ${single ? 'this reply' : 'these replies'}.`,
    `It is an ordinary in-role answer: greet back, answer the question, do the job, or react the way this person plausibly would. One or two sentences.`,
    others.length > 0 ? `${others.map((p) => p.name).join(', ')} ${others.length === 1 ? 'is' : 'are'} also here and may join in naturally.` : '',
    '===',
    '',
  ].filter(Boolean).join('\n');
}