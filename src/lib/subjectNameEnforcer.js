/**
 * subjectNameEnforcer.js
 *
 * Ensures the resolved subject's real name appears in the final image prompt.
 * Extracted from Chat.jsx to reduce file size.
 *
 * Rules:
 *   "[CHARACTER] sitting at the table"  → "[CHARACTER] Vick Servicio sitting at the table"
 *   "[character] sitting at the table"  → "[character] Vick Servicio sitting at the table"
 *   "sitting at the table"              → "[CHARACTER] Vick Servicio sitting at the table"
 *   "[CHARACTER] Vick Servicio sitting" → unchanged (name already present)
 *   "[Joint] X and Y together"          → validated that both names are present
 *
 * For multi-subject: every resolved subject name must appear.
 */
export function enforceSubjectNamesInPrompt(prompt, resolvedPrimaryName, resolvedAdditionalNames = []) {
  if (!resolvedPrimaryName) return prompt; // inanimate or no-subject — leave unchanged

  let result = prompt;
  const allSubjectNames = [resolvedPrimaryName, ...resolvedAdditionalNames].filter(Boolean);

  // Check if each resolved name is already present in the prompt (case-insensitive)
  const promptLowerCheck = result.toLowerCase();
  const allNamesPresent = allSubjectNames.every(name =>
    promptLowerCheck.includes(name.toLowerCase())
  );

  if (allNamesPresent) return result; // already correct

  // Single or primary subject: fix the [character] tag or prepend
  const primaryNameInPrompt = promptLowerCheck.includes(resolvedPrimaryName.toLowerCase());

  if (!primaryNameInPrompt) {
    // Replace "[CHARACTER]", "[character]", "[Character]" (tag only) with "[CHARACTER] Name"
    const taggedReplace = result.replace(/^\[character\]/i, `[CHARACTER] ${resolvedPrimaryName}`);
    if (taggedReplace !== result) {
      result = taggedReplace;
    } else if (/^\[character\]/i.test(result.trim())) {
      // Handles whitespace edge cases
      result = result.trim().replace(/^\[character\]/i, `[CHARACTER] ${resolvedPrimaryName}`);
    } else if (!result.match(/^\[CHARACTER\]/i)) {
      // No tag at all — prepend the full subject header
      result = `[CHARACTER] ${resolvedPrimaryName} ${result}`;
    } else {
      // Tag present but name not following — inject name right after tag
      result = result.replace(/(\[CHARACTER\])\s*/i, `$1 ${resolvedPrimaryName} `);
    }
    console.log(`[SubjectNameEnforcement] Injected primary name "${resolvedPrimaryName}" into prompt`);
  }

  // Multi-subject: ensure additional names are present too
  if (resolvedAdditionalNames.length > 0) {
    const resultLower = result.toLowerCase();
    const missingNames = resolvedAdditionalNames.filter(
      name => !resultLower.includes(name.toLowerCase())
    );
    if (missingNames.length > 0) {
      // Append missing co-subject names before the action phrase
      // e.g. "and [Name]" inserted after primary subject name
      const insertAfter = resolvedPrimaryName;
      const insertIdx = result.toLowerCase().indexOf(insertAfter.toLowerCase()) + insertAfter.length;
      const before = result.slice(0, insertIdx);
      const after = result.slice(insertIdx);
      result = `${before} and ${missingNames.join(' and ')}${after}`;
      console.log(`[SubjectNameEnforcement] Injected co-subject name(s) [${missingNames.join(', ')}] into prompt`);
    }
  }

  console.log(`[SubjectNameEnforcement] Final prompt: "${result.substring(0, 120)}"`);
  return result;
}