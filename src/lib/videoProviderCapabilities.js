/**
 * Video Provider Capability Matrix
 * Defines which providers support which features for character identity preservation in animation.
 * 
 * Source-frame / init-image control is CRITICAL for memory reels where character identity must be preserved.
 */

export const VIDEO_PROVIDERS = {
  // ─────────────────────────────────────────────────────────────────────────────
  // GOOGLE VEO 3.X (via Base44 Core.GenerateVideo)
  // Current fallback provider. Does NOT support true init-frame locking.
  veo_3x: {
    id: 'veo_3x',
    name: 'Google Veo 3.x',
    status: 'active',
    fallback_priority: 'lowest',
    capabilities: {
      supports_init_frame: false,
      supports_image_to_video: false,
      supports_identity_reference: 'loose_style_only', // existing_image_urls = style inspiration, not frame control
      supports_reference_strength: false,
      supports_seed: false,
      supports_multi_reference: false,
      supports_frame_validation: false,
      aspect_ratios: ['9:16', '16:9'],
      max_duration_seconds: 6,
      min_duration_seconds: 4,
    },
    limitations: [
      'No init-frame control — video can change character appearance',
      'Reference images treated as style guidance, not source frames',
      'Cannot guarantee character identity preservation',
      'Suitable only as fallback for non-identity-critical clips',
    ],
    use_case: 'Motion-only clips where character identity is not critical',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // RUNWAY ML (Investigation Target)
  // Known to support image-to-video with strong frame preservation.
  runway: {
    id: 'runway',
    name: 'Runway ML',
    status: 'investigation',
    fallback_priority: 'primary_candidate',
    capabilities: {
      supports_init_frame: true, // frame input (image-to-video)
      supports_image_to_video: true,
      supports_identity_reference: 'init_frame_strict',
      supports_reference_strength: true, // motion_bucket_id or similar
      supports_seed: true,
      supports_multi_reference: false,
      supports_frame_validation: true, // can compare output to input
      aspect_ratios: ['9:16', '16:9', '1:1'],
      max_duration_seconds: 10,
      min_duration_seconds: 2,
    },
    limitations: [
      'Investigation phase — integration not yet implemented',
      'Requires API credentials and backend integration',
    ],
    use_case: 'Character identity-critical memory reels with true source-frame locking',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // PIKA 1.0 (Investigation Target)
  // Known to support image-to-video with identity preservation.
  pika: {
    id: 'pika',
    name: 'Pika 1.0',
    status: 'investigation',
    fallback_priority: 'primary_candidate',
    capabilities: {
      supports_init_frame: true,
      supports_image_to_video: true,
      supports_identity_reference: 'init_frame_strict',
      supports_reference_strength: true,
      supports_seed: true,
      supports_multi_reference: false,
      supports_frame_validation: true,
      aspect_ratios: ['9:16', '16:9', '1:1'],
      max_duration_seconds: 10,
      min_duration_seconds: 1,
    },
    limitations: [
      'Investigation phase — integration not yet implemented',
      'Requires API credentials and backend integration',
    ],
    use_case: 'Character identity-critical memory reels',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // HAIPER (Investigation Target)
  // Early stage, but shows promise for identity-preserving animation.
  haiper: {
    id: 'haiper',
    name: 'Haiper',
    status: 'investigation',
    fallback_priority: 'secondary_candidate',
    capabilities: {
      supports_init_frame: true,
      supports_image_to_video: true,
      supports_identity_reference: 'init_frame_strict',
      supports_reference_strength: false,
      supports_seed: false,
      supports_multi_reference: false,
      supports_frame_validation: false,
      aspect_ratios: ['9:16', '16:9'],
      max_duration_seconds: 8,
      min_duration_seconds: 2,
    },
    limitations: [
      'Investigation phase — integration not yet implemented',
      'Less mature than Runway/Pika',
    ],
    use_case: 'Character identity-critical memory reels (secondary option)',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // SYNTHESIA (Investigation Target)
  // Different approach: avatar video. Not suitable for real character photos.
  synthesia: {
    id: 'synthesia',
    name: 'Synthesia',
    status: 'investigation',
    fallback_priority: 'not_applicable',
    capabilities: {
      supports_init_frame: false,
      supports_image_to_video: false,
      supports_identity_reference: 'avatar_model_only',
      supports_reference_strength: false,
      supports_seed: false,
      supports_multi_reference: false,
      supports_frame_validation: false,
      aspect_ratios: ['16:9'],
      max_duration_seconds: 120,
      min_duration_seconds: 1,
    },
    limitations: [
      'Avatar/digital human platform, not photo-to-video',
      'Not suitable for real character photo animation',
    ],
    use_case: 'Not applicable for memory reels',
  },
};

/**
 * Select the appropriate provider based on requirements.
 * 
 * @param {Object} requirements - { needs_character_identity: bool, fallback_allowed: bool }
 * @returns {Object} Selected provider config or null if no suitable provider
 */
export function selectVideoProvider(requirements) {
  const { needs_character_identity = true, fallback_allowed = false } = requirements;

  if (needs_character_identity) {
    // Find primary candidates that support init-frame
    const primaryCandidates = Object.values(VIDEO_PROVIDERS).filter(
      (p) => p.capabilities.supports_init_frame && p.fallback_priority === 'primary_candidate'
    );

    if (primaryCandidates.length > 0) {
      return primaryCandidates[0]; // Runway preferred as primary
    }

    // Secondary candidates
    const secondaryCandidates = Object.values(VIDEO_PROVIDERS).filter(
      (p) => p.capabilities.supports_init_frame && p.fallback_priority === 'secondary_candidate'
    );

    if (secondaryCandidates.length > 0) {
      return secondaryCandidates[0];
    }

    // If no real provider available but fallback allowed, use Veo
    if (fallback_allowed) {
      return VIDEO_PROVIDERS.veo_3x;
    }

    return null; // No suitable provider
  }

  // Non-identity-critical: Veo is acceptable
  return VIDEO_PROVIDERS.veo_3x;
}

/**
 * Get diagnostic report on provider capabilities.
 * @returns {Object} Status of all providers and recommendations
 */
export function getProviderCapabilityDiagnostics() {
  const report = {
    timestamp: new Date().toISOString(),
    identity_critical_requirement: 'Character identity MUST be preserved in generated video for memory reels',
    current_status: {
      primary_provider: 'Google Veo 3.x (via Base44 Core.GenerateVideo)',
      identity_preserving: false,
      limitation: 'Veo treats reference images as style guidance, not source-frame control',
    },
    investigation_candidates: [
      {
        provider: 'Runway ML',
        status: 'Primary candidate',
        reason: 'Supports true image-to-video with init-frame and motion control',
        action_needed: 'Integrate Runway API backend function',
      },
      {
        provider: 'Pika 1.0',
        status: 'Primary candidate',
        reason: 'Supports true image-to-video with identity preservation',
        action_needed: 'Integrate Pika API backend function',
      },
      {
        provider: 'Haiper',
        status: 'Secondary candidate',
        reason: 'Supports image-to-video but less mature than Runway/Pika',
        action_needed: 'Monitor maturity; integrate if primary options unavailable',
      },
    ],
    required_next_steps: [
      '1. Investigate Runway API documentation and integration cost',
      '2. Investigate Pika API documentation and integration cost',
      '3. Implement backend function router that selects provider by capability',
      '4. Build Runway backend function (if selected)',
      '5. Build Pika backend function (if selected)',
      '6. Update ReelPlayer to display provider capability warnings',
      '7. Update processReelGenerationJob to route to correct provider',
    ],
    recommendation: 'Do not ship memory reel feature with Veo as sole provider for character identity clips. Route to Runway or Pika once integration is complete.',
  };

  return report;
}