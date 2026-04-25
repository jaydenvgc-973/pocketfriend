/**
 * DEEP DIAGNOSTIC: Ethan vs Other Characters - Image Generation Differences
 * 
 * This function performs an exhaustive investigation comparing Ethan's image generation
 * pipeline with other active characters to identify structural/configuration differences.
 * 
 * Returns EVIDENCE-BASED findings with complete documentation of every check.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // HARDCODED IDs from your app — these must exist in your database
    const ETHAN_ID = '69c0d59d7e382cc866ded9c9';  // Ethan Nathan Thompson
    const ETHAN_HOME_ID = '69d03c56a5e65c211c8a6105'; // Ethan Thompson's Home

    console.log('\n=================================================================');
    console.log('DEEP DIVE DIAGNOSTIC: ETHAN vs OTHER CHARACTERS');
    console.log('=================================================================\n');

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: FETCH ETHAN & OTHER ACTIVE CHARACTERS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('[STEP 1] FETCHING CHARACTER DATA...\n');

    const ethanResult = await base44.asServiceRole.entities.Character.filter({ id: ETHAN_ID }, null, 1);
    const ethan = ethanResult?.[0] || null;

    if (!ethan) {
      return Response.json({
        error: 'ETHAN NOT FOUND',
        detail: `Character with ID "${ETHAN_ID}" does not exist in database`
      }, { status: 404 });
    }

    console.log(`✓ ETHAN FOUND: "${ethan.name}" (ID: ${ethan.id})`);
    console.log(`  - created_by: ${ethan.created_by}`);
    console.log(`  - owner_email: ${ethan.owner_email}`);
    console.log(`  - status: ${ethan.status}`);
    console.log(`  - character_type: ${ethan.character_type}`);

    // Get other active characters for comparison
    const otherCharsResult = await base44.asServiceRole.entities.Character.filter({
      status: 'active',
      character_type: 'active_created_character',
      id: { $ne: ETHAN_ID }
    }, null, 10);
    const otherChars = otherCharsResult || [];

    console.log(`\n✓ OTHER ACTIVE CHARACTERS FOUND: ${otherChars.length}`);
    otherChars.slice(0, 3).forEach(c => {
      console.log(`  - ${c.name} (${c.id})`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: CHARACTER IDENTITY REFERENCES (Avatar, Reference Images)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n[STEP 2] CHARACTER IDENTITY REFERENCES...\n');

    const ethanIdentityFindings = {
      avatar_url: { value: ethan.avatar_url, has_value: !!ethan.avatar_url },
      avatar_url_length: ethan.avatar_url?.length || 0,
      reference_image_urls_count: (ethan.reference_image_urls || []).length,
      reference_image_urls: ethan.reference_image_urls || [],
      image_avatar_url: { value: ethan.image_avatar_url, has_value: !!ethan.image_avatar_url },
      generated_image_urls_in_reference: (ethan.reference_image_urls || []).filter(url => 
        url.includes('generated') || url.includes('generated_image')
      ).length,
    };

    console.log('ETHAN Identity References:');
    console.log(`  - avatar_url: ${ethanIdentityFindings.avatar_url.has_value ? '✓ SET' : '✗ MISSING'}`);
    console.log(`    Length: ${ethanIdentityFindings.avatar_url_length} chars`);
    console.log(`  - reference_image_urls COUNT: ${ethanIdentityFindings.reference_image_urls_count}`);
    console.log(`  - Generated images IN reference_image_urls: ${ethanIdentityFindings.generated_image_urls_in_reference}`);
    console.log(`  - image_avatar_url: ${ethanIdentityFindings.image_avatar_url.has_value ? '✓ SET' : '✗ MISSING'}`);

    // Compare with first other character
    const compareChar = otherChars[0];
    if (compareChar) {
      const compareIdentityFindings = {
        avatar_url: { value: compareChar.avatar_url, has_value: !!compareChar.avatar_url },
        avatar_url_length: compareChar.avatar_url?.length || 0,
        reference_image_urls_count: (compareChar.reference_image_urls || []).length,
        generated_image_urls_in_reference: (compareChar.reference_image_urls || []).filter(url => 
          url.includes('generated') || url.includes('generated_image')
        ).length,
      };

      console.log(`\n${compareChar.name} (for comparison):`)
      console.log(`  - avatar_url: ${compareIdentityFindings.avatar_url.has_value ? '✓ SET' : '✗ MISSING'}`);
      console.log(`    Length: ${compareIdentityFindings.avatar_url_length} chars`);
      console.log(`  - reference_image_urls COUNT: ${compareIdentityFindings.reference_image_urls_count}`);
      console.log(`  - Generated images IN reference_image_urls: ${compareIdentityFindings.generated_image_urls_in_reference}`);

      console.log(`\n⚠️ DIFFERENCE DETECTED:`);
      if (ethanIdentityFindings.reference_image_urls_count !== compareIdentityFindings.reference_image_urls_count) {
        console.log(`  Reference count: Ethan=${ethanIdentityFindings.reference_image_urls_count} vs ${compareChar.name}=${compareIdentityFindings.reference_image_urls_count}`);
      }
      if (ethanIdentityFindings.generated_image_urls_in_reference !== compareIdentityFindings.generated_image_urls_in_reference) {
        console.log(`  Generated images IN references: Ethan=${ethanIdentityFindings.generated_image_urls_in_reference} vs ${compareChar.name}=${compareIdentityFindings.generated_image_urls_in_reference}`);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3: LOCATION ASSIGNMENT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n[STEP 3] LOCATION ASSIGNMENT...\n');

    const ethanLocationFindings = {
      current_home_location_id: ethan.current_home_location_id,
      home_location_id: ethan.home_location_id,
      occupation_location_id: ethan.occupation_location_id,
      resolved_current_location_id: ethan.resolved_current_location_id,
      resolved_current_location_name: ethan.resolved_current_location_name,
      resolved_presence_status: ethan.resolved_presence_status,
    };

    console.log('ETHAN Location Fields:');
    console.log(`  - current_home_location_id: ${ethanLocationFindings.current_home_location_id || '✗ NONE'}`);
    console.log(`  - home_location_id: ${ethanLocationFindings.home_location_id || '✗ NONE'}`);
    console.log(`  - occupation_location_id: ${ethanLocationFindings.occupation_location_id || '✗ NONE'}`);
    console.log(`  - resolved_current_location_id: ${ethanLocationFindings.resolved_current_location_id || '✗ NONE'}`);
    console.log(`  - resolved_current_location_name: ${ethanLocationFindings.resolved_current_location_name || '✗ NONE'}`);
    console.log(`  - resolved_presence_status: ${ethanLocationFindings.resolved_presence_status || '✗ NONE'}`);

    if (compareChar) {
      console.log(`\n${compareChar.name} Location Fields (for comparison):`);
      console.log(`  - current_home_location_id: ${compareChar.current_home_location_id || '✗ NONE'}`);
      console.log(`  - resolved_current_location_id: ${compareChar.resolved_current_location_id || '✗ NONE'}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4: ETHAN'S HOME LOCATION STRUCTURE
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n[STEP 4] ETHAN HOME LOCATION STRUCTURE...\n');

    const homeResult = await base44.asServiceRole.entities.LocationReference.filter({ id: ETHAN_HOME_ID }, null, 1);
    const ethanHome = homeResult?.[0] || null;

    if (!ethanHome) {
      console.log(`✗ HOME LOCATION NOT FOUND (ID: ${ETHAN_HOME_ID})`);
    } else {
      console.log(`✓ ETHAN HOME LOCATION FOUND: "${ethanHome.name}"\n`);

      const zones = ethanHome.zones || [];
      console.log(`  - Total Zones: ${zones.length}`);

      zones.forEach((zone, i) => {
        const imageCount = (zone.image_urls || []).length;
        console.log(`\n  Zone #${i + 1}: "${zone.zone_name}"`);
        console.log(`    - Images: ${imageCount}`);
        
        if (imageCount > 0) {
          zone.image_urls.forEach((url, j) => {
            const isAvif = url.includes('avif') || url.includes('heic') || url.includes('heif');
            const isGenerated = url.includes('generated');
            console.log(`      Image ${j + 1}: ${isAvif ? '⚠️ AVIF' : '✓ Valid'} | ${isGenerated ? '🤖 Generated' : '📷 Uploaded'} | ${url.substring(0, 80)}...`);
          });
        }
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5: COMPARE WITH OTHER CHARACTER'S HOME
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n[STEP 5] COMPARE WITH OTHER CHARACTER HOME...\n');

    if (compareChar) {
      const otherHomeId = compareChar.current_home_location_id || compareChar.home_location_id;
      if (otherHomeId) {
        const otherHomeResult = await base44.asServiceRole.entities.LocationReference.filter({ id: otherHomeId }, null, 1);
        const otherHome = otherHomeResult?.[0] || null;

        if (otherHome) {
          const otherZones = otherHome.zones || [];
          console.log(`${compareChar.name}'s Home: "${otherHome.name}"`);
          console.log(`  - Total Zones: ${otherZones.length}`);
          
          const totalImages = otherZones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);
          console.log(`  - Total Images Across Zones: ${totalImages}`);

          if (otherZones.length > 0) {
            const firstZone = otherZones[0];
            console.log(`  - First Zone: "${firstZone.zone_name}" with ${firstZone.image_urls?.length || 0} images`);
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 6: CHECK CHARACTER BEHAVIOR/CONFIG FLAGS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n[STEP 6] CHARACTER BEHAVIOR & CONFIG FLAGS...\n');

    const ethanBehaviorFindings = {
      is_active_character: ethan.is_active_character,
      is_photogenic: ethan.is_photogenic,
      is_protected: ethan.is_protected,
      protected_active: ethan.protected_active,
      is_test_character: ethan.is_test_character,
      diagnostic_only: ethan.diagnostic_only,
      exclude_from_homepage: ethan.exclude_from_homepage,
      avatar_generation_prompt: { has: !!ethan.avatar_generation_prompt, length: ethan.avatar_generation_prompt?.length || 0 },
    };

    console.log('ETHAN Behavior Flags:');
    console.log(`  - is_active_character: ${ethanBehaviorFindings.is_active_character}`);
    console.log(`  - is_photogenic: ${ethanBehaviorFindings.is_photogenic}`);
    console.log(`  - is_protected: ${ethanBehaviorFindings.is_protected}`);
    console.log(`  - protected_active: ${ethanBehaviorFindings.protected_active}`);
    console.log(`  - is_test_character: ${ethanBehaviorFindings.is_test_character}`);
    console.log(`  - diagnostic_only: ${ethanBehaviorFindings.diagnostic_only}`);
    console.log(`  - exclude_from_homepage: ${ethanBehaviorFindings.exclude_from_homepage}`);
    console.log(`  - avatar_generation_prompt: ${ethanBehaviorFindings.avatar_generation_prompt.has ? '✓ SET' : '✗ NONE'}`);

    if (compareChar) {
      console.log(`\n${compareChar.name} Behavior Flags (for comparison):`);
      console.log(`  - is_active_character: ${compareChar.is_active_character}`);
      console.log(`  - is_photogenic: ${compareChar.is_photogenic}`);
      console.log(`  - is_protected: ${compareChar.is_protected}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 7: RECENT MESSAGES & IMAGE GENERATION HISTORY
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n[STEP 7] RECENT IMAGE GENERATIONS...\n');

    const ethanMsgs = await base44.asServiceRole.entities.Message.filter({
      character_id: ETHAN_ID,
      sender_type: 'character',
      image_url: { $exists: true }
    }, '-created_date', 5);

    console.log(`Ethan's recent image messages: ${ethanMsgs.length}`);
    if (ethanMsgs.length > 0) {
      ethanMsgs.forEach((msg, i) => {
        console.log(`  ${i + 1}. ${msg.created_date || 'no date'}`);
        console.log(`     Image URL: ${msg.image_url?.substring(0, 100)}...`);
        if (msg.generation_context) {
          console.log(`     Has generation_context: ✓`);
          console.log(`     Location: ${msg.generation_context.location_name || 'none'}`);
          console.log(`     Zone: ${msg.generation_context.zone_name || 'none'}`);
          const locRefCount = msg.generation_context.location_reference_images?.length || 0;
          console.log(`     Location refs used: ${locRefCount}`);
        }
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 8: FINAL COMPARISON MATRIX
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n\n[STEP 8] FINAL FINDINGS MATRIX...\n');

    const findings = {
      ETHAN_SUMMARY: {
        name: ethan.name,
        id: ETHAN_ID,
        reference_images_count: ethanIdentityFindings.reference_image_urls_count,
        has_home_location: !!ethanHome,
        home_zones_count: ethanHome?.zones?.length || 0,
        home_total_images: ethanHome?.zones?.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0) || 0,
        avif_images_in_home: ethanHome?.zones?.reduce((sum, z) => sum + (z.image_urls || []).filter(u => u.includes('avif')).length, 0) || 0,
        recent_image_generations: ethanMsgs.length,
      },
      COMPARISON_CHAR: compareChar ? {
        name: compareChar.name,
        id: compareChar.id,
        reference_images_count: (compareChar.reference_image_urls || []).length,
        has_home_location: !!otherHomeResult?.[0],
        home_zones_count: otherHomeResult?.[0]?.zones?.length || 0,
        home_total_images: otherHomeResult?.[0]?.zones?.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0) || 0,
      } : null,
      POTENTIAL_ISSUES: [],
      EVIDENCE: [],
    };

    // Analyze for issues
    if (ethanIdentityFindings.reference_image_urls_count === 0) {
      findings.POTENTIAL_ISSUES.push('✗ Ethan has ZERO reference images for identity');
      findings.EVIDENCE.push('reference_image_urls array is empty or undefined');
    }

    if (ethanIdentityFindings.generated_image_urls_in_reference > 0) {
      findings.POTENTIAL_ISSUES.push(`⚠️ Ethan's reference_image_urls contains ${ethanIdentityFindings.generated_image_urls_in_reference} GENERATED images (should be real photos only)`);
      findings.EVIDENCE.push('Generated images found in reference_image_urls - these will cause AI model to copy pose/background');
    }

    if (findings.ETHAN_SUMMARY.avif_images_in_home > 0) {
      findings.POTENTIAL_ISSUES.push(`✗ Ethan's home location has ${findings.ETHAN_SUMMARY.avif_images_in_home} AVIF format zone images (AI model cannot read AVIF)`);
      findings.EVIDENCE.push('Zone images are in AVIF format - AI generation will fail silently and fall back to avatar');
    }

    if (!ethanHome) {
      findings.POTENTIAL_ISSUES.push('✗ Ethan has no home location assigned');
      findings.EVIDENCE.push(`No LocationReference found with ID ${ETHAN_HOME_ID}`);
    } else if (ethanHome.zones?.length === 0) {
      findings.POTENTIAL_ISSUES.push('✗ Ethan\'s home has no zones defined');
      findings.EVIDENCE.push(`LocationReference "${ethanHome.name}" has empty zones array`);
    } else if (findings.ETHAN_SUMMARY.home_total_images === 0) {
      findings.POTENTIAL_ISSUES.push('✗ Ethan\'s home zones have no images at all');
      findings.EVIDENCE.push(`All ${ethanHome.zones.length} zones lack image_urls`);
    }

    console.log(JSON.stringify(findings, null, 2));

    return Response.json(findings);

  } catch (error) {
    console.error('[deepDiveEthanImageGenDiagnostic] Fatal:', error.message);
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});