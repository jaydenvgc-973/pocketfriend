import { useEffect, useState } from "react";
import RideVehiclePicker from "@/components/scene/RideVehiclePicker";
import MissingBelongingModal from "@/components/scene/MissingBelongingModal";
import NextSceneModal from "@/components/scene/NextSceneModal";
import { loadAccountBelongings, hasCar } from "@/lib/ownerBelongings";

/**
 * SceneRideFlow — Take a Ride, from the button to the ride.
 *
 * Clicking Take a Ride always answers: the vehicle-owner selector opens at once, listing
 * the people actually in this scene. The chosen owner's car is read from their own
 * Property / Belongings record — never assumed, never invented. An owner without a car is
 * told so, and cancelling changes nothing. With a car, the same Next Scene modal opens in
 * ride mode (four seats, "Ride"), and the confirmed ride carries the vehicle into the
 * destination scene.
 */
export default function SceneRideFlow({ open, onClose, currentUser, displayName, userPresent, participants = [], locations = [], onConfirm }) {
  const [belongings, setBelongings] = useState([]);
  const [missing, setMissing] = useState(null);
  const [ride, setRide] = useState(null);

  // The account's own belongings records, so the picker can show what each owner has.
  useEffect(() => {
    if (!open || !currentUser?.email) return;
    let cancelled = false;
    loadAccountBelongings(currentUser.email)
      .then((rows) => { if (!cancelled) setBelongings(rows || []); })
      .catch(() => { if (!cancelled) setBelongings([]); });
    return () => { cancelled = true; };
  }, [open, currentUser?.email]);

  const close = () => { setRide(null); setMissing(null); onClose(); };

  const selectOwner = (owner) => {
    const car = belongings.find((r) => r.owner_type === owner.type && r.owner_id === owner.id)?.car || null;
    if (!hasCar(car)) { setMissing({ kind: "car", ownerName: owner.name, isUser: owner.type === "user" }); return; }
    setRide({ ...owner, car });
  };

  return (
    <>
      <RideVehiclePicker
        open={open && !ride}
        userPresent={userPresent}
        currentUser={currentUser}
        displayName={displayName}
        participants={participants}
        belongings={belongings}
        onSelect={selectOwner}
        onClose={close}
      />
      <MissingBelongingModal
        open={!!missing}
        kind={missing?.kind}
        ownerName={missing?.ownerName}
        isUser={!!missing?.isUser}
        onClose={close}
      />
      {open && ride && (
        <NextSceneModal
          open
          locations={locations}
          participants={participants}
          userPresent={userPresent}
          rideMode
          requiredTravelerIds={ride.type === "character" ? [ride.id] : []}
          onClose={close}
          onConfirm={(payload) => {
            const owner = ride;
            setRide(null);
            onClose();
            onConfirm({ ...payload, ride: { ownerId: owner.id, ownerType: owner.type, ownerName: owner.name, car: owner.car } });
          }}
        />
      )}
    </>
  );
}