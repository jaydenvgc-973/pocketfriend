import React from "react";
import { ChevronLeft, Images } from "lucide-react";

/**
 * PhoneMediaGalleryApp — Media Gallery is not rendered inside the phone.
 *
 * Opening it asks first, because going there means leaving the Scenes page. Cancel returns
 * to the phone with the scene untouched. Okay hands over to the scene's own exit choices,
 * which record the scene before the Media Gallery opens.
 */
export default function PhoneMediaGalleryApp({ onBack, onCancel, onOkay }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-2 text-white/90">
        <button onClick={onBack} className="p-1 rounded-full hover:bg-white/10"><ChevronLeft className="w-4 h-4" /></button>
        <Images className="w-3.5 h-3.5" />
        <span className="text-[11px] font-semibold">Media Gallery</span>
      </div>
      <div className="flex-1 flex items-center justify-center px-5">
        <div className="w-full rounded-2xl bg-black/55 border border-white/15 p-4 space-y-3 text-center">
          <p className="text-sm font-semibold text-white">Open Media Gallery?</p>
          <p className="text-[11px] text-white/75 leading-relaxed">This will leave the current Scenes page and open your Media Gallery.</p>
          <div className="flex gap-2 pt-1">
            <button onClick={onCancel} className="flex-1 py-1.5 rounded-lg bg-white/10 text-white/90 text-xs font-medium hover:bg-white/15">Cancel</button>
            <button onClick={onOkay} className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">Okay</button>
          </div>
        </div>
      </div>
    </div>
  );
}