# Closet Outfit Lock - Mandatory Production Fix

## Problem Statement

Generated images violate closet outfit requirements and are accepted as valid.

Example: Khalil's outfit requires "No shirt / bare torso" but the generated image shows a tank top. Vision validation said it was valid. It is not.

**Root cause**: Vision API hallucination + prompt-only enforcement is insufficient.

## Why Vision Validation Doesn't Work

The vision LLM:
- Hallucinates about image content
- Cannot reliably detect clothing presence
- Says "bare torso confirmed" when tank top is visible
- Is subjective and inconsistent

**Vision-based validation will never be reliable for this use case.**

## New Approach: Hyper-Explicit Prompt + Aggressive Regeneration

Instead of post-generation validation, the fix is:

1. **Make the prompt SO explicit** that the generator physically cannot produce clothing
2. **Inject phrase repetition** ("BARE TORSO" repeated 10+ times in different ways)
3. **Use direct blocking language** ("Do NOT render a shirt" + "Do NOT render a tank top" + specific item lists)
4. **Escalate on failure** - if an image is generated, check basic properties (loads, is real image, is not placeholder)
5. **Regenerate with escalated prompt** if basic checks fail
6. **Max 3 attempts** - if all fail, reject explicitly

## Updated Pipeline

For any image generation with a closet outfit lock:

```
Step 1: Resolve outfit from canonical source (character.current_outfit)
Step 2: Normalize outfit text (e.g., "n/a" → remove, "shirtless" → "No shirt / bare torso")
Step 3: Build final prompt with HYPER-EXPLICIT closet lock block
Step 4: Generate image (Attempt N)
Step 5: Check if image exists and is valid file (basic sanity check)
Step 6: If basic check fails → escalate prompt and retry
Step 7: If max retries exceeded → reject with error, do NOT accept invalid image
Step 8: Store metadata: closet_outfit_resolved, closet_lock_in_prompt, attempt_number
```

## Hyper-Explicit Closet Lock Block

For bare torso requirement:

```
🚫🚫🚫 BARE TORSO — ABSOLUTELY CRITICAL 🚫🚫🚫

BARE TORSO. BARE TORSO. BARE TORSO. BARE TORSO. BARE TORSO.

The character MUST have a completely bare chest and upper body with ZERO upper-body clothing.

FORBIDDEN ITEMS (absolutely do not render):
  ⛔ Shirt (any type)
  ⛔ Tank top (even sleeveless)
  ⛔ T-shirt
  ⛔ Long-sleeve top
  ⛔ Short-sleeve top
  ⛔ Bra
  ⛔ Undershirt
  ⛔ Thermal top
  ⛔ Hoodie
  ⛔ Jacket
  ⛔ Coat
  ⛔ Robe
  ⛔ Vest
  ⛔ Sweater
  ⛔ Cardigan
  ⛔ Blazer
  ⛔ Any fabric covering the torso

REQUIRED VISUAL STATE:
  ✅ Chest completely exposed
  ✅ Abdomen completely exposed
  ✅ Upper back completely exposed
  ✅ No clothing on torso whatsoever
  ✅ This is a shirtless, bare-torso image

FAILURE CONDITION:
  If ANY upper-body clothing appears, the image is wrong.
  If a shirt/tank/hoodie/jacket is visible, the image fails the closet lock.
```

## Integration Requirements

This fix MUST be applied to ALL image generation paths:

- [ ] Chat image generation (generateImageAsync)
- [ ] Character-sent images (autonomous)
- [ ] Media Grid single image
- [ ] Media Grid multi-person
- [ ] Scene page images
- [ ] Residential scene images
- [ ] User image generation
- [ ] Joint user-character images
- [ ] Travel images
- [ ] Relationship images
- [ ] Memory Reel images
- [ ] Profile/header/banner images

## NOT Optional

This is not a feature flag or optional path.

- Every image with a closet outfit must go through the hyper-explicit prompt
- Every image must have basic sanity checks
- Every image must track whether outfit was enforced
- Invalid images must be rejected with visible error, not silently accepted

## Validation Metadata to Store

```json
{
  "closet_outfit_enforced": {
    "outfit_resolved": true,
    "outfit_text": "No shirt / bare torso, Grey sweatpants, White sneakers",
    "lock_injected_in_prompt": true,
    "attempt_number": 1,
    "max_attempts": 3,
    "basic_checks_passed": true,
    "validation_method": "prompt_enforcement"
  }
}
```

## Success Criteria

- [ ] Image generated with bare torso requirement shows bare torso
- [ ] Image generated with specific pants shows those pants
- [ ] Image generated with specific shoes shows those shoes
- [ ] Invalid images are rejected and regenerated (not silently accepted)
- [ ] Metadata tracks that closet lock was enforced
- [ ] All generation paths use the same enforcement logic