/**
 * SchoolContaminationProof
 * 
 * End-to-end proof page for school location contamination fix.
 * Runs as the authenticated user so all entity reads succeed under real RLS.
 * 
 * Route: /school-contamination-proof
 */
import { useState } from "react";
import { base44 } from "@/api/base44Client";

const CHARACTER_ID = "69c0d59d7e382cc866ded9c9";
const SCHOOL_ID    = "6a15195adff656b2fd5b55a6";
const HOME_ID      = "69d03c56a5e65c211c8a6105";

export default function SchoolContaminationProof() {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [messageId, setMessageId] = useState(null);

  function addLog(text, type = "info") {
    const ts = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: true });
    setLog(prev => [...prev, { ts, text, type }]);
  }

  async function runProof() {
    setLog([]);
    setVerdict(null);
    setMessageId(null);
    setRunning(true);

    const chainResults = {};

    try {
      // ── STEP 1: Read character ──────────────────────────────────────────────
      addLog("STEP 1: Reading character record...", "info");
      const chars = await base44.entities.Character.filter({ id: CHARACTER_ID }, null, 1);
      const char = chars?.[0];
      if (!char) { addLog("❌ Character not found", "error"); setRunning(false); return; }

      const presenceStatus  = char.resolved_presence_status || char.location_status || "unknown";
      const resolvedLocId   = char.resolved_current_location_id || null;
      const resolvedLocName = char.resolved_current_location_name || null;
      const studentStatus   = char.student_status || "not_student";
      const travelingToId   = char.traveling_to_location_id || null;

      addLog(`  name:                       ${char.name}`, "data");
      addLog(`  presence_status:            ${presenceStatus}`, "data");
      addLog(`  student_status:             ${studentStatus}`, "data");
      addLog(`  resolved_current_location_id:   ${resolvedLocId || "null"}`, "data");
      addLog(`  resolved_current_location_name: ${resolvedLocName || "null"}`, "data");
      addLog(`  current_home_location_id:   ${char.current_home_location_id || "null"}`, "data");
      addLog(`  education_location_id:      ${char.education_location_id || "null"}`, "data");
      addLog(`  traveling_to_location_id:   ${travelingToId || "null"}`, "data");

      // ── STEP 2: Presence vs enrollment check ───────────────────────────────
      addLog("", "spacer");
      addLog("STEP 2: Enrollment vs presence check", "info");
      chainResults["enrolled_not_at_school"] = studentStatus === "enrolled" && presenceStatus !== "at_school";
      chainResults["presence_is_home"] = ["home","sleeping","napping"].includes(presenceStatus);
      addLog(`  enrolled=true, at_school=false: ${chainResults.enrolled_not_at_school ? "✅ YES — school must not be used" : "❌ NO"}`, chainResults.enrolled_not_at_school ? "pass" : "fail");
      addLog(`  presence is home:               ${chainResults.presence_is_home ? "✅ YES" : "❌ NO ("+presenceStatus+")"}`, chainResults.presence_is_home ? "pass" : "fail");

      // ── STEP 3: resolved_current_location_id pollution ─────────────────────
      addLog("", "spacer");
      addLog("STEP 3: Is resolved_current_location_id polluted with school ID?", "info");
      const resolvedIsSchool = resolvedLocId === SCHOOL_ID;
      const resolvedIsHome   = resolvedLocId === HOME_ID;
      chainResults["source_was_polluted"] = resolvedIsSchool;
      addLog(`  resolved_loc equals school_id: ${resolvedIsSchool ? "⚠️ YES — POLLUTED INPUT" : "✅ NO"}`, resolvedIsSchool ? "warn" : "pass");
      addLog(`  resolved_loc equals home_id:   ${resolvedIsHome ? "✅ YES — clean" : "❌ NO"}`, resolvedIsHome ? "pass" : "fail");

      // ── STEP 4: Find conversation ───────────────────────────────────────────
      addLog("", "spacer");
      addLog("STEP 4: Finding direct conversation...", "info");
      const convos = await base44.entities.Conversation.filter(
        { character_ids: CHARACTER_ID, type: "direct" }, "-last_message_date", 10
      );
      const directConvo = convos?.find(c =>
        Array.isArray(c.character_ids) && c.character_ids.length === 1 &&
        !c.shared_conversation_key && c.channel !== "world_phone"
      );
      if (!directConvo) {
        addLog("❌ No direct conversation found — open chat first", "error");
        setRunning(false); return;
      }
      addLog(`  conversation_id: ${directConvo.id}`, "data");

      // ── STEP 5: Create placeholder message ─────────────────────────────────
      addLog("", "spacer");
      addLog("STEP 5: Creating fresh placeholder message...", "info");
      const placeholder = await base44.entities.Message.create({
        conversation_id: directConvo.id,
        sender_type: "character",
        character_id: CHARACTER_ID,
        character_name: char.name,
        content: "",
        timestamp: new Date().toISOString(),
        is_read: false,
      });
      const newMsgId = placeholder.id;
      setMessageId(newMsgId);
      addLog(`  message_id: ${newMsgId}`, "data");
      addLog(`  ✅ Placeholder created — this is the ID we will verify end-to-end`, "pass");

      // ── STEP 6: Invoke generateImageAsync ──────────────────────────────────
      addLog("", "spacer");
      addLog("STEP 6: Invoking generateImageAsync with this message ID...", "info");
      addLog(`  character_id: ${CHARACTER_ID}`, "data");
      addLog(`  resolved_current_location_id (polluted input): ${resolvedLocId}`, "data");
      addLog(`  home_id (expected output): ${HOME_ID}`, "data");

      const refImages = (char.reference_image_urls || [])
        .filter(u => u && u.startsWith("https://media.base44.com/") && !u.includes("generated_image"))
        .slice(0, 3);
      addLog(`  reference images: ${refImages.length}`, "data");

      const user = await base44.auth.me();
      const genStart = Date.now();
      let genRes = null;
      let genError = null;
      try {
        genRes = await base44.functions.invoke("generateImageAsync", {
          messageId: newMsgId,
          prompt: "[CHARACTER] standing in the living room zone, looking relaxed at home. Medium shot from across the room.",
          subjectType: "character",
          characterId: CHARACTER_ID,
          characterName: char.name,
          characterReferenceImages: refImages,
          userReferenceImages: [],
          ownerEmail: user.email,
        });
        genRes = genRes?.data;
      } catch(e) { genError = e.message; }

      addLog(`  duration: ${Date.now() - genStart}ms`, "data");
      if (genError) {
        addLog(`  ⚠️ generateImageAsync threw: ${genError}`, "warn");
        addLog(`  (Continuing to check what was saved in generation_context...)`, "info");
      } else {
        addLog(`  response.success: ${genRes?.success}`, genRes?.success ? "pass" : "warn");
        addLog(`  response.locationName: ${genRes?.locationName || "null"}`, "data");
        addLog(`  response.zoneName: ${genRes?.zoneName || "null"}`, "data");
      }

      // ── STEP 7: Poll for the saved message ────────────────────────────────
      addLog("", "spacer");
      addLog("STEP 7: Polling for saved message record...", "info");
      let savedMsg = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const msgs = await base44.entities.Message.filter({ id: newMsgId }, null, 1).catch(() => []);
        savedMsg = msgs?.[0];
        if (savedMsg?.image_url || savedMsg?.content === "[IMAGE_FAILED]") {
          addLog(`  Found after ${(i+1)*3}s`, "data");
          break;
        }
        addLog(`  Polling... attempt ${i+1}`, "info");
      }
      if (!savedMsg) {
        addLog("❌ Message not found after polling", "error");
        setRunning(false); return;
      }

      // ── STEP 8: Verify generation_context ────────────────────────────────
      addLog("", "spacer");
      addLog("STEP 8: Verifying generation_context on saved message", "info");

      chainResults["message_id_consistent"] = savedMsg.id === newMsgId;
      addLog(`  message_id matches placeholder: ${chainResults.message_id_consistent ? "✅ YES" : "❌ NO"}`, chainResults.message_id_consistent ? "pass" : "fail");
      addLog(`  has image_url: ${!!savedMsg.image_url}`, "data");
      addLog(`  content: "${savedMsg.content || "(empty)"}"`, "data");

      const gc = savedMsg.generation_context || {};
      const savedLocId   = gc.location_id   || null;
      const savedLocName = gc.location_name  || null;
      const savedLocCat  = gc.loc_category   || null;
      const savedZone    = gc.zone_name      || null;

      addLog("", "spacer");
      addLog("  generation_context fields:", "info");
      addLog(`    location_id:   ${savedLocId   || "null"}`, "data");
      addLog(`    location_name: ${savedLocName || "null"}`, "data");
      addLog(`    loc_category:  ${savedLocCat  || "null"}`, "data");
      addLog(`    zone_name:     ${savedZone    || "null"}`, "data");

      const locIdIsSchool = savedLocId === SCHOOL_ID;
      const locIdIsHome   = savedLocId === HOME_ID;
      const locNameIsSchool = savedLocName && (
        savedLocName.toLowerCase().includes("university") ||
        savedLocName.toLowerCase().includes("college") ||
        savedLocName.toLowerCase().includes("aurelian")
      );

      chainResults["layer4_rejected_school"] = !locIdIsSchool;
      chainResults["saved_loc_id_is_home"]   = locIdIsHome;
      chainResults["saved_loc_name_not_school"] = !locNameIsSchool;

      addLog("", "spacer");
      addLog("  Verification:", "info");
      addLog(`    location_id == school_id: ${locIdIsSchool ? "❌ FAIL — school contamination present" : "✅ PASS — not school ID"}`, locIdIsSchool ? "fail" : "pass");
      addLog(`    location_id == home_id:   ${locIdIsHome ? "✅ PASS — correctly resolved to home" : "❌ FAIL — not home ID ("+savedLocId+")"}`, locIdIsHome ? "pass" : "fail");
      addLog(`    location_name has 'university'/'college'/'aurelian': ${locNameIsSchool ? "❌ FAIL — school name in context" : "✅ PASS"}`, locNameIsSchool ? "fail" : "pass");

      // ── STEP 9: Full chain ────────────────────────────────────────────────
      addLog("", "spacer");
      addLog("STEP 9: FULL CHAIN RESULT", "info");
      const allPass = Object.values(chainResults).every(Boolean);

      Object.entries(chainResults).forEach(([k, v]) => {
        addLog(`  ${v ? "✅" : "❌"} ${k}: ${v}`, v ? "pass" : "fail");
      });

      addLog("", "spacer");
      if (allPass) {
        addLog("✅ PROVEN — Layer 4 guard correctly intercepted polluted school ID.", "pass");
        addLog("   Saved generation_context.location_id = home ID", "pass");
        addLog("   Saved generation_context.location_name does not contain school name", "pass");
        addLog("   Message ID is consistent throughout (placeholder → generation → readback)", "pass");
        setVerdict("PASS");
      } else {
        addLog("❌ NOT PROVEN — One or more chain steps failed.", "fail");
        setVerdict("FAIL");
      }

    } catch (err) {
      addLog(`Fatal error: ${err.message}`, "error");
      setVerdict("ERROR");
    }

    setRunning(false);
  }

  const colorMap = {
    info: "text-blue-300",
    data: "text-gray-300",
    pass: "text-green-400",
    fail: "text-red-400",
    warn: "text-yellow-400",
    error: "text-red-500",
    spacer: "text-transparent",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 font-mono">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2 text-white">School Contamination Proof</h1>
        <p className="text-gray-400 mb-1 text-sm">Character: Ethan Thompson ({CHARACTER_ID})</p>
        <p className="text-gray-400 mb-1 text-sm">School ID: {SCHOOL_ID}</p>
        <p className="text-gray-400 mb-4 text-sm">Home ID: {HOME_ID}</p>

        <button
          onClick={runProof}
          disabled={running}
          className={`px-6 py-3 rounded font-bold text-black ${running ? "bg-gray-600 cursor-not-allowed" : "bg-green-400 hover:bg-green-300"}`}
        >
          {running ? "Running proof..." : "Run End-to-End Proof"}
        </button>

        {messageId && (
          <p className="mt-3 text-yellow-300 text-sm">Message ID being tracked: <strong>{messageId}</strong></p>
        )}

        {verdict && (
          <div className={`mt-4 p-4 rounded text-lg font-bold ${verdict === "PASS" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
            Final Verdict: {verdict === "PASS" ? "✅ PROVEN — School contamination resolved" : "❌ NOT PROVEN — See log"}
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-6 bg-gray-900 rounded p-4 text-xs overflow-auto max-h-[60vh]">
            {log.map((entry, i) => (
              <div key={i} className={`${colorMap[entry.type] || "text-gray-300"} leading-5`}>
                {entry.type !== "spacer" ? `[${entry.ts}] ${entry.text}` : "\u00a0"}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}