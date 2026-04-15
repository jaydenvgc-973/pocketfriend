import React, { useState } from "react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Trash2, RotateCcw, BookOpen, Camera, Heart, BarChart2, User, Briefcase, LogOut, Check, MapPin, Sparkles, Church, DollarSign, Search, GitMerge } from "lucide-react";

const ADMIN_EMAIL = 'murqart@gmail.com';
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import AdminConsole from "@/components/admin/AdminConsole";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import DeleteCharacterDialog from "@/components/home/DeleteCharacterDialog";
import UserPhotoUploader from "@/components/user/UserPhotoUploader";
import CommonQuestions from "@/components/settings/CommonQuestions";
import StorageBackup from "@/components/settings/StorageBackup";
import VoiceAudioSettings from "@/components/settings/VoiceAudioSettings";
import VoiceSettings from "@/components/character/VoiceSettings";
import ManageCharacterList from "@/components/settings/ManageCharacterList";
import SettingsTextFields from "@/components/settings/SettingsTextFields";
import DiagnosticReportViewer from "@/components/settings/DiagnosticReportViewer";
import SuggestedDuplicatesModal from "@/components/settings/SuggestedDuplicatesModal";
import GenericLocationFixer from "@/components/settings/GenericLocationFixer";

export default function Settings() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [charVoiceForms, setCharVoiceForms] = useState({});
  const [savingCharIds, setSavingCharIds] = useState(new Set());
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [showSuggestedDupes, setShowSuggestedDupes] = useState(false);
  const [suggestedDupes, setSuggestedDupes] = useState([]);

  const { settings, isLoading: isLoadingSettings, updateSettings } = useUserSettings();

  const { data: user = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Character.filter({ created_by: user.email }, "-created_date", 100)
      : [],
    enabled: !!user?.email,
  });

  const isAdmin = user?.email === ADMIN_EMAIL;

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await base44.functions.invoke('deleteAccount', {});
      base44.auth.logout();
    } catch (err) {
      setIsDeletingAccount(false);
      setShowDeleteAccountConfirm(false);
      alert('Failed to delete account. Please try again.');
    }
  };

  const mutation = { mutate: updateSettings, isPending: false };

  const deleteMutation = useMutation({
    mutationFn: async ({ id, cause, closeness }) => {
      const activeOthers = characters.filter(c => c.id !== id && c.status !== "deleted");
      const departed = characters.find(c => c.id === id);
      if (departed) {
        await Promise.all(activeOthers.map(c =>
          base44.entities.Character.update(c.id, {
            departed_characters: [
              ...(c.departed_characters || []),
              { name: departed.name, cause, relationship_closeness: closeness }
            ]
          })
        ));
      }
      return base44.entities.Character.delete(id);
    },
    onSuccess: () => {
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["characters", user?.email] });
    },
  });

  const moveBackMutation = useMutation({
    mutationFn: async (id) => {
      return base44.entities.Character.update(id, { status: "active" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters", user?.email] }),
  });

  const movedAwayChars = characters.filter(c => c.status === "moved_away");
  const [isProcessingPayday, setIsProcessingPayday] = useState(false);
  const [paydayResult, setPaydayResult] = useState(null);
  const [isProcessingBills, setIsProcessingBills] = useState(false);
  const [billsResult, setBillsResult] = useState(null);

  const handleForcePayday = async () => {
    setIsProcessingPayday(true);
    setPaydayResult(null);
    try {
      const res = await base44.functions.invoke('processPayroll', {});
      setPaydayResult({ success: true, count: res.data?.processed || 0 });
    } catch (err) {
      setPaydayResult({ success: false });
    } finally {
      setIsProcessingPayday(false);
    }
  };

  const handleForceBills = async () => {
    setIsProcessingBills(true);
    setBillsResult(null);
    try {
      const res = await base44.functions.invoke('processHousingCosts', {});
      setBillsResult({ success: true, count: res.data?.processed || 0 });
    } catch (err) {
      setBillsResult({ success: false });
    } finally {
      setIsProcessingBills(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {pendingDelete && (
        <DeleteCharacterDialog
          character={pendingDelete}
          onConfirm={({ cause, closeness }) => deleteMutation.mutate({ id: pendingDelete.id, cause, closeness })}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>
      <div className="max-w-lg mx-auto px-6 py-6 space-y-8">
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Length</p>
          <Select value={settings.response_length || "medium"} onValueChange={v => { if (!isLoadingSettings) mutation.mutate({ response_length: v }); }}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="long">Long</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Emotional Intensity</p>
          <Select value={settings.emotional_intensity || "medium"} onValueChange={v => { if (!isLoadingSettings) mutation.mutate({ emotional_intensity: v }); }}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm text-foreground">Voice Input</Label>
          <Switch
            checked={settings.voice_enabled || false}
            onCheckedChange={v => { if (!isLoadingSettings) mutation.mutate({ voice_enabled: v }); }}
          />
        </div>
        <div className="space-y-4 pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">World & Holidays</p>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Holiday Observation</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Real U.S. holidays affect schedules, closures, and character behavior</p>
            </div>
            <Switch
              checked={settings.holiday_observation_enabled !== false}
              onCheckedChange={v => {
                if (!isLoadingSettings && settings.id) {
                  mutation.mutate({ holiday_observation_enabled: v });
                }
              }}
            />
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Timing</p>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Response Lag</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Characters wait a realistic time before replying</p>
            </div>
            <Switch
              checked={settings.response_lag_enabled !== false}
              onCheckedChange={v => { if (!isLoadingSettings) mutation.mutate({ response_lag_enabled: v }); }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Typing Speed Delay</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Simulate realistic typing before the message appears</p>
            </div>
            <Switch
              checked={settings.typing_speed_enabled !== false}
              onCheckedChange={v => { if (!isLoadingSettings) mutation.mutate({ typing_speed_enabled: v }); }}
            />
          </div>
          {settings.typing_speed_enabled !== false && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-foreground">Typing Speed</Label>
                <span className="text-xs text-muted-foreground font-medium">{settings.words_per_minute || 41} WPM</span>
              </div>
              <input
                type="range"
                min={15}
                max={120}
                step={1}
                value={settings.words_per_minute || 41}
                onChange={e => { if (!isLoadingSettings) mutation.mutate({ words_per_minute: Number(e.target.value) }); }}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>15 WPM (slow)</span>
                <span>120 WPM (fast)</span>
              </div>
            </div>
          )}
        </div>
        <SettingsTextFields settings={settings} onSave={(data) => mutation.mutate(data)} />
        <div className="pt-4 border-t border-border">
          <UserPhotoUploader
            referenceImages={user.reference_image_urls || []}
            generatedAvatars={user.generated_avatar_urls || []}
            selectedAvatar={user.selected_avatar_url || null}
          />
        </div>
        <VoiceAudioSettings settings={settings} onUpdate={(field, value) => mutation.mutate({ [field]: value })} isSaving={mutation.isPending} />
        <div className="space-y-4 pt-4 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Per-Character Nicknames & Voice</p>
          <p className="text-xs text-muted-foreground">Set a nickname and voice for each character.</p>
          
          {/* Your Profile */}
          <div className="space-y-3 pb-4 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">You</p>
            {user && (
              <div className="border border-border rounded-xl p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-primary">{user.full_name?.[0]?.toUpperCase()}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">{user.full_name}</span>
                </div>
              </div>
            )}
          </div>

          {/* Active Characters */}
          {(() => {
            const activeChars = characters.filter(c => (c.character_type === "active" || c.character_type === "promoted_npc") && c.status === "active");
            return activeChars.length > 0 ? (
              <div className="space-y-3 pb-4 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Characters ({activeChars.length})</p>
                <div className="space-y-4">
                  {activeChars.map(char => {
                    const charVoiceForm = charVoiceForms[char.id] || {
                      voice_enabled: char.voice_enabled || false,
                      voice_name: char.voice_name || "",
                      voice_style_note: char.voice_style_note || "",
                    };
                    const isSavingChar = savingCharIds.has(char.id);
                    return (
                      <div key={char.id} className="border border-border rounded-xl p-3 space-y-3">
                        <div className="flex items-center gap-3">
                          <CharacterAvatar character={char} size="sm" />
                          <span className="text-sm font-medium text-foreground w-24 shrink-0 truncate">{char.name}</span>
                          <input
                            type="text"
                            placeholder={settings.fictional_world_name || "nickname..."}
                            defaultValue={char.nickname_for_user || ""}
                            onBlur={e => {
                              const val = e.target.value.trim();
                              if (val !== (char.nickname_for_user || "")) {
                                base44.entities.Character.update(char.id, { nickname_for_user: val || null })
                                  .then(() => queryClient.invalidateQueries({ queryKey: ["characters", user?.email] }));
                              }
                            }}
                            className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="pl-11">
                          <VoiceSettings 
                            data={charVoiceForm} 
                            onUpdate={(field, value) => setCharVoiceForms(p => ({ ...p, [char.id]: { ...charVoiceForm, [field]: value } }))} 
                            hasApiKey={true}
                            character={char}
                          />
                          {(charVoiceForm.voice_enabled !== char.voice_enabled || charVoiceForm.voice_name !== char.voice_name || charVoiceForm.voice_style_note !== char.voice_style_note) && (
                            <Button 
                              onClick={async () => {
                                setSavingCharIds(p => new Set([...p, char.id]));
                                await base44.entities.Character.update(char.id, {
                                  voice_enabled: charVoiceForm.voice_enabled,
                                  voice_name: charVoiceForm.voice_name,
                                  voice_style_note: charVoiceForm.voice_style_note,
                                });
                                queryClient.invalidateQueries({ queryKey: ["characters", user?.email] });
                                setSavingCharIds(p => { const next = new Set(p); next.delete(char.id); return next; });
                              }} 
                              disabled={isSavingChar} 
                              size="sm"
                              className="w-full mt-2 gap-1 rounded-lg h-8"
                            >
                              {isSavingChar ? "Saving..." : <><Check className="w-3 h-3" /> Save</>}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })()}

          {/* NPC Family */}
          {(() => {
            const familyChars = characters.filter(c => c.character_type === "family_npc" && c.status === "active");
            return familyChars.length > 0 ? (
              <div className="space-y-3 pb-4 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">NPC Family ({familyChars.length})</p>
                <div className="space-y-4">
                  {familyChars.map(char => {
                    const charVoiceForm = charVoiceForms[char.id] || {
                      voice_enabled: char.voice_enabled || false,
                      voice_name: char.voice_name || "",
                      voice_style_note: char.voice_style_note || "",
                    };
                    const isSavingChar = savingCharIds.has(char.id);
                    return (
                      <div key={char.id} className="border border-border rounded-xl p-3 space-y-3">
                        <div className="flex items-center gap-3">
                          <CharacterAvatar character={char} size="sm" />
                          <span className="text-sm font-medium text-foreground w-24 shrink-0 truncate">{char.name}</span>
                          <input
                            type="text"
                            placeholder={settings.fictional_world_name || "nickname..."}
                            defaultValue={char.nickname_for_user || ""}
                            onBlur={e => {
                              const val = e.target.value.trim();
                              if (val !== (char.nickname_for_user || "")) {
                                base44.entities.Character.update(char.id, { nickname_for_user: val || null })
                                  .then(() => queryClient.invalidateQueries({ queryKey: ["characters", user?.email] }));
                              }
                            }}
                            className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="pl-11">
                          <VoiceSettings 
                            data={charVoiceForm} 
                            onUpdate={(field, value) => setCharVoiceForms(p => ({ ...p, [char.id]: { ...charVoiceForm, [field]: value } }))} 
                            hasApiKey={true}
                            character={char}
                          />
                          {(charVoiceForm.voice_enabled !== char.voice_enabled || charVoiceForm.voice_name !== char.voice_name || charVoiceForm.voice_style_note !== char.voice_style_note) && (
                            <Button 
                              onClick={async () => {
                                setSavingCharIds(p => new Set([...p, char.id]));
                                await base44.entities.Character.update(char.id, {
                                  voice_enabled: charVoiceForm.voice_enabled,
                                  voice_name: charVoiceForm.voice_name,
                                  voice_style_note: charVoiceForm.voice_style_note,
                                });
                                queryClient.invalidateQueries({ queryKey: ["characters", user?.email] });
                                setSavingCharIds(p => { const next = new Set(p); next.delete(char.id); return next; });
                              }} 
                              disabled={isSavingChar} 
                              size="sm"
                              className="w-full mt-2 gap-1 rounded-lg h-8"
                            >
                              {isSavingChar ? "Saving..." : <><Check className="w-3 h-3" /> Save</>}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })()}



          {/* NPC Fictitious People - REMOVED (no voice/nickname for social NPCs) */}

          {/* Moved Away & Deleted Characters at bottom */}
          <div className="space-y-4">
            {movedAwayChars.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Characters Away ({movedAwayChars.length})</p>
                <div className="space-y-3">
                  {movedAwayChars.map(char => {
                    const charVoiceForm = charVoiceForms[char.id] || {
                      voice_enabled: char.voice_enabled || false,
                      voice_name: char.voice_name || "",
                      voice_style_note: char.voice_style_note || "",
                    };
                    const isSavingChar = savingCharIds.has(char.id);
                    return (
                      <div key={char.id} className="border border-border rounded-xl p-3 space-y-3">
                        <div className="flex items-center gap-3">
                          <CharacterAvatar character={char} size="sm" />
                          <span className="text-sm font-medium text-foreground w-24 shrink-0 truncate">{char.name}</span>
                          <input
                            type="text"
                            placeholder={settings.fictional_world_name || "nickname..."}
                            defaultValue={char.nickname_for_user || ""}
                            onBlur={e => {
                              const val = e.target.value.trim();
                              if (val !== (char.nickname_for_user || "")) {
                                base44.entities.Character.update(char.id, { nickname_for_user: val || null })
                                  .then(() => queryClient.invalidateQueries({ queryKey: ["characters", user?.email] }));
                              }
                            }}
                            className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="pl-11">
                          <VoiceSettings 
                            data={charVoiceForm} 
                            onUpdate={(field, value) => setCharVoiceForms(p => ({ ...p, [char.id]: { ...charVoiceForm, [field]: value } }))} 
                            hasApiKey={true}
                            character={char}
                          />
                          {(charVoiceForm.voice_enabled !== char.voice_enabled || charVoiceForm.voice_name !== char.voice_name || charVoiceForm.voice_style_note !== char.voice_style_note) && (
                            <Button 
                              onClick={async () => {
                                setSavingCharIds(p => new Set([...p, char.id]));
                                await base44.entities.Character.update(char.id, {
                                  voice_enabled: charVoiceForm.voice_enabled,
                                  voice_name: charVoiceForm.voice_name,
                                  voice_style_note: charVoiceForm.voice_style_note,
                                });
                                queryClient.invalidateQueries({ queryKey: ["characters", user?.email] });
                                setSavingCharIds(p => { const next = new Set(p); next.delete(char.id); return next; });
                              }} 
                              disabled={isSavingChar} 
                              size="sm"
                              className="w-full mt-2 gap-1 rounded-lg h-8"
                            >
                              {isSavingChar ? "Saving..." : <><Check className="w-3 h-3" /> Save</>}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <StorageBackup />
        <CommonQuestions />

        {isAdmin && (
          <div className="pt-4 border-t border-border space-y-1">
            <AdminConsole />
          </div>
        )}

        <div className="pt-4 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">System & Data</p>
          
          <GenericLocationFixer />
          
          {/* Suggested duplicates */}
          <button
            onClick={async () => {
              try {
                const res = await base44.functions.invoke('comprehensiveCharacterDiagnostic', {});
                const dupes = res.data?.issues?.duplicateNames || [];
                setSuggestedDupes(dupes);
                setShowSuggestedDupes(true);
              } catch (err) {
                alert('Failed to load duplicates');
              }
            }}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-amber-500/40 transition-colors text-left mb-3"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <GitMerge className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Suggested Duplicates</p>
              <p className="text-xs text-muted-foreground">Review and merge duplicate characters</p>
            </div>
          </button>

          {/* Auto-merge duplicates */}
          <button
            onClick={async () => {
              if (!window.confirm('Auto-merge all detected duplicate characters into their masters?\n\nThis uses creation date to pick the strongest version.')) return;
              try {
                const res = await base44.functions.invoke('autoMergeDuplicates', {});
                alert(`✓ Merged ${res.data?.merged || 0} duplicate character(s)`);
                queryClient.invalidateQueries({ queryKey: ['characters', user?.email] });
              } catch (err) {
                alert('Auto-merge failed. Try manually in Character Manager.');
              }
            }}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-green-500/40 transition-colors text-left mb-3"
          >
            <div className="w-9 h-9 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <GitMerge className="w-4 h-4 text-green-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Auto-merge Duplicates</p>
              <p className="text-xs text-muted-foreground">Automatically merge all detected duplicate characters</p>
            </div>
          </button>

          {/* Diagnostic button */}
          <button
            onClick={() => setShowDiagnostic(!showDiagnostic)}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-amber-500/40 transition-colors text-left mb-3"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Search className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Run Character Diagnostic</p>
              <p className="text-xs text-muted-foreground">Find duplicates, ghosts, and broken references</p>
            </div>
          </button>

          {showDiagnostic && (
             <div className="mb-6 bg-secondary/30 border border-border rounded-xl p-4">
               <DiagnosticReportViewer />
             </div>
           )}

          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 mt-6">Manage Characters</p>
          <div className="mb-6 bg-card border border-border rounded-2xl p-4">
            <ManageCharacterList />
          </div>

           <button
            onClick={handleForcePayday}
            disabled={isProcessingPayday}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left mb-2 disabled:opacity-50"
          >
            <div className="w-9 h-9 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <DollarSign className="w-4 h-4 text-green-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Force a Payday</p>
              <p className="text-xs text-muted-foreground">
                {isProcessingPayday ? "Processing payroll..." : paydayResult?.success ? `Done — ${paydayResult.count} character(s) paid` : paydayResult?.success === false ? "Payroll failed. Try again." : "Manually trigger payroll for all working characters"}
              </p>
            </div>
          </button>
          <button
            onClick={handleForceBills}
            disabled={isProcessingBills}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-destructive/40 transition-colors text-left mb-2 disabled:opacity-50"
          >
            <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <DollarSign className="w-4 h-4 text-destructive" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Force Pay Bills</p>
              <p className="text-xs text-muted-foreground">
                {isProcessingBills ? "Processing bills..." : billsResult?.success ? `Done — ${billsResult.count} character(s) billed` : billsResult?.success === false ? "Billing failed. Try again." : "Deduct rent & utilities from all characters now"}
              </p>
            </div>
          </button>
          <Link to="/edit-character-story">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Stories</p>
                <p className="text-xs text-muted-foreground">Update backstory, situation, family history & more</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-photos">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Camera className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Photos</p>
                <p className="text-xs text-muted-foreground">Update avatar and reference photos</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-emotions">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Heart className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Emotions</p>
                <p className="text-xs text-muted-foreground">Triggers, emotional state, baggage & reactions</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-relationships">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BarChart2 className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Relationship Levels</p>
                <p className="text-xs text-muted-foreground">Respect, friendship, romantic, attraction & chosen family</p>
              </div>
            </button>
          </Link>
          <Link to="/locations" className="mt-2 block">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Location References</p>
                <p className="text-xs text-muted-foreground">Upload reference images for consistent visual environments</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-traits" className="mt-2 block">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Traits & Quirks</p>
                <p className="text-xs text-muted-foreground">Photogenic, dry humor, night owl, flirty & more</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-needs" className="mt-2 block">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BarChart2 className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Needs</p>
                <p className="text-xs text-muted-foreground">Manually adjust hunger, energy, health, mental & more</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-religion" className="mt-2 block">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Church className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Religion</p>
                <p className="text-xs text-muted-foreground">Religion, belief system & devoutness level</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-profile" className="mt-2 block">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Briefcase className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Occupation, Education & Relationships</p>
                <p className="text-xs text-muted-foreground">Job, education, inter-character relationships with bi-directional sync</p>
              </div>
            </button>
          </Link>
        </div>

        <div className="pt-4 pb-2 space-y-3">
          <button
            onClick={() => base44.auth.logout()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
          >
            Log out
          </button>

          {!isAdmin && !showDeleteAccountConfirm && (
            <button
              onClick={() => setShowDeleteAccountConfirm(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-muted-foreground text-sm hover:text-destructive transition-colors"
            >
              Delete Account
            </button>
          )}

          {!isAdmin && showDeleteAccountConfirm && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground text-center">Delete your account?</p>
              <p className="text-xs text-muted-foreground text-center">This will permanently delete all your characters, conversations, and data. This cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteAccountConfirm(false)}
                  className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeletingAccount}
                  className="flex-1 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-60"
                >
                  {isDeletingAccount ? "Deleting..." : "Yes, delete"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="pb-28" />
      <BottomNav />

      <SuggestedDuplicatesModal 
        isOpen={showSuggestedDupes} 
        onClose={() => setShowSuggestedDupes(false)}
        duplicates={suggestedDupes}
        onMergeComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['characters', user?.email] });
          setShowSuggestedDupes(false);
        }}
      />
    </div>
  );
}