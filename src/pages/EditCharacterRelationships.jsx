import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { AnimatePresence } from "framer-motion";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";
import NPCRelationshipEditor from "@/components/character/NPCRelationshipEditor";

const LEVELS = [
  { key: "user_respect_level", label: "Respect", color: "text-blue-400" },
  { key: "friendship_level", label: "Friendship", color: "text-emerald-400" },
  { key: "romantic_level", label: "Romantic", color: "text-pink-400" },
  { key: "attraction_level", label: "Attraction", color: "text-orange-400" },
  { key: "chosen_family_level", label: "Chosen Family", color: "text-purple-400" },
];

export default function EditCharacterRelationships() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [editingNPC, setEditingNPC] = useState(null);
  const [levels, setLevels] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email }, "-created_date")
      : [],
    enabled: !!currentUser?.email,
  });

  const editableChars = characters.filter(c => c.status !== "deleted");

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;
  const [form, setForm] = useState({});

  const handleSelect = (char) => {
    setSelectedChar(char);
    setLevels({
      user_respect_level: char.user_respect_level ?? 50,
      friendship_level: char.friendship_level ?? 75,
      romantic_level: char.romantic_level ?? 0,
      attraction_level: char.attraction_level ?? 0,
      chosen_family_level: char.chosen_family_level ?? 0,
    });
    setForm({
      voice_enabled: char.voice_enabled || false,
      voice_name: char.voice_name || "",
      voice_style_note: char.voice_style_note || "",
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setIsSaving(true);
    await base44.entities.Character.update(selectedChar.id, {
      ...levels,
      voice_enabled: form.voice_enabled,
      voice_name: form.voice_name,
      voice_style_note: form.voice_style_note,
    });
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        {selectedChar ? (
          <button onClick={() => setSelectedChar(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <Link to="/settings" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <h2 className="text-sm font-semibold">
          {selectedChar ? `Edit Levels — ${selectedChar.name}` : "Edit Relationship Levels"}
        </h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {!selectedChar ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a character to edit their relationship levels.</p>
            {editableChars.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No characters yet.</p>
            )}
            {editableChars.map(char => (
              <button
                key={char.id}
                onClick={() => handleSelect(char)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left"
              >
                <CharacterAvatar character={char} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{char.personality_summary?.split(".")[0]}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        ) : editingNPC ? (
          <NPCRelationshipEditor
            character={selectedChar}
            relationship={editingNPC}
            onClose={() => {
              setEditingNPC(null);
              queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
            }}
          />
        ) : (
           <div className="space-y-6">
             <div className="space-y-3">
               <div className="flex items-center justify-between">
                 <h3 className="text-sm font-semibold text-foreground">World People</h3>
                 <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs">
                   <Plus className="w-3.5 h-3.5" /> Add NPC
                 </Button>
               </div>
               {(selectedChar.fictional_relationships || []).length > 0 ? (
                 <div className="space-y-2">
                   {selectedChar.fictional_relationships.map((npc, idx) => (
                     <button
                       key={idx}
                       onClick={() => setEditingNPC(npc)}
                       className="w-full flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors text-left"
                     >
                       {npc.avatar_url ? (
                         <img src={npc.avatar_url} alt={npc.person_name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                       ) : (
                         <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-primary">
                           {npc.person_name?.[0]?.toUpperCase() || "?"}
                         </div>
                       )}
                       <div className="flex-1 min-w-0">
                         <p className="text-sm font-medium text-foreground">{npc.person_name}</p>
                         <p className="text-xs text-muted-foreground">{npc.relationship_type}</p>
                       </div>
                       <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                     </button>
                   ))}
                 </div>
               ) : (
                 <p className="text-xs text-muted-foreground italic">No world people added yet.</p>
               )}
             </div>

             <div className="pt-4 border-t border-border space-y-3">
               <h3 className="text-sm font-semibold text-foreground">Relationship Levels</h3>
               {LEVELS.map(({ key, label, color }) => (
                 <div key={key} className="space-y-3">
                   <div className="flex items-center justify-between">
                     <label className={`text-sm font-medium ${color}`}>{label}</label>
                     <span className="text-sm font-semibold text-foreground">{levels[key] ?? 0}</span>
                   </div>
                   <Slider
                     min={0}
                     max={100}
                     step={1}
                     value={[levels[key] ?? 0]}
                     onValueChange={([v]) => setLevels(p => ({ ...p, [key]: v }))}
                     className="w-full"
                   />
                 </div>
               ))}
             </div>

             <div className="pt-4 border-t border-border">
               <VoiceSettings 
                 data={form} 
                 onUpdate={(field, value) => setForm(p => ({ ...p, [field]: value }))} 
                 hasApiKey={hasApiKey}
                 character={selectedChar}
               />
             </div>

             <Button onClick={handleSave} disabled={isSaving} className="w-full h-12 rounded-xl gap-2">
               {saved ? <><Check className="w-4 h-4" /> Saved</> : isSaving ? "Saving..." : "Save Changes"}
             </Button>
           </div>
         )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}