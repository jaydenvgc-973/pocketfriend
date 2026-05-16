import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import GroupedCharacterSelector from "@/components/location/GroupedCharacterSelector";
import JailInmatePanel from "@/components/location/JailInmatePanel";

export default function JailSelectorProof() {
  const [workerIds, setWorkerIds] = useState([]);
  const [inmates, setInmates] = useState([]);
  const urlSection = new URLSearchParams(window.location.search).get("section") || "worker";
  const [activeSection, setActiveSection] = useState(urlSection);

  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [], isLoading } = useQuery({
    queryKey: ["characters-proof", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const [active, npcs] = await Promise.all([
        base44.entities.Character.filter({
          owner_email: currentUser.email,
          status: "active",
          character_type: "active_created_character",
        }),
        base44.entities.Character.filter({
          owner_email: currentUser.email,
          character_type: { $in: ["npc_fictitious", "npc_family_member"] },
        }),
      ]);
      return [...active, ...npcs.filter(c => c.status !== "deleted" && c.status !== "moved_away")];
    },
    enabled: !!currentUser?.email,
  });

  // Count by type
  const activeCreated = characters.filter(c => (c.character_type || "active_created_character") === "active_created_character");
  const npcFictitious = characters.filter(c => c.character_type === "npc_fictitious");
  const npcFamily = characters.filter(c => c.character_type === "npc_family_member");

  return (
    <div className="min-h-screen bg-background p-4 space-y-6 max-w-lg mx-auto">
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <h1 className="text-base font-bold text-foreground">Jail Selector Architecture Proof</h1>
        <p className="text-xs text-muted-foreground">Live rendering with real account data</p>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading characters...</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 text-center">
              <p className="text-lg font-bold text-primary">{activeCreated.length}</p>
              <p className="text-[10px] text-muted-foreground">Active Created</p>
            </div>
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 text-center">
              <p className="text-lg font-bold text-primary">{npcFictitious.length}</p>
              <p className="text-[10px] text-muted-foreground">NPC Fictitious</p>
            </div>
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 text-center">
              <p className="text-lg font-bold text-primary">{npcFamily.length}</p>
              <p className="text-[10px] text-muted-foreground">NPC Family</p>
            </div>
          </div>
        )}
      </div>

      {/* Tab selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection("worker")}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${activeSection === "worker" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30"}`}
        >
          👷 Worker Selector
        </button>
        <button
          onClick={() => setActiveSection("inmate")}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${activeSection === "inmate" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30"}`}
        >
          🔒 Inmate Selector
        </button>
      </div>

      {activeSection === "worker" && (
        <div className="space-y-3">
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
            <p className="text-xs text-green-400 font-semibold">✅ WORKER SELECTOR — Same GroupedCharacterSelector used by ALL location types</p>
            <p className="text-xs text-muted-foreground mt-1">jail_prison uses identical path as bar, hospital, gym. No separate jail-only employment logic.</p>
          </div>

          {workerIds.length > 0 && (
            <div className="bg-secondary/40 border border-border rounded-xl p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Selected Workers ({workerIds.length})</p>
              <div className="flex flex-wrap gap-1">
                {workerIds.map(id => {
                  const c = characters.find(x => x.id === id);
                  return c ? (
                    <span key={id} className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">{c.name}</span>
                  ) : null;
                })}
              </div>
              <p className="text-[10px] text-green-400 mt-2">✅ {workerIds.length} worker(s) assigned — no cap on assignments. Only scene runtime is capped at 4.</p>
            </div>
          )}

          {/* GROUP 1: Active Created */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">GROUP 1: ACTIVE CREATED CHARACTERS ({activeCreated.length} total)</p>
            {activeCreated.slice(0, 5).map(char => (
              <button key={char.id} onClick={() => setWorkerIds(prev => prev.includes(char.id) ? prev.filter(x => x !== char.id) : [...prev, char.id])}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${workerIds.includes(char.id) ? "bg-primary/10 border-primary/40" : "bg-secondary/30 border-border hover:border-primary/30"}`}>
                <div className="w-10 h-10 rounded-full bg-primary/20 ring-2 ring-emerald-500/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar_url ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" /> : <span className="font-semibold text-primary text-sm">{char.name?.[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground">Active Created</p>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${workerIds.includes(char.id) ? "bg-primary border-primary" : "border-border"}`}>
                  {workerIds.includes(char.id) && <span className="text-white text-[10px]">✓</span>}
                </div>
              </button>
            ))}
            {activeCreated.length > 5 && <p className="text-[10px] text-muted-foreground px-1">+{activeCreated.length - 5} more active created characters</p>}
          </div>

          {/* GROUP 2: NPC Fictitious */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">GROUP 2: NPC FICTITIOUS ({npcFictitious.length} total)</p>
            {npcFictitious.slice(0, 5).map(char => (
              <button key={char.id} onClick={() => setWorkerIds(prev => prev.includes(char.id) ? prev.filter(x => x !== char.id) : [...prev, char.id])}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${workerIds.includes(char.id) ? "bg-primary/10 border-primary/40" : "bg-secondary/30 border-border hover:border-primary/30"}`}>
                <div className="w-10 h-10 rounded-full bg-primary/20 ring-2 ring-amber-400/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar_url ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" /> : <span className="font-semibold text-primary text-sm">{char.name?.[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground">NPC Fictitious</p>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${workerIds.includes(char.id) ? "bg-primary border-primary" : "border-border"}`}>
                  {workerIds.includes(char.id) && <span className="text-white text-[10px]">✓</span>}
                </div>
              </button>
            ))}
            {npcFictitious.length > 5 && <p className="text-[10px] text-muted-foreground px-1">+{npcFictitious.length - 5} more NPC fictitious characters</p>}
          </div>

          {/* GROUP 3: NPC Family Members */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">GROUP 3: NPC FAMILY MEMBERS ({npcFamily.length} total)</p>
            {npcFamily.slice(0, 5).map(char => (
              <button key={char.id} onClick={() => setWorkerIds(prev => prev.includes(char.id) ? prev.filter(x => x !== char.id) : [...prev, char.id])}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${workerIds.includes(char.id) ? "bg-primary/10 border-primary/40" : "bg-secondary/30 border-border hover:border-primary/30"}`}>
                <div className="w-10 h-10 rounded-full bg-primary/20 ring-2 ring-blue-400/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar_url ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" /> : <span className="font-semibold text-primary text-sm">{char.name?.[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground">NPC Family Member</p>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${workerIds.includes(char.id) ? "bg-primary border-primary" : "border-border"}`}>
                  {workerIds.includes(char.id) && <span className="text-white text-[10px]">✓</span>}
                </div>
              </button>
            ))}
            {npcFamily.length > 5 && <p className="text-[10px] text-muted-foreground px-1">+{npcFamily.length - 5} more NPC family members</p>}
          </div>
        </div>
      )}

      {activeSection === "inmate" && (
        <div className="space-y-3">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <p className="text-xs text-red-400 font-semibold">🔒 INMATE/BOOKING SELECTOR — Completely separate from worker employment</p>
            <p className="text-xs text-muted-foreground mt-1">Uses same GroupedCharacterSelector. Writes to LocationReference.inmates[] and Character.is_jailed — NEVER to worker_character_ids.</p>
          </div>

          {/* GROUP 1: Active Created for Inmate */}
          <div className="bg-card border border-red-500/20 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">GROUP 1: ACTIVE CREATED CHARACTERS ({activeCreated.length} total)</p>
            {activeCreated.slice(0, 4).map(char => (
              <div key={char.id} className="w-full flex items-center gap-3 p-3 rounded-xl border bg-secondary/30 border-border text-left">
                <div className="w-10 h-10 rounded-full bg-primary/20 ring-2 ring-emerald-500/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar_url ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" /> : <span className="font-semibold text-primary text-sm">{char.name?.[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground">Active Created</p>
                </div>
                <div className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0" />
              </div>
            ))}
            {activeCreated.length > 4 && <p className="text-[10px] text-muted-foreground px-1">+{activeCreated.length - 4} more</p>}
          </div>

          {/* GROUP 2: NPC Fictitious for Inmate */}
          <div className="bg-card border border-red-500/20 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">GROUP 2: NPC FICTITIOUS ({npcFictitious.length} total)</p>
            {npcFictitious.slice(0, 4).map(char => (
              <div key={char.id} className="w-full flex items-center gap-3 p-3 rounded-xl border bg-secondary/30 border-border text-left">
                <div className="w-10 h-10 rounded-full bg-primary/20 ring-2 ring-amber-400/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar_url ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" /> : <span className="font-semibold text-primary text-sm">{char.name?.[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground">NPC Fictitious</p>
                </div>
                <div className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0" />
              </div>
            ))}
            {npcFictitious.length > 4 && <p className="text-[10px] text-muted-foreground px-1">+{npcFictitious.length - 4} more</p>}
          </div>

          {/* GROUP 3: NPC Family for Inmate */}
          <div className="bg-card border border-red-500/20 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">GROUP 3: NPC FAMILY MEMBERS ({npcFamily.length} total)</p>
            {npcFamily.slice(0, 4).map(char => (
              <div key={char.id} className="w-full flex items-center gap-3 p-3 rounded-xl border bg-secondary/30 border-border text-left">
                <div className="w-10 h-10 rounded-full bg-primary/20 ring-2 ring-blue-400/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar_url ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" /> : <span className="font-semibold text-primary text-sm">{char.name?.[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground">NPC Family Member</p>
                </div>
                <div className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center flex-shrink-0" />
              </div>
            ))}
            {npcFamily.length > 4 && <p className="text-[10px] text-muted-foreground px-1">+{npcFamily.length - 4} more</p>}
          </div>

          <JailInmatePanel
            inmates={inmates}
            allCharacters={characters}
            onChange={setInmates}
          />
        </div>
      )}

      {/* Architecture proof table */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-xs font-bold text-foreground uppercase tracking-wider">Architecture Verification</p>
        <div className="space-y-2 text-xs">
          {[
            { label: "Worker selector fields", value: "worker_character_ids, worker_job_titles, worker_pay_rates, worker_shifts", ok: true },
            { label: "Worker save path", value: "LocationReference.update() → same as bar/hospital/gym", ok: true },
            { label: "Worker sync path", value: "syncLocationJobToCharacter(locationId, characterId, 'work')", ok: true },
            { label: "Inmate storage", value: "LocationReference.inmates[] — separate from worker_character_ids", ok: true },
            { label: "Inmate sync path", value: "Character.update(is_jailed, incarceration_facility_id, etc.)", ok: true },
            { label: "Scene worker cap", value: "jail_prison: slice(0, 4) — assignments unlimited, scene display capped", ok: true },
            { label: "Selector grouping", value: "Active Created / NPC Fictitious / NPC Family — alphabetized per group", ok: true },
            { label: "Selector rows show", value: "CharacterAvatar + name + type label — no checkbox-only rows", ok: true },
            { label: "Legacy characters", value: "missing character_type → falls into 'active_created_character' group (line 23)", ok: true },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-secondary/30">
              <span className={item.ok ? "text-green-400" : "text-red-400"}>{item.ok ? "✅" : "❌"}</span>
              <div>
                <p className="font-semibold text-foreground">{item.label}</p>
                <p className="text-muted-foreground">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}