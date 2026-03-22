import { Link, useLocation } from "react-router-dom";
import { Home, Users, Plus, Settings } from "lucide-react";

export default function BottomNav() {
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  const navItems = [
    { path: "/home", icon: Home, label: "Home" },
    { path: "/groups", icon: Users, label: "Groups" },
    { path: "/create", icon: Plus, label: "Create" },
    { path: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border">
      <div className="max-w-lg mx-auto flex justify-around">
        {navItems.map(({ path, icon: Icon, label }) => (
          <Link key={path} to={path} className="flex-1">
            <button
              className={`w-full flex flex-col items-center gap-1 py-3 transition-colors ${
                isActive(path)
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="w-6 h-6" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}