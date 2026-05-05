import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ensureUserVGCTowers (CORRECTED)
 *
 * CRITICAL RULE: Each user must have EXACTLY ONE personal VGC Towers instance.
 * 
 * Logic:
 * 1. Fetch the template VGC Towers from the original account (adobevgc@gmail.com)
 * 2. Check if current user already has a personal (non-shared) VGC Towers
 * 3. If they do, verify it has the correct template data. If blank, update it.
 * 4. If they don't, create one using the template.
 * 5. REMOVE any duplicates (multiple VGC Towers for same user)
 *
 * Returns: { vgc_towers_id, vgc_towers_name, created: bool, template_source: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // STEP 1: Fetch the authoritative template from adobevgc@gmail.com
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const templateResults = await base44.asServiceRole.entities.LocationReference.filter({
      owner_email: 'adobevgc@gmail.com',
      name: 'VGC Towers',
      scope: { $ne: 'shared' }
    });

    const templateVGC = templateResults[0];
    if (!templateVGC) {
      return Response.json({
        error: 'Template VGC Towers not found on adobevgc@gmail.com account',
        hint: 'The original VGC Towers must exist before other users can receive copies'
      }, { status: 400 });
    }

    const templateData = {
      image_urls: templateVGC.image_urls || [],
      zones: templateVGC.zones || [],
      description: templateVGC.description,
      bedroom_count: templateVGC.bedroom_count,
    };

    // STEP 2: Fetch all personal (non-shared) VGC Towers for this user
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const userInstances = await base44.entities.LocationReference.filter({
      owner_email: user.email,
      name: 'VGC Towers',
      scope: { $ne: 'shared' }
    });

    // STEP 3: If multiple instances, delete all but one and update the remaining
    if (userInstances.length > 1) {
      const [primary, ...duplicates] = userInstances;
      const deletePromises = duplicates.map(dup =>
        base44.entities.LocationReference.delete(dup.id).catch(() => null)
      );
      await Promise.all(deletePromises);

      // Update primary with template data if missing
      if (!primary.image_urls || primary.image_urls.length === 0) {
        await base44.entities.LocationReference.update(primary.id, templateData);
      }
      if (!primary.owner_email || !primary.scope) {
        await base44.entities.LocationReference.update(primary.id, {
          owner_email: user.email,
          scope: 'account_global',
          created_by_role: 'user',
        });
      }

      return Response.json({
        vgc_towers_id: primary.id,
        vgc_towers_name: primary.name,
        created: false,
        duplicates_removed: duplicates.length,
        template_source: 'adobevgc@gmail.com',
      });
    }

    // STEP 4: If one instance exists, verify it has template data
    if (userInstances.length === 1) {
      const existing = userInstances[0];
      const needsUpdate = !existing.image_urls || existing.image_urls.length === 0;

      if (needsUpdate) {
        await base44.entities.LocationReference.update(existing.id, templateData);
      }

      // Ensure ownership is correct
      if (!existing.owner_email || !existing.scope) {
        await base44.entities.LocationReference.update(existing.id, {
          owner_email: user.email,
          scope: 'account_global',
          created_by_role: 'user',
        });
      }

      return Response.json({
        vgc_towers_id: existing.id,
        vgc_towers_name: existing.name,
        created: false,
        updated_with_template: needsUpdate,
        template_source: 'adobevgc@gmail.com',
      });
    }

    // STEP 5: No instance exists — create one from template
    const newVGC = await base44.entities.LocationReference.create({
      name: 'VGC Towers',
      category: 'home',
      scope: 'account_global',
      location_type: 'global',
      owner_email: user.email,
      created_by_role: 'user',
      is_user_created: true,
      ...templateData,
      resident_character_ids: [],
      resident_character_names: [],
    });

    console.log(`[ensureUserVGCTowers] Created new VGC Towers for ${user.email} from template: ${newVGC.id}`);

    return Response.json({
      vgc_towers_id: newVGC.id,
      vgc_towers_name: newVGC.name,
      created: true,
      template_source: 'adobevgc@gmail.com',
    });
  } catch (error) {
    console.error('[ensureUserVGCTowers]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});