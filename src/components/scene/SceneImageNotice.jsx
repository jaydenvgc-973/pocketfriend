import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { subscribeSceneImageFailure, isSceneImageFailed, publishSceneImageSuccess } from "@/lib/sceneImageFailure";

/**
 * SceneImageNotice — the picture area's own word on a refused picture.
 *
 * A picture the image service refused is never presented as the picture of the moment:
 * the area says so, plainly, and the notice clears as soon as a picture is drawn again
 * (or the scene is left). It renders nothing at all while pictures are being drawn.
 */
export default function SceneImageNotice() {
  const [failed, setFailed] = useState(isSceneImageFailed());

  useEffect(() => subscribeSceneImageFailure(setFailed), []);
  // The notice belongs to the scene that was being looked at — leaving it never carries
  // the message onto the next place.
  useEffect(() => () => publishSceneImageSuccess(), []);

  if (!failed) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-[150] flex items-start gap-1.5 bg-black/75 px-2 py-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-px" />
      <p className="text-[10px] leading-tight text-white/90">
        That picture couldn't be drawn — the image service refused it. The moment still happened; choose the activity again for a new picture.
      </p>
    </div>
  );
}