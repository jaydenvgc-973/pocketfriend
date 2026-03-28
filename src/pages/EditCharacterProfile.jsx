import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Check, Sparkles, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";

const JOB_TYPES = [
  "Retail / Customer Service", "Food Service / Restaurant", "Healthcare / Medical",
  "Corporate / Office", "Education / Teaching", "Creative / Arts", "Tech / Software",
  "Trades / Construction", "Freelance / Self-employed", "Student", "Student & Internship",
  "Unemployed", "Crime / Illegal", "Between jobs"
];

const KNOWN_REL_TYPES = ["Friend", "Partner", "Spouse", "Sibling", "Cousin", "Co-worker", "Boss", "Mentor", "Rival", "Ex"];

const REL_LEVELS = [
  { key: "friendship_level", label: "Friendship", color: "text-emerald-400" },
  { key: "romantic_level", label: "Romantic", color: "text-pink-400" },
  { key: "attraction_level", label: "Attraction", color: "text-orange-400" },
  { key: "chosen_family_level", label: "Chosen Family", color: "text-purple-400" },
];

const TABS = ["Occupation", "Education", "Relationships", "Voice"];

export default function EditCharacterProfile() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [activeTab, setActiveTab] = useState("Occupation");
  const [form, setForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isGeneratingOccupation, setIsGeneratingOccupation] = useState(false);
  const [isGeneratingCriminalRecord, setIsGeneratingCriminalRecord] = useState(false);
  // For character relationships
  const [expandedRelId, setExpandedRelId] = useState(null);

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

  const handleSelect = (char) => {
    setSelectedChar(char);
    setActiveTab("Occupation");
    setForm({
      // Occupation
      job_title: char.work_details?.job_title || "",
      workplace_type: char.work_details?.workplace_type || "",
      work_environment: char.work_details?.work_environment || "",
      criminal_record: char.criminal_record || "",
      // Education
      current_education_activity: char.current_education_activity || "none",
      education_course_name: char.education_details?.course_name || "",
      education_institution: char.education_details?.institution || "",
      education_location: char.education_details?.location || "",
      current_job_training_activity: char.current_job_training_activity || "none",
      job_training_name: char.job_training_details?.training_name || "",
      job_training_company: char.job_training_details?.company || "",
      job_training_position: char.job_training_details?.position_title || "",
      // Character relationships (fictional_relationships pointing to other characters)
      char_relationships: (char.fictional_relationships || []).filter(r => r.related_character_id),
      // Voice
      voice_enabled: char.voice_enabled || false,
      voice_name: char.voice_name || "",
      voice_style_note: char.voice_style_note || "",
    });
    setSaved(false);
  };

  const generateOccupation = async () => {
    if (!selectedChar) return;
    setIsGeneratingOccupation(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Generate a realistic occupation description for a character named ${selectedChar.name}, ${selectedChar.age_range || "adult"} ${selectedChar.gender || "person"} with this personality: ${selectedChar.personality_summary || "unknown"}. Their current job type is: ${form.workplace_type || "unknown"}. Return JSON with: job_title (string), work_environment (2-3 sentence description of their specific work environment and day-to-day).`,
      response_json_schema: {
        type: "object",
        properties: {
          job_title: { type: "string" },
          work_environment: { type: "string" }
        }
      }
    });
    setForm(p => ({ ...p, job_title: result.job_title || p.job_title, work_environment: result.work_environment || p.work_environment }));
    setIsGeneratingOccupation(false);
  };

  const generateCriminalRecord = async () => {
    if (!selectedChar) return;
    setIsGeneratingCriminalRecord(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Generate a realistic, brief criminal record for a fictional character named ${selectedChar.name}, ${selectedChar.age_range || "adult"} ${selectedChar.gender || "person"}. Personality: ${selectedChar.personality_summary || "unknown"}. Background: ${selectedChar.background_story || "unknown"}. Make it feel grounded and plausible — not dramatic. Could be minor or major. Return a short paragraph describing the offenses, dates (made up but realistic), and outcomes.`
    });
    setForm(p => ({ ...p, criminal_record: result }));
    setIsGeneratingCriminalRecord(false);
  };

  const addCharRelationship = (otherChar) => {
    setForm(p => {
      const already = (p.char_relationships || []).some(r => r.related_character_id === otherChar.id);
      if (already) return p;
      return {
        ...p,
        char_relationships: [
          ...(p.char_relationships || []),
          {
            related_character_id: otherChar.id,
            person_name: otherChar.name,
            relationship_type: "Friend",
            description: "",
            friendship_level: 50,
            romantic_level: 0,
            attraction_level: 0,
            chosen_family_level: 0,
          }
        ]
      };
    });
    setExpandedRelId(otherChar.id);
  };

  const removeCharRelationship = (charId) => {
    setForm(p => ({ ...p, char_relationships: (p.char_relationships || []).filter(r => r.related_character_id !== charId) }));
    if (expandedRelId === charId) setExpandedRelId(null);
  };

  const updateCharRel = (charId, field, value) => {
    setForm(p => ({
      ...p,
      char_relationships: (p.char_relationships || []).map(r =>
        r.related_character_id === charId ? { ...r, [field]: value } : r
      )
    }));
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setIsSaving(true);

    const updatedData = {
      work_details: {
        job_title: form.job_title,
        workplace_type: form.workplace_type,
        work_environment: form.work_environment,
      },
      criminal_record: form.criminal_record,
      current_education_activity: form.current_education_activity,
      education_details: {
        course_name: form.education_course_name,
        institution: form.education_institution,
        location: form.education_location,
      },
      current_job_training_activity: form.current_job_training_activity,
      job_training_details: {
        training_name: form.job_training_name,
        company: form.job_training_company,
        position_title: form.job_training_position,
      },
      // Merge char_relationships into fictional_relationships (keep non-character ones too)
      fictional_relationships: [
        ...(selectedChar.fictional_relationships || []).filter(r => !r.related_character_id),
        ...(form.char_relationships || []),
      ],
      // Voice
      voice_enabled: form.voice_enabled,
      voice_name: form.voice_name,
      voice_style_note: form.voice_style_note,
    };

    // Save the main character
    await base44.entities.Character.update(selectedChar.id, updatedData);

    // Bi-directional sync: update each linked character's fictional_relationships
    await Promise.all((form.char_relationships || []).map(async (rel) => {
      const otherChar = characters.find(c => c.id === rel.related_character_id);
      if (!otherChar) return;

      const existingRels = otherChar.fictional_relationships || [];
      const alreadyLinked = existingRels.find(r => r.related_character_id === selectedChar.id);

      const myEntry = {
        related_character_id: selectedChar.id,
        person_name: selectedChar.name,
        relationship_type: rel.relationship_type,
        description: rel.description || "",
        friendship_level: rel.friendship_level ?? 50,
        romantic_level: rel.romantic_level ?? 0,
        attraction_level: rel.attraction_level ?? 0,
        chosen_family_level: rel.chosen_family_level ?? 0,
      };

      const updatedRels = alreadyLinked
        ? existingRels.map(r => r.related_character_id === selectedChar.id ? myEntry : r)
        : [...existingRels, myEntry];

      await base44.entities.Character.update(rel.related_character_id, { fictional_relationships: updatedRels });
    }));

    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const otherChars = characters.filter(c => c.id !== selectedChar?.id && c.status !== "deleted");

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
          {selectedChar ? `Edit Profile — ${selectedChar.name}` : "Edit Character Profile"}
        </h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {!selectedChar ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a character to edit their occupation, education, or relationships.</p>
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
        ) : (
          <div className="space-y-5">
            {/* Tabs */}
            <div className="flex gap-1 bg-secondary rounded-xl p-1">
              {TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${activeTab === tab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* OCCUPATION TAB */}
            {activeTab === "Occupation" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Job Details</label>
                  <button onClick={generateOccupation} disabled={isGeneratingOccupation} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50">
                    <Sparkles className="w-3 h-3" />{isGeneratingOccupation ? "Generating..." : "Auto-generate"}
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Job Type</label>
                  <Select value={form.workplace_type} onValueChange={v => setForm(p => ({ ...p, workplace_type: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select job type" /></SelectTrigger>
                    <SelectContent>
                      {JOB_TYPES.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Job Title</label>
                  <Input value={form.job_title} onChange={e => setForm(p => ({ ...p, job_title: e.target.value }))} placeholder="e.g. Nurse, Graphic Designer, Barista" className="rounded-xl text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Work Environment Description</label>
                  <Textarea value={form.work_environment} onChange={e => setForm(p => ({ ...p, work_environment: e.target.value }))} placeholder="Describe their day-to-day work environment..." className="rounded-xl min-h-[80px] text-sm resize-none" />
                </div>
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Criminal Record</label>
                    <button onClick={generateCriminalRecord} disabled={isGeneratingCriminalRecord} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50">
                      <Sparkles className="w-3 h-3" />{isGeneratingCriminalRecord ? "Generating..." : "Auto-generate"}
                    </button>
                  </div>
                  <Textarea value={form.criminal_record} onChange={e => setForm(p => ({ ...p, criminal_record: e.target.value }))} placeholder="Leave blank for no criminal record..." className="rounded-xl min-h-[80px] text-sm resize-none" />
                </div>
              </div>
            )}

            {/* EDUCATION TAB */}
            {activeTab === "Education" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Education</label>
                  <Select value={form.current_education_activity} onValueChange={v => setForm(p => ({ ...p, current_education_activity: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="studying">Studying</SelectItem>
                      <SelectItem value="attending_classes">Attending Classes</SelectItem>
                      <SelectItem value="researching">Researching</SelectItem>
                      <SelectItem value="online_course">Online Course</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.current_education_activity !== "none" && (
                  <>
                    <Input value={form.education_course_name} onChange={e => setForm(p => ({ ...p, education_course_name: e.target.value }))} placeholder="Course / Program name" className="rounded-xl text-sm" />
                    <Input value={form.education_institution} onChange={e => setForm(p => ({ ...p, education_institution: e.target.value }))} placeholder="Institution" className="rounded-xl text-sm" />
                    <Input value={form.education_location} onChange={e => setForm(p => ({ ...p, education_location: e.target.value }))} placeholder="Location (city, online...)" className="rounded-xl text-sm" />
                  </>
                )}
                <div className="pt-2 border-t border-border space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Job Training</label>
                  <Select value={form.current_job_training_activity} onValueChange={v => setForm(p => ({ ...p, current_job_training_activity: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="on_the_job_training">On-the-job Training</SelectItem>
                      <SelectItem value="certification">Certification</SelectItem>
                      <SelectItem value="apprenticeship">Apprenticeship</SelectItem>
                      <SelectItem value="bootcamp">Bootcamp</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.current_job_training_activity !== "none" && (
                    <>
                      <Input value={form.job_training_name} onChange={e => setForm(p => ({ ...p, job_training_name: e.target.value }))} placeholder="Training / Program name" className="rounded-xl text-sm" />
                      <Input value={form.job_training_company} onChange={e => setForm(p => ({ ...p, job_training_company: e.target.value }))} placeholder="Company" className="rounded-xl text-sm" />
                      <Input value={form.job_training_position} onChange={e => setForm(p => ({ ...p, job_training_position: e.target.value }))} placeholder="Position title" className="rounded-xl text-sm" />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* VOICE TAB */}
            {activeTab === "Voice" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Configure voice settings for this character. Voices only play on the Chat page.</p>
                <VoiceSettings 
                  data={form} 
                  onUpdate={(field, value) => setForm(p => ({ ...p, [field]: value }))} 
                  hasApiKey={hasApiKey} 
                />
              </div>
            )}

            {/* RELATIONSHIPS TAB */}
            {activeTab === "Relationships" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Define how {selectedChar.name} relates to other characters. Both characters will be updated.</p>
                {/* Linked characters */}
                {(form.char_relationships || []).map(rel => {
                  const otherChar = characters.find(c => c.id === rel.related_character_id);
                  if (!otherChar) return null;
                  const isExpanded = expandedRelId === rel.related_character_id;
                  return (
                    <div key={rel.related_character_id} className="border border-border rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 p-3">
                        <CharacterAvatar character={otherChar} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{otherChar.name}</p>
                          <p className="text-xs text-muted-foreground">{rel.relationship_type}</p>
                        </div>
                        <button onClick={() => setExpandedRelId(isExpanded ? null : rel.related_character_id)} className="text-xs text-primary px-2 py-1 rounded-lg hover:bg-primary/10">
                          {isExpanded ? "Collapse" : "Edit"}
                        </button>
                        <button onClick={() => removeCharRelationship(rel.related_character_id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                          <div className="flex flex-wrap gap-2">
                            {KNOWN_REL_TYPES.map(type => (
                              <button key={type} onClick={() => updateCharRel(rel.related_character_id, "relationship_type", type)}
                                className={`px-3 py-1 rounded-full text-xs border transition-colors ${rel.relationship_type === type ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
                                {type}
                              </button>
                            ))}
                          </div>
                          {REL_LEVELS.map(({ key, label, color }) => (
                            <div key={key} className="space-y-1">
                              <div className="flex justify-between">
                                <span className={`text-xs font-medium ${color}`}>{label}</span>
                                <span className="text-xs text-muted-foreground">{rel[key] ?? 0}</span>
                              </div>
                              <Slider min={0} max={100} step={1} value={[rel[key] ?? 0]} onValueChange={([v]) => updateCharRel(rel.related_character_id, key, v)} />
                            </div>
                          ))}
                          <div>
                            <label className="text-xs text-muted-foreground">Relationship note (optional)</label>
                            <Textarea value={rel.description || ""} onChange={e => updateCharRel(rel.related_character_id, "description", e.target.value)} placeholder="How they know each other, history, current status..." className="rounded-xl min-h-[60px] text-sm resize-none mt-1" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add relationship */}
                <div className="border border-dashed border-border rounded-xl p-3 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Add relationship with:</p>
                  {otherChars.filter(c => !(form.char_relationships || []).some(r => r.related_character_id === c.id)).map(c => (
                    <button key={c.id} onClick={() => addCharRelationship(c)} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-secondary transition-colors text-left">
                      <CharacterAvatar character={c} size="sm" />
                      <span className="text-sm text-foreground">{c.name}</span>
                      <Plus className="w-3.5 h-3.5 text-primary ml-auto" />
                    </button>
                  ))}
                  {otherChars.filter(c => !(form.char_relationships || []).some(r => r.related_character_id === c.id)).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">All characters are linked.</p>
                  )}
                </div>
              </div>
            )}

            <Button onClick={handleSave} disabled={isSaving} className="w-full h-12 rounded-xl gap-2 mt-4">
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