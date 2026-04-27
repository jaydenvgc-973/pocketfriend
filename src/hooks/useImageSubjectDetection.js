/**
 * Detect image subject type (character, user, or joint) from user's prompt text
 * CRITICAL: Recognizes user's fictional world name as an avatar request
 */
export function useImageSubjectDetection(text, userSettings) {
  const msgLower = text.toLowerCase();
  const worldNameLower = userSettings?.fictional_world_name?.toLowerCase() || '';
  const worldNameInPrompt = worldNameLower && msgLower.includes(worldNameLower);
  
  const isJointRequest = /\b(us|together|both|with (you and me|me and you|each other)|the two of us|selfie with (me|you))\b/i.test(msgLower);
  const isUserRequest = !isJointRequest && (
    worldNameInPrompt || // CRITICAL: user's world name in prompt = user avatar request
    /\b(pic|photo|picture|image|selfie|shot)\s*(of me|of myself)\b/i.test(msgLower) ||
    /\b(send|show|give|share)\s*(me\s*)?(a\s*)?(pic|photo|picture|selfie)\s*(of me|of myself)\b/i.test(msgLower) ||
    /\bpicture of me\b|\bphoto of me\b|\bpic of me\b/i.test(msgLower)
  );
  
  return isJointRequest ? "joint" : isUserRequest ? "user" : "character";
}