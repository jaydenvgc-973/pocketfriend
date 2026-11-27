import React from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { PROPERTY_ROLES, isRoleMismatch, newLeadershipAssignmentId } from "@/lib/locationLeadership";

/**
 * LocationLeadershipSection
 *
 * The existing Owner / Manager assignment controls, unchanged for every ordinary place.
 * A Generic parent additionally offers the leadership roles its Parent Location Type
 * establishes — a city's Mayor, a country's President or Monarch, a building's Property
 * Manager — and may hold more than one of them, each with its own role label.
 *
 * Nothing here is ever assigned automatically: no leader is created, no character is
 * promoted, and an existing role that does not fit the parent type is shown as a mismatch
 * to correct rather than converted.
 */
export default function LocationLeadershipSection({
  form,
  update,
  currentUser = null,
  worldName = "You",
  userAvatarUrl = null,
  activeChars = [],
  assignableNpcs = [],
  leadership = null,
}) {
  const roles = leadership ? leadership.roles : PROPERTY_ROLES;
  const heading = leadership ? leadership.heading : "Owner / Landlord (optional)";
  const hasPerson = !!(form.owner_character_id || (form.owner_is_npc && form.owner_npc_name.trim()));
  const mismatch = hasPerson && leadership && !leadership.allowsCustom && isRoleMismatch(leadership, form.owner_role);

  const people = [
    ...(currentUser?.id ? [{ id: currentUser.id, name: worldName, player: true }] : []),
    ...activeChars.filter((c) => c?.id),
    ...assignableNpcs.filter((c) => c?.id && !activeChars.some((a) => a.id === c.id)),
  ];

  const assignments = form.leadership_assignments || [];
  const setAssignments = (next) => update("leadership_assignments", next);

  const addAssignment = () => setAssignments([
    ...assignments,
    { assignment_id: newLeadershipAssignmentId(), role: roles[0] || "Owner", character_id: "", character_name: "", is_npc: false, npc_name: "" },
  ]);

  const patchAssignment = (id, patch) => setAssignments(
    assignments.map((a) => (a.assignment_id === id ? { ...a, ...patch } : a))
  );

  const removeAssignment = (id) => setAssignments(assignments.filter((a) => a.assignment_id !== id));

  return (
    <div className="space-y-3">
      <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">{heading}</label>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => update("owner_is_npc", false)} className={`py-2 px-3 rounded-xl text-sm border transition-colors ${!form.owner_is_npc ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>👤 Active Character</button>
        <button onClick={() => update("owner_is_npc", true)} className={`py-2 px-3 rounded-xl text-sm border transition-colors ${form.owner_is_npc ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>🧑‍🤝‍🧑 NPC</button>
      </div>
      {!form.owner_is_npc ? (
        <div className="space-y-2 max-h-44 overflow-y-auto">
          <button onClick={() => update("owner_character_id", "")} className={`w-full flex items-center gap-2 p-2 rounded-xl border text-sm transition-colors ${!form.owner_character_id ? "bg-primary/10 border-primary/40 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
            <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs">—</span>
            {leadership ? "No leader assigned" : "No owner assigned"}
          </button>
          {currentUser?.id && (
            <button onClick={() => update("owner_character_id", currentUser.id)} className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.owner_character_id === currentUser.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
              {userAvatarUrl ? <img src={userAvatarUrl} alt={worldName} className="w-7 h-7 rounded-full object-cover flex-shrink-0" /> : (
                <div className="w-7 h-7 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">{worldName[0]?.toUpperCase()}</span>
                </div>
              )}
              <span className="text-sm text-foreground">{worldName}</span>
              <span className="text-xs text-primary/60 ml-auto">Player</span>
            </button>
          )}
          {activeChars.map(c => (
            <button key={c.id} onClick={() => update("owner_character_id", c.id)} className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.owner_character_id === c.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
              <CharacterAvatar character={c} size="sm" />
              <span className="text-sm text-foreground">{c.name}</span>
            </button>
          ))}
          {assignableNpcs.filter(c => c.character_type === 'npc_fictitious').length > 0 && <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-2 pb-0.5">NPC Fictitious</p>}
          {assignableNpcs.filter(c => c.character_type === 'npc_fictitious').map(npc => (
            <button key={npc.id} onClick={() => update("owner_character_id", npc.id)} className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.owner_character_id === npc.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
              <CharacterAvatar character={npc} size="sm" />
              <span className="text-sm text-foreground">{npc.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <Input value={form.owner_npc_name} onChange={e => update("owner_npc_name", e.target.value)} placeholder={leadership ? "NPC name (e.g. Mayor Ellis Ward)" : "NPC name (e.g. Mr. Hassan, The Landlord)"} className="h-10 rounded-xl text-sm" />
      )}

      {hasPerson && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {roles.map(role => (
              <button key={role} onClick={() => update("owner_role", role)} className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${form.owner_role === role ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>{role}</button>
            ))}
          </div>
          {leadership?.allowsCustom && (
            <Input value={form.owner_role} onChange={e => update("owner_role", e.target.value)} placeholder="Custom role (e.g. Custodian of the grounds)" className="h-9 rounded-xl text-sm" />
          )}
          {mismatch && (
            <p className="text-[11px] text-amber-400">
              Assigned as “{form.owner_role}” — not a {leadership.parentLabel} leadership role. Choose a role above to update it.
            </p>
          )}
        </div>
      )}

      {leadership?.allowsMultiple && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider">Additional roles</label>
            <button onClick={addAssignment} className="text-[11px] text-primary font-medium flex items-center gap-1 hover:underline">
              <Plus className="w-3 h-3" /> Add role
            </button>
          </div>
          {assignments.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No other leadership roles. A {leadership.parentLabel.toLowerCase()} may hold more than one — a mayor and a deputy mayor, a president and a prime minister.
            </p>
          ) : assignments.map((a) => {
            const selectedPerson = a.is_npc ? "__npc__" : (a.character_id || "");
            const roleOptions = a.role && !roles.includes(a.role) ? [...roles, a.role] : roles;
            return (
              <div key={a.assignment_id} className="rounded-xl border border-border bg-card p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={a.role || ""}
                    onChange={(e) => patchAssignment(a.assignment_id, { role: e.target.value })}
                    className="h-9 flex-1 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground"
                  >
                    {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                  <button onClick={() => removeAssignment(a.assignment_id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Remove role">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <select
                  value={selectedPerson}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "__npc__") patchAssignment(a.assignment_id, { is_npc: true, character_id: "", character_name: "" });
                    else if (!value) patchAssignment(a.assignment_id, { is_npc: false, character_id: "", character_name: "", npc_name: "" });
                    else {
                      const person = people.find((p) => p.id === value);
                      patchAssignment(a.assignment_id, { is_npc: false, character_id: value, character_name: person?.name || "", npc_name: "" });
                    }
                  }}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-xs text-foreground"
                >
                  <option value="">Not assigned</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.player ? " (Player)" : ""}</option>)}
                  <option value="__npc__">Other NPC — type a name</option>
                </select>
                {a.is_npc && (
                  <Input value={a.npc_name || ""} onChange={(e) => patchAssignment(a.assignment_id, { npc_name: e.target.value })} placeholder="NPC name" className="h-9 rounded-lg text-xs" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}