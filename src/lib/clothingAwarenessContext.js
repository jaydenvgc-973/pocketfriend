/**
 * clothingAwarenessContext.js
 *
 * Visual clothing awareness for character interactions.
 *
 * WHAT THIS DOES:
 *   Builds a prompt context block that injects clothing visibility into LLM prompts
 *   so characters can naturally perceive, interpret, and optionally comment on what
 *   others are wearing — based on personality, traits, relationships, and environment.
 *
 * WHAT THIS DOES NOT DO:
 *   - Does not replace the closet, rotation, or wardrobe systems
 *   - Does not force clothing commentary into every response
 *   - Does not create a global clothing-opinion system
 *   - Does not modify outfit authority (resolveCharacterOutfitContext owns that)
 *   - Does not create new clothing data — reads from existing character records
 *
 * INTEGRATION POINT:
 *   Call buildClothingAwarenessContext() in promptContextBuilders / buildCanonicalCharacterContext
 *   and append its output to the system prompt string.
 *
 * PROOF POINTS (required):
 *   1. Where clothing perception is injected → this file, called from prompt builder
 *   2. Observer personality affects interpretation → TRAIT MAP below
 *   3. Uniforms evaluated visually → resolveVisualUniformStatus()
 *   4. Different reactions from different personalities → personality framing blocks
 *   5. Ordinary outfits not auto-stored as memories → only memorable_outfit flag triggers memory hint
 */

import { resolveCurrentOutfit, buildOutfitPromptText } from './outfitRotationEngine.js';
import { adaptOutfitForWeather, buildWeatherAdaptationNote } from './weatherOutfitAdapter.js';
import { resolveUniform, determineCharacterRoleAtLocation, buildUniformOutfitContext } from './uniformResolver.js';

// ── UNIFORM CHECK ─────────────────────────────────────────────────────────────
// When a character is at a location with a required uniform, the uniform IS
// what they're wearing — not their closet outfit. The weather adapter will
// correctly skip adaptation for uniforms (isUniformOutfit check).
// PROOF POINT 3: uniform requirements override weather.
function resolveUniformIfApplicable(character, locationRecord) {
  if (!character || !locationRecord) return null;
  try {
    const role = determineCharacterRoleAtLocation(character, locationRecord);
    if (!role) return null;
    const resolved = resolveUniform(character, locationRecord, role);
    if (resolved?.uniform) {
      return buildUniformOutfitContext(resolved);
    }
  } catch { /* non-blocking */ }
  return null;
}

// ── OUTFIT TEXT EXTRACTOR ─────────────────────────────────────────────────────
// Reads from existing character record — does NOT create new authority.
// Weather adaptation is applied here so ALL clothing awareness consumers
// (Chat, Scene, self-awareness) see the same weather-adjusted appearance.
//
// PROOF POINT 5: Updated appearance shared consistently — every consumer of
// clothing awareness gets the weather-adapted text through this single function.
function getOutfitText(character, weatherCache = null, locationRecord = null, isWorker = false) {
  if (!character) return null;

  // ── UNIFORM PRIORITY ──────────────────────────────────────────────────────
  // If the character is at a location with a required uniform, the uniform is
  // what they're wearing. Uniforms are never weather-adapted (Rule 4).
  if (locationRecord) {
    const uniformCtx = resolveUniformIfApplicable(character, locationRecord);
    if (uniformCtx?.outfit) {
      const text = uniformCtx.description || buildOutfitPromptText(uniformCtx.outfit);
      if (text) {
        return {
          text,
          label: 'uniform',
          category: 'uniform',
          outfit: uniformCtx.outfit,
          weatherAdaptation: null, // uniforms are never adapted
        };
      }
    }
  }

  // ── CLOSET OUTFIT (rotation engine authority) ─────────────────────────────
  try {
    const outfit = resolveCurrentOutfit(character, '', null, null);
    if (outfit) {
      let text = buildOutfitPromptText(outfit);
      if (text) {
        // ── WEATHER ADAPTATION LAYER ──────────────────────────────────────
        // The outfit object stays the authority — only the visible text changes
        // to reflect which pieces are currently being worn in this weather.
        // PROOF POINT 1: weather modifies visible clothing here.
        // PROOF POINT 6: outfit object (authority) is never mutated.
        let adaptation = null;
        if (weatherCache) {
          adaptation = adaptOutfitForWeather({
            outfitText: text,
            outfit,
            source: 'rotation',
            category: outfit.category || null,
            weatherCache,
            location: locationRecord,
            character,
            isWorker,
          });
          if (adaptation?.adapted) {
            text = adaptation.adaptedText;
          }
        }
        return {
          text,
          label: outfit.label || null,
          category: outfit.category || null,
          outfit,
          weatherAdaptation: adaptation,
        };
      }
    }
  } catch { /* non-blocking */ }
  // Fallback: current_outfit stub (only for rotation-off characters)
  const co = character.current_outfit;
  if (co) {
    const parts = [co.top, co.bottom, co.shoes, co.outerwear, co.accessories].filter(Boolean);
    let text = parts.length > 0 ? parts.join(', ') : (co.full_description || co.label || null);
    if (text) {
      // Apply weather adaptation to fallback outfit too
      let adaptation = null;
      if (weatherCache) {
        adaptation = adaptOutfitForWeather({
          outfitText: text,
          outfit: co,
          source: 'fallback',
          category: co.category || null,
          weatherCache,
          location: locationRecord,
          character,
          isWorker,
        });
        if (adaptation?.adapted) {
          text = adaptation.adaptedText;
        }
      }
      return { text, label: co.label || null, category: co.category || null, outfit: co, weatherAdaptation: adaptation };
    }
  }
  return null;
}

// ── TRAIT → CLOTHING PERCEPTION MAP ─────────────────────────────────────────
// Maps boolean trait flags on the CHARACTER object to clothing perception tendencies.
// Proof point: observer personality affects interpretation.
function buildTraitClothingProfile(observer) {
  if (!observer) return null;

  const notices = [];    // what this character naturally notices
  const lens = [];       // how they tend to interpret/react
  const suppressions = [];// what they DON'T usually do

  // ── FASHION-CONSCIOUS ──────────────────────────────────────────────────────
  if (observer.trait_bougie) {
    notices.push('expensive materials, luxury brands, designer labels, high-end accessories');
    lens.push('quickly judges quality and status signaling; more likely to compliment high-end outfits or express subtle disappointment in cheap clothing');
  }
  if (observer.is_photogenic || observer.trait_photogenic) {
    notices.push('how well an outfit photographs, styling and coordination, visual presentation');
    lens.push('thinks about aesthetics and "the look" of an outfit; notices whether it would photograph well');
  }
  if (observer.trait_self_absorbed) {
    notices.push('how clothing compares to their own style');
    lens.push('may relate almost any clothing observation back to themselves or their own fashion choices');
  }
  if (observer.trait_romanticizes) {
    notices.push('romantic or emotionally evocative clothing details — soft fabrics, colors, meaningful accessories');
    lens.push('assigns emotional meaning to outfits; may find a casual outfit beautiful if the moment feels right');
  }

  // ── ATTRACTION / FLIRTING ─────────────────────────────────────────────────
  if (observer.trait_flirty) {
    notices.push('outfits that are attractive, flattering, or confidence-projecting');
    lens.push('may notice attractive outfits more easily than others; not guaranteed to flirt but more likely to');
  }
  if (observer.trait_satyriasis) {
    notices.push('revealing or attention-drawing clothing');
    lens.push('strong internal response to certain outfits; whether they express it depends on context and personality mix');
  }
  if (observer.trait_insatiable) {
    notices.push('physical presentation and confidence in clothing choices');
    lens.push('drawn to how clothing expresses energy and confidence');
  }
  if (observer.trait_uninhibited) {
    notices.push('bold, daring, or unconventional clothing choices');
    lens.push('more likely to openly express any clothing observation without much filter');
  }
  if (observer.trait_philanderer) {
    notices.push('clothing that signals attraction or availability');
    lens.push('more alert to physical presentation; responses depend on relationship context');
  }

  // ── PROFESSIONAL / RULE-ORIENTED ─────────────────────────────────────────
  if (observer.trait_conscientious) {
    notices.push('whether clothing matches the location or occasion, proper attire, uniforms, dress codes');
    lens.push('internally evaluates appropriateness; more likely to notice (and quietly judge or mention) mismatched attire');
  }
  if (observer.trait_law_abiding || observer.trait_goody_two_shoes) {
    notices.push('uniform compliance, dress code violations, professional standards');
    lens.push('more likely to notice when someone is not following expected dress norms; may feel mild discomfort');
  }
  if (observer.trait_parental) {
    notices.push('whether clothing is appropriate, whether someone looks put-together, whether attire matches the situation');
    lens.push('may offer unsolicited but well-meaning feedback about appropriateness; genuinely wants others to present well');
  }
  if (observer.trait_leader) {
    notices.push('whether people under their responsibility are dressed appropriately');
    lens.push('may address dress-code noncompliance directly if they are responsible for others');
  }

  // ── CRITICAL / NEGATIVE ───────────────────────────────────────────────────
  if (observer.trait_blunt) {
    notices.push('anything that stands out — positively or negatively');
    lens.push('if they notice something, they may say it plainly without softening it');
  }
  if (observer.trait_cynical) {
    notices.push('mismatched effort, pretentiousness in clothing, trying too hard');
    lens.push('interprets ostentatious clothing through a skeptical lens; finds showing off mildly annoying');
  }
  if (observer.trait_rude) {
    notices.push('fashion choices that differ from their own taste');
    lens.push('may be dismissive or sarcastic about clothing choices they dislike');
  }
  if (observer.trait_toxic) {
    notices.push('clothing they can use for comparison, criticism, or manipulation');
    lens.push('more likely to make cutting remarks; may use clothing as a vector for put-downs');
  }
  if (observer.trait_competitive) {
    notices.push('when someone is dressed better or worse than them');
    lens.push('silently or openly compares to their own outfit; may feel good if they are dressed better');
  }

  // ── COMPASSIONATE / EMPATHETIC ────────────────────────────────────────────
  if (observer.trait_compassionate) {
    suppressions.push('does not embarrass people publicly about clothing');
    lens.push('if they notice something embarrassing (inside-out shirt, stain, missing button), they will quietly help rather than call attention');
  }
  if (observer.trait_empathetic) {
    notices.push('how someone feels in their clothing — comfortable, self-conscious, confident');
    lens.push('reads the emotional state behind the outfit choice; may notice discomfort or confidence in how someone wears something');
  }
  if (observer.trait_polite) {
    suppressions.push('unlikely to comment on unflattering clothing unless asked');
    lens.push('tends to hold clothing observations unless they are positive or necessary');
  }
  if (observer.trait_loyal) {
    notices.push('when someone close to them looks good or particularly put-together');
    lens.push('more likely to compliment close friends or partners on their outfits');
  }

  // ── RESERVED / HARD TO READ ───────────────────────────────────────────────
  if (observer.trait_hard_to_read) {
    suppressions.push('often notices clothing but says nothing — observation without expression');
    lens.push('internal reactions may be strong but external response is minimal or unreadable');
  }

  // ── CRIMINAL INSTINCT ─────────────────────────────────────────────────────
  if (observer.trait_criminal_mastermind || observer.trait_thief) {
    notices.push('expensive jewelry, luxury watches, designer handbags, high-value accessories');
    lens.push('notices these for reasons unrelated to fashion — assesses value and opportunity; does NOT necessarily say anything');
  }
  if (observer.trait_lawbreaker || observer.trait_rule_breaker) {
    notices.push('clothing that projects status or wealth');
    lens.push('opportunistic eye; clothing that signals money may register differently than to others');
  }

  // ── CREEP / BOUNDARY ISSUES ───────────────────────────────────────────────
  if (observer.trait_creep) {
    notices.push('clothing in ways that cross normal social boundaries');
    lens.push('observations about clothing may feel socially inappropriate in intensity or persistence; stays grounded in personality, not exaggerated');
  }

  // ── ENERGETIC / EXPRESSIVE ────────────────────────────────────────────────
  if (observer.trait_oversharer) {
    lens.push('more likely to verbalize clothing observations unprompted; will share opinions that no one asked for');
  }
  if (observer.trait_loud) {
    lens.push('clothing observations may come out louder and more expressively than intended');
  }

  return { notices, lens, suppressions };
}

// ── UNIFORM VISUAL STATUS RESOLVER ───────────────────────────────────────────
// Proof point: uniforms evaluated visually, not as a boolean flag.
function resolveVisualUniformStatus(wearingCharacter, locationRecord) {
  if (!wearingCharacter || !locationRecord) return null;

  const uniforms = locationRecord.uniforms || {};
  if (!uniforms || Object.keys(uniforms).length === 0) return null;

  const workerIds = locationRecord.worker_character_ids || [];
  const isWorker = workerIds.includes(wearingCharacter.id);
  const isInmate = locationRecord.category === 'jail_prison' && wearingCharacter.is_jailed;
  const isStudent = (locationRecord.category === 'school' || locationRecord.category === 'education')
    && wearingCharacter.education_location_id === locationRecord.id;

  if (!isWorker && !isInmate && !isStudent) return null;

  // Determine what the expected uniform is
  const jobTitle = locationRecord.worker_job_titles?.[wearingCharacter.id];
  let expectedUniform = null;
  for (const u of Object.values(uniforms)) {
    if (!u) continue;
    if (u.applicability === 'location_wide') { expectedUniform = u; break; }
    if (isInmate && u.applicability === 'role_status' && (u.role_status || '').toLowerCase() === 'inmate') { expectedUniform = u; break; }
    if (isStudent && u.applicability === 'role_status' && (u.role_status || '').toLowerCase() === 'student') { expectedUniform = u; break; }
    if (isWorker && jobTitle && u.applicability === 'job_title' && (u.job_title || '').toLowerCase() === jobTitle.toLowerCase()) { expectedUniform = u; break; }
    if (isWorker && u.applicability === 'generic_staff') { expectedUniform = u; break; }
  }

  if (!expectedUniform) return null;

  const uniformDesc = expectedUniform.description || expectedUniform.name || 'required uniform';

  // Compare what they're actually wearing to the expected uniform
  const outfitData = getOutfitText(wearingCharacter);
  const wearing = outfitData?.text || '';
  const uniformKeywords = uniformDesc.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const wearingLower = wearing.toLowerCase();

  // Simple heuristic: if the outfit mentions keywords from the uniform description it likely complies
  const matchCount = uniformKeywords.filter(k => wearingLower.includes(k)).length;
  const likelyCompliant = matchCount >= Math.min(2, uniformKeywords.length);

  // Check if wearing civilian/casual clothing when uniform is expected
  const casualKeywords = ['jeans', 'hoodie', 'sneakers', 'streetwear', 'casual', 't-shirt', 'shorts', 'pajama', 'lounge'];
  const wearingCasual = casualKeywords.some(k => wearingLower.includes(k));
  const likelyNonCompliant = wearingCasual && !likelyCompliant;

  return {
    uniformDescription: uniformDesc,
    locationName: locationRecord.name,
    role: isInmate ? 'inmate' : isStudent ? 'student' : 'worker',
    likelyCompliant,
    likelyNonCompliant,
    wearing: wearing || null,
  };
}

// ── CONTEXT APPROPRIATENESS EVALUATOR ────────────────────────────────────────
// Determines whether clothing is contextually appropriate, inappropriate, or neutral.
function evaluateContextAppropriateness(outfitCategory, locationCategory, presenceStatus, activity) {
  if (!outfitCategory) return 'neutral';

  const actLower = (activity || '').toLowerCase();
  const locCat = (locationCategory || '').toLowerCase();
  const presence = (presenceStatus || '').toLowerCase();

  // Clearly appropriate combinations
  const appropriate = [
    (outfitCategory === 'gym' && (locCat === 'gym' || actLower.includes('workout'))),
    (outfitCategory === 'work' && (presence === 'at_work' || locCat === 'workplace')),
    (outfitCategory === 'sleepwear' && (presence === 'sleeping' || presence === 'napping' || locCat === 'home')),
    (outfitCategory === 'lounge' && locCat === 'home'),
    (outfitCategory === 'church' && locCat === 'religion'),
    (outfitCategory === 'school' && (locCat === 'school' || presence === 'at_school')),
    (outfitCategory === 'swimwear' && (actLower.includes('pool') || actLower.includes('beach'))),
    (outfitCategory === 'formal' && (actLower.includes('wedding') || actLower.includes('gala') || actLower.includes('graduation'))),
  ];

  // Contextually unexpected combinations
  const unexpected = [
    (outfitCategory === 'sleepwear' && (locCat === 'workplace' || locCat === 'social' || locCat === 'food_drink')),
    (outfitCategory === 'gym' && locCat === 'religion'),
    (outfitCategory === 'swimwear' && (locCat === 'workplace' || locCat === 'religion' || locCat === 'food_drink')),
    (outfitCategory === 'lounge' && locCat === 'workplace'),
    (outfitCategory === 'bath' && (locCat !== 'home')),
  ];

  if (appropriate.some(Boolean)) return 'appropriate';
  if (unexpected.some(Boolean)) return 'unexpected';
  return 'neutral';
}

// ── MEMORABILITY EVALUATOR ────────────────────────────────────────────────────
// Proof point: ordinary outfits not auto-stored as memories — only memorable events qualify.
function evaluateMemorability(outfitData, contextualSignificance) {
  if (!outfitData) return false;
  const { category, label } = outfitData;
  const labelLower = (label || '').toLowerCase();

  // Memorable outfit contexts only
  const memorableCategories = ['formal', 'date_night', 'church', 'special'];
  const memorableKeywords = ['wedding', 'graduation', 'prom', 'gala', 'funeral', 'anniversary', 'memorial', 'ceremony'];

  const categoryMemory = memorableCategories.includes(category);
  const keywordMemory = memorableKeywords.some(k => labelLower.includes(k));
  const contextSignificant = contextualSignificance === 'special_occasion';

  // Ordinary daily wear is NEVER memorable
  const ordinaryCategories = ['daily_casual', 'lounge', 'outdoor', 'gym'];
  if (ordinaryCategories.includes(category) && !keywordMemory) return false;

  return categoryMemory || keywordMemory || contextSignificant;
}

// ── MAIN BUILDER ─────────────────────────────────────────────────────────────

/**
 * buildClothingAwarenessContext
 *
 * Builds an optional clothing perception context block for LLM injection.
 * Returns an empty string when there is nothing meaningful to inject
 * (no outfit data, no co-present character, no relevant traits).
 *
 * @param {object} observingCharacter    - The character receiving the prompt (the observer)
 * @param {object[]} coPresent           - Other characters confirmed physically present (from buildHouseholdCoPresenceContext sources)
 * @param {object|null} currentLocation  - LocationReference record of the current location (optional)
 * @param {string|null} activityText     - Current activity or message context (optional)
 * @param {string|null} contextualSignificance - 'special_occasion' | null
 * @returns {string}
 */
export function buildClothingAwarenessContext(
  observingCharacter,
  coPresent = [],
  currentLocation = null,
  activityText = null,
  contextualSignificance = null,
  weatherCache = null,
) {
  if (!observingCharacter) return '';

  const locationCategory = currentLocation?.category || null;
  const locationName = currentLocation?.name || null;

  // ── COLLECT VISIBLE OUTFITS ───────────────────────────────────────────────
  // What the observer can actually see — co-present characters' clothing.
  // Weather adaptation is applied inside getOutfitText so the visible text
  // reflects what is actually being worn right now, not the full outfit.
  // PROOF POINT 7: characters never react to clothing that has already been removed.
  const visibleOutfits = [];
  for (const other of coPresent) {
    if (!other || other.id === observingCharacter.id) continue;
    const name = other.display_name || other.name;
    if (!name) continue;

    // Determine if this character is a worker at the current location (for uniform check)
    const isWorkerHere = currentLocation?.worker_character_ids?.includes(other.id) || false;
    const outfitData = getOutfitText(other, weatherCache, currentLocation, isWorkerHere);
    if (!outfitData?.text) continue;

    const contextFit = evaluateContextAppropriateness(
      outfitData.category,
      locationCategory,
      other.resolved_presence_status,
      activityText || other.current_activity
    );

    const uniformStatus = resolveVisualUniformStatus(other, currentLocation);
    const memorable = evaluateMemorability(outfitData, contextualSignificance);

    visibleOutfits.push({
      name,
      outfitText: outfitData.text,
      outfitLabel: outfitData.label,
      outfitCategory: outfitData.category,
      contextFit,
      uniformStatus,
      memorable,
      weatherAdaptationNote: buildWeatherAdaptationNote(outfitData.weatherAdaptation),
    });
  }

  // If nothing is visible, skip the block entirely
  if (visibleOutfits.length === 0) return '';

  // ── OBSERVER TRAIT PROFILE ────────────────────────────────────────────────
  const traitProfile = buildTraitClothingProfile(observingCharacter);

  // ── BUILD PROMPT BLOCK ────────────────────────────────────────────────────
  const lines = [];
  lines.push(`════════════════════════════════════`);
  lines.push(`VISUAL CLOTHING AWARENESS — WHAT YOU CAN SEE RIGHT NOW`);
  lines.push(`════════════════════════════════════`);
  lines.push(`You are at ${locationName || 'a shared location'} with other people.`);
  lines.push(`You can naturally observe what those around you are wearing.`);
  lines.push(`Whether you react, comment, or simply notice is entirely up to your personality.`);
  lines.push(`DO NOT force clothing commentary. Most interactions will contain none at all.`);
  lines.push(``);

  // Visible outfits
  for (const v of visibleOutfits) {
    lines.push(`━━ VISIBLE: ${v.name}'s clothing ━━`);
    lines.push(`What they are wearing: ${v.outfitText}`);
    if (v.outfitLabel) lines.push(`Outfit name (internal reference): ${v.outfitLabel}`);

    // Weather adaptation note — what they've removed due to weather
    if (v.weatherAdaptationNote) {
      lines.push(`Weather adaptation: ${v.weatherAdaptationNote}`);
    }

    // Context appropriateness
    if (v.contextFit === 'appropriate') {
      lines.push(`Context fit: Their clothing matches the current setting and activity — nothing unusual.`);
    } else if (v.contextFit === 'unexpected') {
      lines.push(`Context fit: Their clothing seems mismatched for this setting — this may or may not be worth noting depending on your personality.`);
    }

    // Uniform evaluation
    if (v.uniformStatus) {
      lines.push(`UNIFORM CONTEXT at ${v.uniformStatus.locationName}:`);
      lines.push(`  Expected: ${v.uniformStatus.uniformDescription} (they are a ${v.uniformStatus.role} here)`);
      if (v.uniformStatus.likelyCompliant) {
        lines.push(`  Visual assessment: Their clothing appears to match the required uniform.`);
      } else if (v.uniformStatus.likelyNonCompliant) {
        lines.push(`  Visual assessment: Their clothing does NOT appear to match the required uniform.`);
        lines.push(`  You may notice this depending on your role, traits, and relationship. You are NOT required to address it.`);
      } else {
        lines.push(`  Visual assessment: You cannot easily tell whether they are in uniform or not.`);
      }
    }

    // Memorability hint
    if (v.memorable) {
      lines.push(`Memory note: This outfit is being worn for a significant occasion. It may be worth remembering later.`);
    }
    lines.push(``);
  }

  // Observer trait framing
  if (traitProfile && (traitProfile.notices.length > 0 || traitProfile.lens.length > 0)) {
    lines.push(`━━ HOW YOUR PERSONALITY AFFECTS WHAT YOU NOTICE ━━`);

    if (traitProfile.notices.length > 0) {
      lines.push(`Based on your traits, you tend to notice:`);
      lines.push(traitProfile.notices.slice(0, 4).map(n => `• ${n}`).join('\n'));
    }

    if (traitProfile.lens.length > 0) {
      lines.push(`How you tend to interpret or respond to clothing:`);
      lines.push(traitProfile.lens.slice(0, 4).map(l => `• ${l}`).join('\n'));
    }

    if (traitProfile.suppressions.length > 0) {
      lines.push(`Your natural tendencies work against:`);
      lines.push(traitProfile.suppressions.map(s => `• ${s}`).join('\n'));
    }
    lines.push(``);
  }

  // Final directive
  lines.push(`━━ CLOTHING PERCEPTION RULES ━━`);
  lines.push(`• Observation is automatic — you see what people are wearing.`);
  lines.push(`• Commentary is NOT automatic — react only when it feels natural for YOUR personality.`);
  lines.push(`• If the current conversation has nothing to do with appearance, say nothing about clothing.`);
  lines.push(`• If clothing is relevant to the moment (a compliment fits, a uniform violation matters to you, something is genuinely noticeable), you may reference it naturally.`);
  lines.push(`• Different characters observing the same outfit will react differently — your reaction comes from YOUR traits, not a script.`);
  lines.push(`• Relationship matters: you notice a partner's outfit differently than a stranger's.`);
  lines.push(`• Ordinary daily clothing should rarely if ever become a memory. Special-occasion outfits may.`);
  lines.push(`════════════════════════════════════`);

  return '\n\n' + lines.join('\n');
}

/**
 * buildSelfClothingAwareness
 *
 * Injects a minimal block telling the character what THEY are wearing right now.
 * Keeps them grounded and prevents them from describing themselves incorrectly in images
 * or ignoring their own outfit in conversations about appearance.
 *
 * @param {object} character - The character receiving the prompt
 * @param {string|null} contextualSignificance - 'special_occasion' | null
 * @returns {string}
 */
export function buildSelfClothingAwareness(character, contextualSignificance = null, weatherCache = null, currentLocation = null) {
  if (!character) return '';

  // Determine if character is a worker at current location (for uniform check)
  const isWorkerHere = currentLocation?.worker_character_ids?.includes(character.id) || false;
  const outfitData = getOutfitText(character, weatherCache, currentLocation, isWorkerHere);
  if (!outfitData?.text) return '';

  const contextLabel = contextualSignificance === 'special_occasion'
    ? ' (special occasion attire)'
    : '';

  // Include weather adaptation note so the character knows what they've removed
  const weatherNote = buildWeatherAdaptationNote(outfitData.weatherAdaptation);
  const weatherSuffix = weatherNote ? ` ${weatherNote}` : '';

  return `\n\nYOUR CURRENT OUTFIT: You are currently wearing: ${outfitData.text}${contextLabel}.${weatherSuffix} Reference this if discussing your appearance or when sending images of yourself.`;
}