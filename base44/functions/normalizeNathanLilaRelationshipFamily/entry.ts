import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * normalizeNathanLilaRelationshipFamily
 *
 * Nathan → Lila: "partner" (romantic_level=100)
 * Lila  → Nathan: "spouse"  (romantic_level=70)
 *
 * These are the same bilateral class. This function:
 *  1. Confirms both real Character.id links are intact (no repair needed there)
 *  2. Normalizes both to relationship_family = "spouse_partner" via a canonical_relationship_family field
 *  3. Writes ONLY fictional_relationships — no Memory, no last_interaction_summary, no score changes
 *  4. Proves both sides after write
 */

const SPOUSE_PARTNER_FAMILY = new Set([
  'spouse', 'husband', 'wife', 'married', 'married_partner',
  'life_partner', 'partner', 'domestic_partner',
]);

function normalizeRelationshipType(type) {
  if (!type) return null;
  const t = type.trim().toLowerCase();
  if (SPOUSE_PARTNER_FAMILY.has(t)) return 'spouse_partner';
  return t;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    // ── Find Nathan and Lila — wide search, no status/type filter ──────────────
    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, null, 300);

    const nathanChar = allChars.find(c => c.name?.toLowerCase().includes('nathan parker') || c.name?.toLowerCase() === 'nathan parker') ||
                       allChars.find(c => c.name?.toLowerCase().includes('nathan'));
    const lilaChar   = allChars.find(c => c.name?.toLowerCase().includes('lila green') || c.name?.toLowerCase() === 'lila green') ||
                       allChars.find(c => c.name?.toLowerCase().includes('lila'));

    if (!nathanChar || !lilaChar) {
      return Response.json({
        error: 'Could not find Nathan or Lila',
        nathan_found: !!nathanChar,
        lila_found: !!lilaChar,
        all_names: allChars.map(c => c.name),
      }, { status: 404 });
    }

    // ── Read current relationship entries ───────────────────────────────────────
    const nathanRels = nathanChar.fictional_relationships || [];
    const lilaRels   = lilaChar.fictional_relationships || [];

    const nathanToLila = nathanRels.find(r => r.related_character_id === lilaChar.id);
    const lilaToNathan = lilaRels.find(r => r.related_character_id === nathanChar.id);

    const before = {
      nathan_to_lila: nathanToLila
        ? { related_character_id: nathanToLila.related_character_id, relationship_type: nathanToLila.relationship_type, canonical_relationship_family: nathanToLila.canonical_relationship_family || null }
        : null,
      lila_to_nathan: lilaToNathan
        ? { related_character_id: lilaToNathan.related_character_id, relationship_type: lilaToNathan.relationship_type, canonical_relationship_family: lilaToNathan.canonical_relationship_family || null }
        : null,
    };

    if (!nathanToLila || !lilaToNathan) {
      return Response.json({
        error: 'ID links not found — run diagnoseBilateralSpouseRelationship first',
        before,
      }, { status: 400 });
    }

    // ── Determine canonical family ──────────────────────────────────────────────
    const nathanFamily = normalizeRelationshipType(nathanToLila.relationship_type);
    const lilaFamily   = normalizeRelationshipType(lilaToNathan.relationship_type);
    const canonicalFamily = 'spouse_partner'; // both resolve here

    const nathanAlreadyNormalized = nathanToLila.canonical_relationship_family === canonicalFamily;
    const lilaAlreadyNormalized   = lilaToNathan.canonical_relationship_family === canonicalFamily;

    if (nathanAlreadyNormalized && lilaAlreadyNormalized) {
      return Response.json({
        status: 'ALREADY_NORMALIZED',
        before,
        message: 'Both entries already have canonical_relationship_family=spouse_partner. No changes needed.',
      });
    }

    if (dryRun) {
      return Response.json({
        status: 'DRY_RUN',
        before,
        would_set: {
          nathan_to_lila_canonical_family: canonicalFamily,
          lila_to_nathan_canonical_family: canonicalFamily,
        },
        nathan_raw_type: nathanToLila.relationship_type,
        lila_raw_type: lilaToNathan.relationship_type,
        normalized_nathan: nathanFamily,
        normalized_lila: lilaFamily,
        compatible: nathanFamily === lilaFamily,
        no_memory_write: true,
        no_score_change: true,
        no_fake_interaction: true,
      });
    }

    // ── Apply: stamp canonical_relationship_family on both entries ──────────────
    // ONLY adds/updates canonical_relationship_family field.
    // Does NOT change: relationship_type (display label preserved), romantic_level,
    // friendship_level, trust_level, last_interaction_summary, or any other field.

    const updatedNathanRels = nathanRels.map(r =>
      r.related_character_id === lilaChar.id
        ? { ...r, canonical_relationship_family: canonicalFamily }
        : r
    );
    const updatedLilaRels = lilaRels.map(r =>
      r.related_character_id === nathanChar.id
        ? { ...r, canonical_relationship_family: canonicalFamily }
        : r
    );

    await Promise.all([
      base44.entities.Character.update(nathanChar.id, { fictional_relationships: updatedNathanRels }),
      base44.entities.Character.update(lilaChar.id,   { fictional_relationships: updatedLilaRels }),
    ]);

    // ── Verify post-write ───────────────────────────────────────────────────────
    const [nathanFresh, lilaFresh] = await Promise.all([
      base44.entities.Character.filter({ id: nathanChar.id }).then(r => r[0]),
      base44.entities.Character.filter({ id: lilaChar.id }).then(r => r[0]),
    ]);

    const nathanFreshEntry = (nathanFresh?.fictional_relationships || []).find(r => r.related_character_id === lilaChar.id);
    const lilaFreshEntry   = (lilaFresh?.fictional_relationships || []).find(r => r.related_character_id === nathanChar.id);

    return Response.json({
      status: 'NORMALIZED',
      proof: {
        nathan_to_lila_related_character_id:     nathanFreshEntry?.related_character_id,
        nathan_to_lila_related_character_id_ok:  nathanFreshEntry?.related_character_id === lilaChar.id,
        nathan_to_lila_display_label:            nathanFreshEntry?.relationship_type,
        nathan_to_lila_canonical_family:         nathanFreshEntry?.canonical_relationship_family,
        nathan_to_lila_family_ok:                nathanFreshEntry?.canonical_relationship_family === canonicalFamily,

        lila_to_nathan_related_character_id:     lilaFreshEntry?.related_character_id,
        lila_to_nathan_related_character_id_ok:  lilaFreshEntry?.related_character_id === nathanChar.id,
        lila_to_nathan_display_label:            lilaFreshEntry?.relationship_type,
        lila_to_nathan_canonical_family:         lilaFreshEntry?.canonical_relationship_family,
        lila_to_nathan_family_ok:                lilaFreshEntry?.canonical_relationship_family === canonicalFamily,

        both_linked_by_real_id:   nathanFreshEntry?.related_character_id === lilaChar.id && lilaFreshEntry?.related_character_id === nathanChar.id,
        both_in_spouse_family:    nathanFreshEntry?.canonical_relationship_family === canonicalFamily && lilaFreshEntry?.canonical_relationship_family === canonicalFamily,
        display_labels_preserved: true, // we never touched relationship_type
        no_memory_written:        true,
        no_last_interaction_summary: true,
        no_score_progression:     true,
        no_fake_interaction:      true,

        world_phone_note: 'Both appear in each other\'s World Phone via characterContactsResolver which now includes relationship_family on every contact entry.',
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack?.substring(0, 500) }, { status: 500 });
  }
});