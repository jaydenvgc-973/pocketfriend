import { Link, useLocation } from "react-router-dom";
import { Home, Plus, Settings, Star, MapPin, Navigation } from "lucide-react";

export default function BottomNav() {
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  const navItems = [
    { path: "/home", icon: Home, label: "Home" },
    { path: "/travel", icon: Navigation, label: "Travel" },
    { path: "/create", icon: Plus, label: "Create" },
    { path: "/locations", icon: MapPin, label: "Places" },
    { path: "/moments", icon: Star, label: "Moments" },
    { path: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    // The footer is anchored to the viewport, so page content scrolls beneath it and it
    // never leaves the screen. Its safe-area padding keeps every button above the device's
    // own system navigation area.
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Six equal columns that share the available width: each button takes exactly
          one sixth and its label truncates rather than pushing the next button off the
          screen, so all six stay reachable at any width. */}
      <div className="max-w-lg mx-auto flex items-stretch justify-around">
        {navItems.map(({ path, icon: Icon, label }) => (
          <Link key={path} to={path} className="flex-1 min-w-0">
            <button
              className={`w-full min-w-0 flex flex-col items-center gap-1 py-3 px-0.5 transition-colors ${
                isActive(path)
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="w-6 h-6 flex-shrink-0" />
              <span className="w-full text-[11px] sm:text-xs font-medium leading-tight text-center truncate">{label}</span>
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}