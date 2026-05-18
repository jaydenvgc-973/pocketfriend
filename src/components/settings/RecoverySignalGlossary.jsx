import { Shield, AlertTriangle, Info } from "lucide-react";

const RECOVERY_SIGNALS = [
  {
    phrase: '"Sorry, got distracted"',
    recovery_code: "overload_too_many_systems",
    meaning: "Too many background tasks fired at once (simulations, schedules, narratives). The response pipeline was overloaded before the character could reply.",
    stage: "response_generation",
    memory_eligible: false,
    relationship_eligible: false,
  },
  {
    phrase: '"Give me a moment"',
    recovery_code: "context_load_issue",
    meaning: "Character context (memory, canonical identity, relationship data) took too long to load. The LLM was called before essential context was available.",
    stage: "canonical_prompt or memory_retrieval",
    memory_eligible: false,
    relationship_eligible: false,
  },
  {
    phrase: '"Sorry, got pulled away"',
    recovery_code: "catch_up_recovery",
    meaning: "Multiple user commands or a delayed pipeline caused a backlog. The character is catching up after multiple stacked interactions.",
    stage: "response_generation",
    memory_eligible: false,
    relationship_eligible: false,
  },
  {
    phrase: '"Lost you for a second"',
    recovery_code: "network_session_interruption",
    meaning: "Network or session was interrupted mid-generation. The connection broke between the character response and saving it.",
    stage: "network or session",
    memory_eligible: false,
    relationship_eligible: false,
  },
  {
    phrase: '"Reconnecting…" (spinner)',
    recovery_code: "background_recovery_active",
    meaning: "The system detected a failure and is automatically retrying the character response with exponential backoff (2s → 4s → 8s → 16s → 30s). The real response will appear when recovery succeeds.",
    stage: "recovery_in_progress",
    memory_eligible: false,
    relationship_eligible: false,
  },
];

export default function RecoverySignalGlossary() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-secondary/40 rounded-xl border border-border">
        <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground mb-1">Recovery Signal Glossary</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Occasionally a character may send a short message that sounds like a quick apology or pause.
            These are operational recovery signals — not real character dialogue. They appear when the
            system encounters a temporary failure and must recover before delivering the real response.
            They are <strong className="text-foreground">never saved to memory or used in relationship scoring</strong>.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {RECOVERY_SIGNALS.map((signal, i) => (
          <div key={i} className="p-4 rounded-xl bg-card border border-border space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm font-medium text-foreground font-mono">{signal.phrase}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed pl-5">{signal.meaning}</p>
            <div className="pl-5 flex flex-wrap gap-2">
              <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">
                stage: {signal.stage}
              </span>
              <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">
                memory: not written
              </span>
              <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">
                relationship: not updated
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20">
        <Shield className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          The system enforces strict rules: recovery signals are blocked from being saved more than once per failure cycle,
          are never injected into memory pipelines, and never trigger relationship score changes.
          Recovery runs automatically in the background — you should see the real response appear within 30 seconds.
        </p>
      </div>
    </div>
  );
}