import ArrestTransitionModal from "@/components/scene/ArrestTransitionModal";
import NextSceneModal from "@/components/scene/NextSceneModal";
import SceneTargetPicker from "@/components/scene/SceneTargetPicker";

/**
 * SceneTransitionModals — the scene's transition surfaces, kept together because they
 * share one meaning: they only decide where the view goes next. Opening any of them is
 * not a scene event and changes nothing; the current scene is completed by the confirm
 * action that actually moves the scene on, never by the modal appearing.
 */
export default function SceneTransitionModals({
  arrestTransition,
  onFollowArrest,
  onWatchCustody,
  onStayArrest,
  arrestVisitors,
  onVisitorsConfirm,
  onVisitorsSelect,
  onCloseVisitors,
  arrestPicker,
  arrestTargets,
  onArrestSelect,
  onCloseArrestPicker,
  showNextScene,
  onCloseNextScene,
  locationsData,
  nextSceneParticipants,
  userPresent,
  onNextSceneConfirm,
}) {
  return (
    <>
      {/* The arrest has already happened — this only decides where the view goes next. */}
      <ArrestTransitionModal
        arrest={arrestTransition}
        onGo={onFollowArrest}
        onWatch={onWatchCustody}
        onStay={onStayArrest}
      />
      <SceneTargetPicker
        action={arrestVisitors?.action}
        targets={arrestVisitors?.targets || []}
        multiple
        confirmLabel="Come with you"
        heading={arrestTransition ? `Who comes with you to ${arrestTransition.facility?.name}?` : null}
        hint="They come as visitors — not inmates. Only people from this scene can be chosen."
        onConfirm={onVisitorsConfirm}
        onSelect={onVisitorsSelect}
        onClose={onCloseVisitors}
      />
      <SceneTargetPicker
        action={arrestPicker}
        targets={arrestTargets}
        onSelect={onArrestSelect}
        onClose={onCloseArrestPicker}
        heading={arrestPicker ? "Arrest — who is taken into custody?" : null}
        hint="Held pending proceedings — an arrest, not a conviction."
      />
      {showNextScene && (
        <NextSceneModal
          open
          locations={locationsData}
          participants={nextSceneParticipants}
          userPresent={userPresent}
          onClose={onCloseNextScene}
          onConfirm={onNextSceneConfirm}
        />
      )}
    </>
  );
}