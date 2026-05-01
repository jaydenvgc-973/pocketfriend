/**
 * CAMERA MOVEMENT VALIDATOR
 * 
 * Enforces that camera position, angle, distance, height, and framing change
 * between successive image generations.
 * 
 * RULE: At least 2 camera variables must differ from the previous generation.
 * If not → automatic regeneration with forced variation.
 */

/**
 * Extract camera variables from generation context or previous message.
 * Returns an object with: distance, angle, height, framing, lens_style
 */
export function extractCameraVariables(generationContext) {
  if (!generationContext) return null;

  const prompt = (generationContext.prompt || '').toLowerCase();
  
  // Distance detection
  let distance = 'medium'; // default
  if (prompt.includes('wide shot') || prompt.includes('establishing shot') || prompt.includes('full body')) {
    distance = 'wide';
  } else if (prompt.includes('close-up') || prompt.includes('tight') || prompt.includes('face')) {
    distance = 'close';
  }

  // Angle detection
  let angle = 'straight'; // default
  if (prompt.includes('high-angle') || prompt.includes('overhead') || prompt.includes('from above')) {
    angle = 'high';
  } else if (prompt.includes('low-angle') || prompt.includes('from below') || prompt.includes('looking up')) {
    angle = 'low';
  } else if (prompt.includes('tilted') || prompt.includes('diagonal')) {
    angle = 'tilted';
  } else if (prompt.includes('over-shoulder') || prompt.includes('over the shoulder')) {
    angle = 'over-shoulder';
  } else if (prompt.includes('side angle') || prompt.includes('from the side')) {
    angle = 'side';
  }

  // Height detection
  let height = 'eye-level'; // default
  if (prompt.includes('standing') && !prompt.includes('looking down')) {
    height = 'eye-level';
  } else if (prompt.includes('seated') || prompt.includes('sitting')) {
    height = 'seated';
  } else if (prompt.includes('from above')) {
    height = 'high';
  }

  // Framing detection
  let framing = 'standard'; // default
  if (prompt.includes('off-center') || prompt.includes('asymmetrical')) {
    framing = 'off-center';
  } else if (prompt.includes('cropped') || prompt.includes('partial')) {
    framing = 'cropped';
  } else if (prompt.includes('wide framing') || prompt.includes('environmental')) {
    framing = 'environmental';
  } else if (prompt.includes('tight') || prompt.includes('headshot')) {
    framing = 'headshot';
  }

  // Lens detection
  let lens_style = 'standard';
  if (prompt.includes('selfie') || prompt.includes('phone')) {
    lens_style = 'phone';
  } else if (prompt.includes('wide-angle') || prompt.includes('fisheye')) {
    lens_style = 'wide-angle';
  } else if (prompt.includes('telephoto') || prompt.includes('zoom')) {
    lens_style = 'telephoto';
  } else if (prompt.includes('cinematic')) {
    lens_style = 'cinematic';
  }

  return {
    distance,
    angle,
    height,
    framing,
    lens_style,
    raw_prompt: generationContext.prompt,
  };
}

/**
 * Compare two camera states and count how many variables differ.
 * Returns the count of differences and which variables changed.
 */
export function compareCameraStates(previousCamera, newCamera) {
  if (!previousCamera || !newCamera) return { diffCount: 5, changed: ['distance', 'angle', 'height', 'framing', 'lens_style'] };

  const changed = [];
  if (previousCamera.distance !== newCamera.distance) changed.push('distance');
  if (previousCamera.angle !== newCamera.angle) changed.push('angle');
  if (previousCamera.height !== newCamera.height) changed.push('height');
  if (previousCamera.framing !== newCamera.framing) changed.push('framing');
  if (previousCamera.lens_style !== newCamera.lens_style) changed.push('lens_style');

  return {
    diffCount: changed.length,
    changed,
    previousCamera,
    newCamera,
  };
}

/**
 * Validate that camera movement is sufficient.
 * Requires at least 2 variables to have changed.
 */
export function validateCameraMovement(previousCamera, newCamera) {
  const comparison = compareCameraStates(previousCamera, newCamera);
  const isValid = comparison.diffCount >= 2;
  
  return {
    isValid,
    comparison,
    failureReason: isValid ? null : `Only ${comparison.diffCount} camera variable(s) changed: ${comparison.changed.join(', ')}. Minimum 2 required.`,
  };
}

/**
 * Generate a forced camera override prompt that ensures variation.
 * Used when regenerating due to insufficient camera movement.
 */
export function generateCameraOverride(previousCamera) {
  if (!previousCamera) {
    return "vary camera widely: close-up overhead angle, off-center framing";
  }

  // Force at least 2-3 variables to change
  const overrides = [];

  // Force distance change
  if (previousCamera.distance === 'close') {
    overrides.push('WIDE SHOT from across the room');
  } else if (previousCamera.distance === 'wide') {
    overrides.push('CLOSE-UP, face and shoulders');
  } else {
    overrides.push('MEDIUM shot, slight off-center framing');
  }

  // Force angle change
  if (previousCamera.angle === 'straight') {
    overrides.push('from a HIGH angle, looking DOWN at the subject');
  } else if (previousCamera.angle === 'high') {
    overrides.push('from a LOW angle, looking UP at the subject');
  } else if (previousCamera.angle === 'side') {
    overrides.push('OVER-SHOULDER angle, behind and slightly to the side');
  } else {
    overrides.push('SIDE angle, perpendicular to previous');
  }

  // Force framing change
  if (previousCamera.framing === 'centered' || previousCamera.framing === 'standard') {
    overrides.push('deliberately OFF-CENTER composition, asymmetrical');
  } else if (previousCamera.framing === 'off-center') {
    overrides.push('ENVIRONMENTAL framing, full body and surroundings visible');
  } else {
    overrides.push('TIGHT CROPPING, partial body in frame');
  }

  return `
MANDATORY CAMERA MOVEMENT (previous: ${previousCamera.distance} ${previousCamera.angle}):
${overrides.join(' + ')}
Do NOT repeat the previous image composition.`;
}

/**
 * Check if the generation context looks like a selfie/first-person perspective.
 */
export function isSelfieContext(generationContext) {
  if (!generationContext || !generationContext.prompt) return false;
  const prompt = generationContext.prompt.toLowerCase();
  return /selfie|self-?portrait|phone selfie|smartphone|cell phone|holding phone|camera in hand|taken.*phone/.test(prompt);
}