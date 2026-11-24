import { motion } from "framer-motion";
import { Building2, Eye, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ArrestTransitionModal — shown once an arrest has ACTUALLY happened in the scene.
 *
 * The custody transfer has already been carried out by the authoritative location and
 * confinement system before this opens; this only decides what the user's Scenes view
 * does next. Staying here never undoes the arrest.
 */
export default function ArrestTransitionModal({ arrest, onGo, onWatch, onStay }) {
  if (!arrest) return null;
  const name = arrest.character?.name || "They";
  const facilityName = arrest.facility?.name || "the police station";

  return (
    <div className="fixed inset-0 z-[190] flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={onStay}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-2xl bg-card border border-border p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Arrest</p>
          <h3 className="text-sm font-bold text-foreground">
            {name} has been taken into custody at {facilityName}
            {arrest.unitName ? ` · ${arrest.unitName}` : ""}
          </h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Held pending proceedings. This is an arrest, not a conviction or a sentence.
          </p>
        </div>

        <div className="space-y-2">
          <Button variant="outline" className="w-full justify-start gap-2 rounded-xl" onClick={onGo}>
            <MapPin className="w-4 h-4" /> Go to {facilityName}
          </Button>
          <Button variant="outline" className="w-full justify-start gap-2 rounded-xl" onClick={onWatch}>
            <Eye className="w-4 h-4" /> Watch as Observer
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-2 rounded-xl" onClick={onStay}>
            <Building2 className="w-4 h-4" /> Stay Here
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Watching does not move you there. Staying keeps you in this scene — they remain in custody.
        </p>
      </motion.div>
    </div>
  );
}