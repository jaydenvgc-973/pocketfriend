import React from "react";

/**
 * Reusable section header for the profile page.
 * Gives each module a consistent visual identity: icon badge + bold uppercase title + optional subtitle.
 */
export default function ProfileSectionHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
        <div>
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}