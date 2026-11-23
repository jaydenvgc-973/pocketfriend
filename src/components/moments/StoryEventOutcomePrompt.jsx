import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Scale, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import MarriageConfirmationModal from "@/components/government/MarriageConfirmationModal";
import JudicialOutcomeModal from "@/components/government/JudicialOutcomeModal";

/**
 * StoryEventOutcomePrompt — after a completed Story Event, offers the established
 * confirmation for an official outcome the story actually reached.
 *
 * It reads the finished narrative and reports only outcomes that are completed:
 *   • a marriage ceremony that concluded (never a proposal, engagement, planning,
 *     rehearsal, discussion, or an interrupted ceremony)
 *   • a criminal sentence that was imposed (never an arrest, accusation, trial
 *     without a verdict, acquittal, dismissal, or adjournment)
 *
 * Nothing is applied from the story itself. Confirming opens the same marriage and
 * sentencing flows Scenes uses, so both paths write through the same records.
 */
export default function StoryEventOutcomePrompt({ event }) {
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [handled, setHandled] = useState(null);
  const [showMarriage, setShowMarriage] = useState(false);
  const [showSentencing, setShowSentencing] = useState(false);

  const eventKey = event?.id || null;
  const participantIds = useMemo(
    () => (event?.participant_character_ids || []).filter(Boolean),
    [eventKey]
  );

  useEffect(() => {
    if (!eventKey || event?.status !== "complete" || !event?.generated_narrative) return;
    // Only stories that could contain a legal outcome are checked — no classification
    // call is spent on a story that never mentions a marriage or a court.
    if (!/(marri|wedding|wed |spouse|husband|wife|court|trial|sentenc|verdict|judge|jury|juror|prison|jail|convict|acquit|dismiss)/i.test(String(event.generated_narrative))) return;
    let cancelled = false;
    setChecking(true);
    setOutcome(null);
    setDismissed(false);
    setHandled(null);

    (async () => {
      try {
        const [charsRes, locsRes] = await Promise.all([
          participantIds.length > 0
            ? base44.functions.invoke("fetchCharactersByIds", { ids: participantIds })
            : Promise.resolve(null),
          base44.functions.invoke("fetchAllLocationsForUser", {}).catch(() => null),
        ]);
        if (cancelled) return;
        const chars = (charsRes?.data?.characters || []).filter((c) =>
          c?.id && !["deleted", "soft_deleted", "merged", "deceased"].includes(c.status) && c.life_status !== "deceased"
        );
        setParticipants(chars);
        setFacilities(((locsRes?.data?.locations) || []).filter((l) => l.category === "jail_prison" || l.is_confinement_facility === true));

        const roster = chars.map((c) => c.name).filter(Boolean);
        if (roster.length === 0) return;

        const res = await base44.integrations.Core.InvokeLLM({
          prompt: `Read this finished story and report only official outcomes it actually completes.

PEOPLE IN THE STORY (the only people who may be named in an outcome):
${roster.join(", ")}

STORY:
${String(event.generated_narrative).slice(0, 6000)}

RULES:
- A completed marriage means a marriage ceremony actually concluded and the two people are now married. A proposal, engagement, wedding planning, rehearsal, discussion about marriage, or a ceremony that was interrupted or did not conclude is NOT a completed marriage. Never report more than the two people who actually married.
- A completed criminal sentence means a judge imposed a sentence on a specific person. An arrest, an accusation, a charge, a trial in progress, a verdict alone, an acquittal, a dismissal, or an adjournment without sentence is NOT a completed sentencing.
- Only name people from the list above. If an outcome involves someone not on the list, report no outcome.
- If the story does not clearly complete either outcome, report both as false.

Return JSON only.`,
          response_json_schema: {
            type: "object",
            properties: {
              completed_marriage: { type: "boolean" },
              married_names: { type: "array", items: { type: "string" } },
              completed_sentencing: { type: "boolean" },
              sentenced_name: { type: "string" },
              offense: { type: "string" },
              custody: { type: "boolean" },
              adjourned_without_verdict: { type: "boolean" },
              acquittal_or_dismissal: { type: "boolean" },
            },
            required: ["completed_marriage", "completed_sentencing"],
          },
        });

        if (cancelled || !res) return;
        const byName = (name) => chars.find((c) => (c.name || "").trim().toLowerCase() === String(name || "").trim().toLowerCase());
        const married = (res.married_names || []).map(byName).filter(Boolean);
        const sentenced = byName(res.sentenced_name);

        if (res.completed_marriage && married.length === 2 && married[0].id !== married[1].id) {
          setOutcome({ kind: "marriage", spouses: married });
        } else if (res.completed_sentencing && sentenced && !res.acquittal_or_dismissal && !res.adjourned_without_verdict) {
          setOutcome({ kind: "sentencing", defendant: sentenced, offense: res.offense || "", custody: !!res.custody });
        }
      } catch {
        /* a story with no official outcome simply offers nothing */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => { cancelled = true; };
  }, [eventKey, event?.status]);

  if (!eventKey || event?.status !== "complete") return null;
  if (dismissed || handled) return null;

  if (checking) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" /> Checking whether this story completed an official outcome…
      </div>
    );
  }

  if (!outcome) return null;

  return (
    <>
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="flex items-start gap-2">
          {outcome.kind === "marriage"
            ? <Heart className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            : <Scale className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />}
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-foreground">
              {outcome.kind === "marriage" ? "This story ends with a marriage" : "This story ends with a sentence"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {outcome.kind === "marriage"
                ? `${outcome.spouses[0].name} and ${outcome.spouses[1].name} were married. Confirming records it in their existing relationships.`
                : `${outcome.defendant.name} was sentenced${outcome.offense ? ` for ${outcome.offense}` : ""}. Confirming writes it into their criminal history, and into the existing prison system if the sentence is custodial.`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="rounded-lg text-xs"
            onClick={() => outcome.kind === "marriage" ? setShowMarriage(true) : setShowSentencing(true)}
          >
            {outcome.kind === "marriage" ? "Confirm marriage" : "Confirm sentence"}
          </Button>
          <Button size="sm" variant="ghost" className="rounded-lg text-xs" onClick={() => setDismissed(true)}>
            Not now
          </Button>
        </div>
      </div>

      <MarriageConfirmationModal
        open={showMarriage}
        characters={participants}
        initialSpouseIds={outcome.kind === "marriage" ? outcome.spouses.map((s) => s.id) : []}
        locationName={event.venue_name || event.rabbit_hole_venue_name || null}
        ceremonyType={null}
        onClose={() => setShowMarriage(false)}
        onConfirmed={() => { setShowMarriage(false); setHandled("marriage"); }}
      />

      <JudicialOutcomeModal
        open={showSentencing}
        mode="sentencing"
        characters={participants}
        facilities={facilities}
        initialDefendantId={outcome.kind === "sentencing" ? outcome.defendant.id : ""}
        initialOffense={outcome.kind === "sentencing" ? outcome.offense : ""}
        courtName={event.venue_name || "the court"}
        caseType="sentencing"
        onClose={() => setShowSentencing(false)}
        onResolved={() => { setShowSentencing(false); setHandled("sentencing"); }}
      />
    </>
  );
}