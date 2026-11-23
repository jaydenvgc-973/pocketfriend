/**
 * courtroomActions.js
 *
 * Courtroom authority for the Courthouse activity strip. It adds no courtroom system:
 * it only reads the roles the pre-scene setup already assigned (established characters
 * and the court's own temporary people alike) and says who is allowed to perform each
 * judicial activity, and who the activity is directed at.
 *
 * The activity itself still runs through the existing Scenes pathways — the bracketed
 * action line and the narrative engine — so nothing here narrates or records anything.
 */

const ATTORNEY_ROLES = ['prosecutor', 'defense_attorney', 'plaintiff_attorney'];

/**
 * Who may perform each courtroom activity, and who it is directed at.
 * roles        — the role keys allowed to act (COURT_ROLES keys)
 * subjectRoles — the role keys the action is directed at, when it concerns someone
 */
const COURT_ACTION_AUTHORITY = {
  // Judicial authority belongs to the assigned judge alone.
  court_open:            { roles: ['judge'] },
  court_ruling:          { roles: ['judge'] },
  court_dismiss:         { roles: ['judge'] },
  court_bail:            { roles: ['judge'] },
  court_civil_dispute:   { roles: ['judge'] },
  gov_sentence:          { roles: ['judge'], subjectRoles: ['defendant'] },
  gov_contempt:          { roles: ['judge'] },

  // Attorneys argue, question and object.
  court_opening:         { roles: ATTORNEY_ROLES },
  court_objection:       { roles: ATTORNEY_ROLES },
  court_present_evidence:{ roles: ATTORNEY_ROLES },
  court_call_witness:    { roles: ATTORNEY_ROLES, subjectRoles: ['witnesses'] },
  court_question_witness:{ roles: ATTORNEY_ROLES, subjectRoles: ['witnesses'] },
  court_cross_examine:   { roles: ATTORNEY_ROLES, subjectRoles: ['witnesses'] },

  // Witnesses testify; a defendant answers for themselves; jurors reach the findings.
  court_testimony:       { roles: ['witnesses'] },
  court_plea:            { roles: ['defendant'] },
  court_deliberate:      { roles: ['jurors'] },
  court_verdict:         { roles: ['jurors'] },
};

export function getCourtActionAuthority(actionId) {
  return COURT_ACTION_AUTHORITY[actionId] || null;
}

/**
 * Every person holding a courtroom role in this proceeding — the established characters
 * the setup chose, and the court's own temporary people who filled the roles nobody was
 * assigned. A temporary person is a full participant: they have an id, a name and their
 * role for the whole case.
 */
export function courtPeople(courtCase) {
  if (!courtCase) return [];
  const temps = Array.isArray(courtCase.temp_npcs) ? courtCase.temp_npcs : [];
  const seen = new Set();
  return (courtCase.assignments || [])
    .map((a) => {
      const temp = a.temporary
        ? temps.find((t) => t.role === a.roleLabel) || temps.find((t) => t.name === a.name)
        : null;
      return {
        id: a.characterId || temp?.id || null,
        name: a.name,
        roleKey: a.roleKey,
        roleLabel: a.roleLabel,
        isTemporary: !!a.temporary,
      };
    })
    .filter((p) => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
}

/** The people authorized to perform this activity in this proceeding. */
export function courtActors(courtCase, actionId) {
  const authority = getCourtActionAuthority(actionId);
  if (!authority) return [];
  return courtPeople(courtCase).filter((p) => authority.roles.includes(p.roleKey));
}

/** The people this activity is directed at, when it concerns someone else. */
export function courtSubjects(courtCase, actionId) {
  const authority = getCourtActionAuthority(actionId);
  if (!authority?.subjectRoles) return [];
  return courtPeople(courtCase).filter((p) => authority.subjectRoles.includes(p.roleKey));
}

/**
 * The attributed action line handed to the existing narrative engine. It names the actor
 * by role and, when the action concerns someone, the person it concerns — so the narrative
 * attributes the action correctly instead of letting a witness rule or a defendant
 * sentence themselves.
 */
export function courtActionLine(action, actor, subject = null) {
  const who = `${actor.name} (${actor.roleLabel})`;
  const at = subject ? ` — directed at ${subject.name} (${subject.roleLabel})` : "";
  return `[${action.emoji} ${action.label} — ${who}${at}]`;
}