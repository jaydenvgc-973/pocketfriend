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
    <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-xl border-t border-border">
      <div className="max-w-lg mx-auto px-4 py-3 flex justify-around items-center">
        {navItems.map(({ path, icon: Icon, label }) => (
          <Link key={path} to={path}>
            <button
              className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors ${
                isActive(path)
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}