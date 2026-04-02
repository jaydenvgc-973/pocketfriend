import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { User } from "lucide-react";

export default function UserCard({ user, settings }) {
  const displayName = settings?.fictional_world_name || user?.full_name || "You";
  const avatarUrl = user?.generated_avatar_urls?.[0] || user?.reference_image_urls?.[0] || null;

  return (
    <Link to="/my-profile">
      <motion.div
        whileTap={{ scale: 0.99 }}
        className="bg-card border border-border rounded-2xl p-4 hover:border-primary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-primary/20 ring-2 ring-primary/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <User className="w-6 h-6 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{displayName}</h3>
              <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">You</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Tap to view your profile</p>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}