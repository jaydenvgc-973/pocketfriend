import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Backend function: selectVideoProvider
 * 
 * Diagnoses video provider capabilities and recommends routing for reel generation.
 * This function does NOT generate video — it determines which provider should.
 * 
 * Used by processReelGenerationJob to decide:
 * - Is the current provider (Veo) suitable for this clip?
 * - If not, what provider should be used?
 * - What are the capability gaps?
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      clip_type, // 'character' | 'scene' | 'generic'
      requires_identity_preservation, // true for character clips
      character_name, // optional context
      fallback_to_veo_allowed, // whether to use Veo if no better option
    } = body;

    // Provider capability matrix
    const providers = {
      veo_3x: {
        id: 'veo_3x',
        name: 'Google Veo 3.x',
        supports_init_frame: false,
        supports_identity_reference: 'style_only',
        suitable_for_character_identity: false,
        status: 'active',
        fallback_tier: 'lowest',
      },
      runway: {
        id: 'runway',
        name: 'Runway ML',
        supports_init_frame: true,
        supports_identity_reference: 'strict_frame_lock',
        suitable_for_character_identity: true,
        status: 'investigation',
        fallback_tier: 'primary',
      },
      pika: {
        id: 'pika',
        name: 'Pika 1.0',
        supports_init_frame: true,
        supports_identity_reference: 'strict_frame_lock',
        suitable_for_character_identity: true,
        status: 'investigation',
        fallback_tier: 'primary',
      },
    };

    const selectedProvider = null;
    const capabilityGaps = [];
    const recommendations = [];

    if (requires_identity_preservation) {
      // Character identity critical — need init-frame support
      const identityProviders = Object.values(providers).filter(
        (p) => p.supports_init_frame && p.status !== 'archived'
      );

      if (identityProviders.length === 0) {
        // No suitable provider currently integrated
        capabilityGaps.push(
          'No integrated provider supports true image-to-video with init-frame control'
        );
        recommendations.push(
          'Integrate Runway ML or Pika 1.0 for character identity preservation'
        );

        if (fallback_to_veo_allowed) {
          recommendations.push(
            `WARNING: Falling back to Veo 3.x (does NOT preserve character identity)`
          );
          selectedProvider = providers.veo_3x;
        } else {
          return Response.json(
            {
              status: 'no_suitable_provider',
              required_capability: 'init_frame_identity_lock',
              available_providers: Object.values(providers)
                .filter((p) => p.suitable_for_character_identity)
                .map((p) => ({ id: p.id, name: p.name, status: p.status })),
              capability_gaps: capabilityGaps,
              recommendations: recommendations,
            },
            { status: 400 }
          );
        }
      } else {
        // Use the first available identity-preserving provider
        selectedProvider = identityProviders.sort(
          (a, b) => (a.fallback_tier === 'primary' ? -1 : 1)
        )[0];
      }
    } else {
      // Non-identity-critical: Veo is acceptable
      selectedProvider = providers.veo_3x;
    }

    return Response.json({
      status: 'ok',
      selected_provider: selectedProvider?.id,
      provider_config: selectedProvider,
      requires_identity_preservation: requires_identity_preservation,
      capability_gaps: capabilityGaps,
      recommendations: recommendations,
      diagnostics: {
        all_providers: Object.values(providers).map((p) => ({
          id: p.id,
          name: p.name,
          supports_init_frame: p.supports_init_frame,
          suitable_for_character_identity: p.suitable_for_character_identity,
          status: p.status,
        })),
        character_identity_providers: Object.values(providers)
          .filter((p) => p.suitable_for_character_identity)
          .map((p) => p.id),
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});