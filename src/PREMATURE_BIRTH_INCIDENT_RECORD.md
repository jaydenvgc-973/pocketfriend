# Incident record — premature birth (Zoe Rivers)

**Status:** recorded, not corrected. Per the owner's explicit decision, no family data was altered.
**Authoritative timezone for every timestamp below:** America/New_York (Eastern). Infrastructure timestamps are converted before use.

## What exists

| Record | Value |
|---|---|
| Zoe Rivers | `character_type: npc_family_member`, `age: 0`, `birthday: 2026-11-05`, created **Nov 5, 12:20 AM Eastern** |
| Zoe Rivers family list | `Mace: father` |
| Mace | lists `Zoe Rivers: daughter` |
| Demi Rivers | lists `Zoe Rivers: daughter`; `current_life_event`: `Pregnant — began 2026-06-01; due 2027-03-08` |

Demi's pregnancy is real and ongoing. Her due date is March 8, 2027, roughly four months after the child's recorded birth date. The world therefore holds a child born before term **and** a pregnancy that continues after the birth. Both facts are persisted simultaneously. This is an impossible state.

## Which system permitted it

`src/hooks/useApprovalEvents.jsx`

1. `BIRTH_PATTERNS` (around line 188) treats any conversation text matching word patterns such as `gave birth` as a birth event.
2. That match raises the birth approval prompt (around line 323) with `type: 'birth'`.
3. On approval (around line 489) the flow creates a child Character, appends the child to the parent's `family_members`, and writes a `LifeEvent` titled "<name> was born".

Nothing on that path reads the stored pregnancy term:

- no check that a pregnancy is recorded at all,
- no comparison of today against the recorded due date,
- no clearing of the pregnancy marker once a birth is committed.

So a figure of speech, a plan, or a story beat is enough to produce a live child, and the pregnancy keeps running afterward.

## Why the pregnancy marker survived

The narrative writers that touch `current_life_event` (narrative submission, life evolution, autonomous actions, scheduled events) were changed this session to preserve an active pregnancy instead of overwriting it. That protection is what keeps Demi's pregnancy intact — it is also why the contradiction is now visible rather than silently erased. Those guards did not create the birth and do not resolve it.

## Decision of record

The owner has directed that the child record and both parent links remain exactly as they are. Erasing a created person would cause further damage; the contradiction stands as evidence of the failure.

## Not yet corrected

Birth creation still depends on detected text rather than the stored pregnancy reaching term. Until that path is gated on the pregnancy record's due date, another premature child can be created the same way.

## Nothing changed

No character, family, memory, or life-event record was modified, merged, or deleted as part of this record.