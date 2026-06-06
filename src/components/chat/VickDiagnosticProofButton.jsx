import { isVickServicioCharacter } from "@/lib/vickDiagnosticIntentCheck";

/**
 * Temporary proof button for Vick diagnostics.
 *
 * Uses production Chat.jsx sendMessage path to trigger a real diagnostic.
 * Does NOT bypass the production routing — the message travels through:
 * - sendMessage function (real)
 * - intent detection (real)
 * - diagnostic invocation (real)
 * - response generation (real)
 * - message rendering (real)
 */
export default function VickDiagnosticProofButton({
  character,
  isTyping,
  onSendMessage,
  isPhone,
}) {
  if (!character || isPhone || !isVickServicioCharacter(character)) {
    return null;
  }

  return (
    <div className="px-4 pb-2 flex justify-center">
      <button
        onClick={() => onSendMessage("Run a diagnostic.")}
        disabled={isTyping}
        className="px-3 py-1.5 text-xs bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-600/40 rounded-lg transition-colors disabled:opacity-50 font-semibold"
        title="Automatically send a diagnostic request to Vick using the production Chat path"
      >
        🔧 Vick Diagnostic Proof
      </button>
    </div>
  );
}