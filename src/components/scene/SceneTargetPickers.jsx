import React from "react";
import SceneTargetPicker from "@/components/scene/SceneTargetPicker";

/**
 * SceneTargetPickers — every "who" picker the scene opens, in one place.
 *
 * Each picker answers a different question with the same existing selector: who does it,
 * who it is aimed at, whose pocket, who is involved, who tries the item on, and who holds
 * each courtroom role. They are grouped here only so the Scenes page stays readable; the
 * props and the handlers are exactly the ones the page already passed to them.
 */
/**
 * What the merchandise interaction is called for the person holding this card. Trying on,
 * playing with an animal and testing a vehicle are the same kind of moment.
 */
function tryOnActionLabel(request) {
  const item = request?.msg?.item_label || "item";
  if (request?.kind === "play_with") return `Play with the ${item}`;
  if (request?.kind === "test_vehicle") return `Test the ${item}`;
  return `Try on the ${item}`;
}

export default function SceneTargetPickers({ v }) {
  const {
    actorAction, directedActorsFor, eligibleForAction, observeMode, observeActors, activityActors,
    handleActorSelect, handleActorsConfirm, setActorAction,
    directedAction, directedPartnersFor, handleDirectedTarget, setDirectedAction,
    crimeTargetAction, crimeTargetOptions, handleCrimeTargetSelect, setCrimeTargetAction,
    recipientAction, recipientTargets, performRecipientAction, setRecipientAction,
    tryOnRequest, handleTryOnConfirm, setTryOnRequest,
    courtActorAction, courtCase, courtActors, runCourtAction, setCourtActorAction,
    courtSubjectAction, courtSubjects, setCourtSubjectAction,
  } = v;

  return (
    <>
      {/* Who performs it — asked only when more than one eligible character is here. */}
      <SceneTargetPicker
        action={actorAction?.action}
        targets={actorAction?.mode === "directed"
          ? directedActorsFor(actorAction?.action)
          : eligibleForAction(observeMode ? observeActors : activityActors, actorAction?.action)}
        onSelect={handleActorSelect}
        onConfirm={handleActorsConfirm}
        multiple={actorAction?.mode === "activity" && actorAction?.action?.id !== "pickpocket"}
        confirmLabel="Do it together"
        onClose={() => setActorAction(null)}
        heading={actorAction ? `${actorAction.action.emoji} ${actorAction.action.label} — ${actorAction.mode === "activity" && observeMode ? "who takes part?" : "who does it?"}` : null}
        hint={actorAction?.mode === "directed"
          ? "The person who starts it. Only people who are here can be chosen."
          : actorAction?.mode === "activity"
            ? (observeMode
              ? "Pick one person or several — they take part together. Only people who are here can be chosen."
              : "Whoever you pick does it — nobody is assumed. Only people in this scene can be chosen.")
            : "Only people in this scene can be chosen — you included, whenever you are here."}
      />
      <SceneTargetPicker action={directedAction} targets={directedPartnersFor(directedAction, directedAction?.actorId)} onSelect={handleDirectedTarget} onClose={() => setDirectedAction(null)} />
      {/* Pickpocket names two people: who attempts it, then whose pocket. Never assumed. */}
      <SceneTargetPicker
        action={crimeTargetAction?.action}
        targets={crimeTargetOptions}
        onSelect={handleCrimeTargetSelect}
        onClose={() => setCrimeTargetAction(null)}
        heading={crimeTargetAction ? crimeTargetAction.action.emoji + " " + (crimeTargetAction.actor?.name || "They") + " — whose pocket?" : null}
        hint="Only people in this scene can be chosen, and never the person attempting it."
      />
      <SceneTargetPicker
        action={recipientAction}
        targets={recipientTargets}
        onSelect={(person) => { const pending = recipientAction; setRecipientAction(null); performRecipientAction(pending, person); }}
        onClose={() => setRecipientAction(null)}
        heading={recipientAction ? `${recipientAction.emoji} ${recipientAction.label} — who is involved?` : null}
        hint="Only people who are here can be chosen."
      />
      {/* Try On / Play With / Test — who in this scene does it with the item from the card.
          Only people here; nothing is charged and nobody owns anything. */}
      <SceneTargetPicker
        action={tryOnRequest ? { emoji: tryOnRequest.kind === "play_with" ? "🐾" : tryOnRequest.kind === "test_vehicle" ? "🚗" : "🪞", label: tryOnActionLabel(tryOnRequest) } : null}
        targets={tryOnRequest?.cast || []}
        onSelect={handleTryOnConfirm}
        onClose={() => setTryOnRequest(null)}
        heading={tryOnRequest ? `${tryOnActionLabel(tryOnRequest)} — who?` : null}
        hint="Only people in this scene can do this."
      />
      {/* Courtroom activities: the role assigned in the setup decides who may act. */}
      <SceneTargetPicker
        action={courtActorAction}
        targets={courtActors(courtCase, courtActorAction?.id)}
        onSelect={(person) => { const pending = courtActorAction; setCourtActorAction(null); runCourtAction(pending, person); }}
        onClose={() => setCourtActorAction(null)}
        heading={courtActorAction ? `${courtActorAction.emoji} ${courtActorAction.label} — who does it?` : null}
        hint="The role assigned in the court setup decides who may do this."
      />
      <SceneTargetPicker
        action={courtSubjectAction?.action}
        targets={courtSubjects(courtCase, courtSubjectAction?.action?.id).filter((p) => p.id !== courtSubjectAction?.actor?.id)}
        onSelect={(person) => { const pending = courtSubjectAction; setCourtSubjectAction(null); runCourtAction(pending.action, pending.actor, person); }}
        onClose={() => setCourtSubjectAction(null)}
        heading={courtSubjectAction ? `${courtSubjectAction.action.emoji} ${courtSubjectAction.action.label} — who is it directed at?` : null}
        hint="Only people in this proceeding can be chosen."
      />
    </>
  );
}