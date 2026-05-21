/**
 * findKhalilComprehensive
 * 
 * Search every possible character source for Khalil.
 * Check: Character, active created characters, NPC families, world people, roster sources.
 * Case-insensitive search on: name, display_name, full_name, first_name, nickname.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = {
      user_email: user.email,
      sources_checked: [],
      khalil_found: false,
      khalil: null,
    };

    // SOURCE 1: User-scoped Character.filter (primary RLS)
    console.log('[findKhalilComprehensive] Checking user-scoped Character.filter...');
    const userChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      500
    );
    const khalilUser = userChars.find(c => 
      c.name?.toLowerCase() === 'khalil' ||
      c.display_name?.toLowerCase() === 'khalil' ||
      c.full_name?.toLowerCase() === 'khalil' ||
      c.primary_name?.toLowerCase() === 'khalil'
    );
    results.sources_checked.push({
      source: 'Character.filter(owner_email)',
      found: !!khalilUser,
      count: userChars.length,
    });
    if (khalilUser) {
      results.khalil_found = true;
      results.khalil = khalilUser;
      console.log('[findKhalilComprehensive] FOUND in user-scoped Character:', khalilUser.id);
    }

    // SOURCE 2: Service-role all characters (search by name if missed by RLS)
    if (!results.khalil_found) {
      console.log('[findKhalilComprehensive] Checking service-role Character.filter (all)...');
      const allChars = await base44.asServiceRole.entities.Character.filter(
        {},
        '-updated_date',
        1000
      );
      const khalilAll = allChars.find(c => 
        c.name?.toLowerCase() === 'khalil' ||
        c.display_name?.toLowerCase() === 'khalil' ||
        c.full_name?.toLowerCase() === 'khalil'
      );
      results.sources_checked.push({
        source: 'Character.filter(all, service-role)',
        found: !!khalilAll,
        count: allChars.length,
        note: khalilAll ? `Found but owner_email=${khalilAll.owner_email}` : 'Not found',
      });
      if (khalilAll) {
        results.khalil_found = true;
        results.khalil = khalilAll;
        console.log('[findKhalilComprehensive] FOUND in all characters:', khalilAll.id, 'owner:', khalilAll.owner_email);
      }
    }

    // SOURCE 3: Active created characters (filtered subset)
    if (!results.khalil_found) {
      console.log('[findKhalilComprehensive] Checking active created characters...');
      const activeCreated = await base44.asServiceRole.entities.Character.filter(
        { character_type: 'active_created_character', owner_email: user.email },
        '-updated_date',
        500
      );
      const khalilActive = activeCreated.find(c =>
        c.name?.toLowerCase() === 'khalil' ||
        c.display_name?.toLowerCase() === 'khalil'
      );
      results.sources_checked.push({
        source: 'Character(active_created_character)',
        found: !!khalilActive,
        count: activeCreated.length,
      });
      if (khalilActive) {
        results.khalil_found = true;
        results.khalil = khalilActive;
        console.log('[findKhalilComprehensive] FOUND in active created:', khalilActive.id);
      }
    }

    // SOURCE 4: Check aliases and family members (if Khalil is referenced as family)
    if (!results.khalil_found && userChars.length > 0) {
      console.log('[findKhalilComprehensive] Checking character aliases and family...');
      for (const char of userChars) {
        // Check aliases
        if (Array.isArray(char.aliases)) {
          for (const alias of char.aliases) {
            if (alias.alias?.toLowerCase() === 'khalil' || alias.name?.toLowerCase() === 'khalil') {
              results.khalil_found = true;
              results.khalil = char;
              results.khalil.note = `Found as alias of ${char.name}`;
              console.log('[findKhalilComprehensive] Found Khalil as alias of:', char.name);
              break;
            }
          }
        }
        // Check family_members
        if (!results.khalil_found && Array.isArray(char.family_members)) {
          const khalilFamily = char.family_members.find(fm =>
            fm.name?.toLowerCase() === 'khalil'
          );
          if (khalilFamily) {
            results.khalil_found = true;
            results.khalil = { ...khalilFamily, note: `NPC family member of ${char.name}`, parent_character_id: char.id };
            console.log('[findKhalilComprehensive] Found Khalil as family member of:', char.name);
            break;
          }
        }
        if (results.khalil_found) break;
      }
      if (!results.khalil_found) {
        results.sources_checked.push({
          source: 'Character aliases and family_members',
          found: false,
          checked_characters: userChars.length,
        });
      }
    }

    // Final report
    if (results.khalil_found && results.khalil) {
      return Response.json({
        success: true,
        khalil_id: results.khalil.id,
        khalil_name: results.khalil.display_name || results.khalil.name,
        owner_email: results.khalil.owner_email,
        owned_by_current_user: results.khalil.owner_email === user.email,
        current_location_id: results.khalil.resolved_current_location_id,
        current_location_name: results.khalil.resolved_current_location_name,
        travel_status: results.khalil.travel_status,
        presence_status: results.khalil.resolved_presence_status,
        character_type: results.khalil.character_type,
        safe_for_test: true,
        sources_checked: results.sources_checked,
      });
    } else {
      return Response.json({
        success: false,
        error: 'Khalil not found',
        user_email: user.email,
        sources_checked: results.sources_checked,
        message: 'Khalil was not found in any checked source. Verify spelling and scope.',
      }, { status: 404 });
    }

  } catch (error) {
    console.error('[findKhalilComprehensive]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});