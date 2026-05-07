import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Sparkles, Plus, X } from "lucide-react";
import { useSettingsCharacters } from "@/hooks/useSettingsCharacters";
import SettingsCharacterList from "@/components/settings/SettingsCharacterList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";
import OccupationLocationPicker from "@/components/character/OccupationLocationPicker";
import JobBlock from "@/components/character/JobBlock";
import { filterOutTemporaryNPCs } from "@/lib/temporaryNPCUtils";
import { RELATIONSHIP_TYPES, RELATIONSHIP_CATEGORIES, getInverseRelationType, isBilateralRelationship, isPairedRelationship } from "@/lib/relationshipTypeDefinitions";

const JOB_TYPES = [
  "Retail / Customer Service", "Food Service / Restaurant", "Healthcare / Medical",
  "Corporate / Office", "Education / Teaching", "Creative / Arts", "Tech / Software",
  "Trades / Construction", "Freelance / Self-employed", "Student", "Student & Internship",
  "Unemployed", "Crime / Illegal", "Between jobs"
];

const REL_LEVELS = [
  { key: "respect_level", label: "Respect", color: "text-blue-400" },
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
  // For occupation/education location links
  const [occupationLink, setOccupationLink] = useState({ locationId: null, locationName: null, title: '' });
  const [occupationLink2, setOccupationLink2] = useState({ locationId: null, locationName: null, title: '' });
  const [educationLink, setEducationLink] = useState({ locationId: null, locationName: null, title: '' });
  // Second job schedule — loaded from LocationReference.worker_shifts[charId] when a workplace is linked
  const [job2Schedule, setJob2Schedule] = useState({ work_days: [], work_start_time: '', work_end_time: '' });
  const [educationEntries, setEducationEntries] = useState([]);
  const [jobTrainingEntries, setJobTrainingEntries] = useState([]);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { sections, allCharacters: characters, isLoading } = useSettingsCharacters(currentUser, "profile");

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;

  const handleSelect = async (char) => {
    setSelectedChar(char);
    setActiveTab("Occupation");
    setOccupationLink({ locationId: char.occupation_location_id || null, locationName: char.occupation_location_name || null, title: char.work_details?.job_title || '' });
    const secondJob = char.additional_occupation_locations?.[0] || {};
    setOccupationLink2({ locationId: secondJob.location_id || null, locationName: secondJob.location_name || null, title: secondJob.job_title || '' });
    setEducationLink({ locationId: char.education_location_id || null, locationName: char.education_location_name || null, title: char.education_details?.course_name || '' });

    // Load primary job schedule from LocationReference.worker_shifts (authoritative source)
    // Falls back to Character entity fields only if no location shift data exists.
    let primaryWorkDays = char.work_days || [];
    let primaryWorkStart = char.work_start_time || '';
    let primaryWorkEnd = char.work_end_time || '';
    if (char.occupation_location_id) {
      const locArr = await base44.entities.LocationReference.filter({ id: char.occupation_location_id }).catch(() => []);
      const loc = locArr?.[0];
      if (loc?.worker_shifts?.[char.id]) {
        const shift = loc.worker_shifts[char.id];
        primaryWorkDays = shift.days || primaryWorkDays;
        primaryWorkStart = shift.start || primaryWorkStart;
        primaryWorkEnd = shift.end || primaryWorkEnd;
      }
    }

    // Load second job schedule from LocationReference.worker_shifts if a workplace is linked
    let loadedJob2Schedule = { work_days: [], work_start_time: '', work_end_time: '' };
    if (secondJob.location_id) {
      const locArr = await base44.entities.LocationReference.filter({ id: secondJob.location_id }).catch(() => []);
      const loc = locArr?.[0];
      if (loc?.worker_shifts?.[char.id]) {
        const shift = loc.worker_shifts[char.id];
        loadedJob2Schedule = {
          work_days: shift.days || [],
          work_start_time: shift.start || '',
          work_end_time: shift.end || '',
        };
      }
    }
    setJob2Schedule(loadedJob2Schedule);

    setForm({
      // Occupation — schedule loaded from LocationReference.worker_shifts above (authoritative)
      job_title: char.work_details?.job_title || "",
      workplace_type: char.work_details?.workplace_type || "",
      work_environment: char.work_details?.work_environment || "",
      work_start_time: primaryWorkStart,
      work_end_time: primaryWorkEnd,
      work_days: primaryWorkDays,
      // Second job
      job2_title: secondJob.job_title || "",
      job2_workplace_type: secondJob.workplace_type || "",
      job2_work_environment: secondJob.work_environment || "",
      criminal_record: char.criminal_record || "",
      // Education
      current_education_activity: char.current_education_activity || "none",
      education_start_date: char.education_start_date || "",
      education_expected_completion_date: char.education_expected_completion_date || "",
      education_course_name: char.education_details?.course_name || "",
      education_institution: char.education_details?.institution || "",
      education_location: char.education_details?.location || "",
      job_training_start_date: char.job_training_start_date || "",
      job_training_expected_completion_date: char.job_training_expected_completion_date || "",
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
    setEducationEntries(char.completed_education || []);
    setJobTrainingEntries(char.completed_job_training || []);
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
            respect_level: 50,
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

    // Build second job entry — update index 0, preserve all entries beyond index 0 untouched
    const existingAdditional = selectedChar.additional_occupation_locations || [];
    const updatedSecondJob = {
      ...(existingAdditional[0] || {}), // preserve any existing fields not shown in UI
      location_id: occupationLink2.locationId || null,
      location_name: occupationLink2.locationName || null,
      job_title: form.job2_title || "",
      workplace_type: form.job2_workplace_type || "",
      work_environment: form.job2_work_environment || "",
    };
    const hasSecondJobData = form.job2_title || form.job2_work_environment || form.job2_workplace_type || occupationLink2.locationId;
    // If user cleared all second job fields, remove index 0; otherwise update it. Always keep entries beyond index 0.
    const secondJobEntry = [
      ...(hasSecondJobData ? [updatedSecondJob] : existingAdditional[0] ? [] : []),
      ...existingAdditional.slice(1), // preserve any entries at index 1+ unchanged
    ];

    const updatedData = {
      work_details: {
        job_title: form.job_title,
        workplace_type: form.workplace_type,
        work_environment: form.work_environment,
      },
      work_start_time: form.work_start_time || null,
      work_end_time: form.work_end_time || null,
      work_days: form.work_days || [],
      additional_occupation_locations: secondJobEntry,
      criminal_record: form.criminal_record,
      current_education_activity: form.current_education_activity,
      education_start_date: form.education_start_date || null,
      education_expected_completion_date: form.education_expected_completion_date || null,
      education_details: {
        course_name: form.education_course_name,
        institution: form.education_institution,
        location: form.education_location,
      },
      current_job_training_activity: form.current_job_training_activity,
      job_training_start_date: form.job_training_start_date || null,
      job_training_expected_completion_date: form.job_training_expected_completion_date || null,
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
      // Education and job training history
      completed_education: educationEntries,
      completed_job_training: jobTrainingEntries,
    };

    // Save the main character
    await base44.entities.Character.update(selectedChar.id, {
      ...updatedData,
      occupation_location_id: occupationLink.locationId || null,
      occupation_location_name: occupationLink.locationName || null,
      education_location_id: educationLink.locationId || null,
      education_location_name: educationLink.locationName || null,
    });

    // If occupation location was linked, add character to that location as worker
    // AND sync the primary job schedule back to LocationReference.worker_shifts (authoritative source)
    if (occupationLink.locationId) {
      base44.functions.invoke('linkOccupationToLocation', {
        characterId: selectedChar.id,
        locationId: occupationLink.locationId,
        linkType: 'occupation',
        title: occupationLink.title || form.job_title,
        removeLocationId: selectedChar.occupation_location_id !== occupationLink.locationId ? selectedChar.occupation_location_id : null,
      }).catch(() => {});

      // Write primary job schedule to LocationReference.worker_shifts so Location page stays in sync
      if (form.work_start_time || form.work_end_time || form.work_days?.length > 0) {
        base44.entities.LocationReference.filter({ id: occupationLink.locationId })
          .then(locArr => {
            const loc = locArr?.[0];
            if (!loc) return;
            const existingShifts = loc.worker_shifts || {};
            const updatedShifts = {
              ...existingShifts,
              [selectedChar.id]: {
                ...(existingShifts[selectedChar.id] || {}),
                start: form.work_start_time || existingShifts[selectedChar.id]?.start || '',
                end: form.work_end_time || existingShifts[selectedChar.id]?.end || '',
                days: form.work_days?.length > 0 ? form.work_days : (existingShifts[selectedChar.id]?.days || []),
              }
            };
            return base44.entities.LocationReference.update(loc.id, { worker_shifts: updatedShifts });
          })
          .catch(() => {});
      }
    }

    // If second occupation location was linked, sync it and save its schedule to worker_shifts
    if (occupationLink2.locationId) {
      base44.functions.invoke('linkOccupationToLocation', {
        characterId: selectedChar.id,
        locationId: occupationLink2.locationId,
        linkType: 'occupation',
        title: occupationLink2.title || form.job2_title,
        removeLocationId: null,
      }).catch(() => {});

      // Save second job schedule to LocationReference.worker_shifts[charId]
      // Only write if the user has actually set schedule data — never overwrite with blanks
      if (job2Schedule.work_start_time || job2Schedule.work_end_time || job2Schedule.work_days?.length > 0) {
        base44.entities.LocationReference.filter({ id: occupationLink2.locationId })
          .then(locArr => {
            const loc = locArr?.[0];
            if (!loc) return;
            const existingShifts = loc.worker_shifts || {};
            const updatedShifts = {
              ...existingShifts,
              [selectedChar.id]: {
                ...(existingShifts[selectedChar.id] || {}),
                start: job2Schedule.work_start_time || existingShifts[selectedChar.id]?.start || '',
                end: job2Schedule.work_end_time || existingShifts[selectedChar.id]?.end || '',
                days: job2Schedule.work_days?.length > 0 ? job2Schedule.work_days : (existingShifts[selectedChar.id]?.days || []),
              }
            };
            return base44.entities.LocationReference.update(loc.id, { worker_shifts: updatedShifts });
          })
          .catch(() => {});
      }
    }

    // If education location was linked, add character to that location as student
    if (educationLink.locationId) {
      base44.functions.invoke('linkOccupationToLocation', {
        characterId: selectedChar.id,
        locationId: educationLink.locationId,
        linkType: 'education',
        title: educationLink.title || form.education_course_name,
        removeLocationId: selectedChar.education_location_id !== educationLink.locationId ? selectedChar.education_location_id : null,
      }).catch(() => {});
    }

    // Bi-directional sync — routed through backend function.
    // Backend owns all ownership validation (owner_email only, no created_by).
    // asServiceRole is used server-side only, never here.
    await Promise.all((form.char_relationships || []).map(async (rel) => {
      if (!rel.related_character_id) return;

      const relTypeKey = Object.keys(RELATIONSHIP_TYPES).find(k => RELATIONSHIP_TYPES[k].label === rel.relationship_type) || rel.relationship_type;

      const relationshipEntry = {
        related_character_id: selectedChar.id,
        person_name: selectedChar.name,
        relationship_type: relTypeKey,
        description: rel.description || "",
        respect_level: rel.respect_level ?? 50,
        friendship_level: rel.friendship_level ?? 50,
        romantic_level: rel.romantic_level ?? 0,
        attraction_level: rel.attraction_level ?? 0,
        chosen_family_level: rel.chosen_family_level ?? 0,
      };

      await base44.functions.invoke("syncRelatedCharacterRelationship", {
        characterId: selectedChar.id,
        relatedCharacterId: rel.related_character_id,
        relationshipEntry,
      });
    }));

    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Only active_created_character records are valid targets for "Characters They Know"
  const otherChars = characters.filter(c =>
    c.id !== selectedChar?.id &&
    !['deleted','soft_deleted','merged'].includes(c.status) &&
    c.character_type === 'active_created_character'
  );
  
  // Characters They Know: ONLY active_created_character (explicit match)
  const filteredCharRelationships = selectedChar
    ? filterOutTemporaryNPCs(form.char_relationships || []).filter(r => {
        const target = characters.find(c => c.id === r.related_character_id);
        return target && target.character_type === "active_created_character";
      })
    : [];

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
            {isLoading ? (
              <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
            ) : (
              <SettingsCharacterList
                sections={sections}
                onSelect={handleSelect}
                renderSubtitle={char => char.personality_summary?.split(".")[0]}
                emptyMessage="No characters yet."
              />
            )}
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
                {/* Auto-generate */}
                <div className="flex justify-end">
                  <button onClick={generateOccupation} disabled={isGeneratingOccupation} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50">
                    <Sparkles className="w-3 h-3" />{isGeneratingOccupation ? "Generating..." : "Auto-generate primary job"}
                  </button>
                </div>

                {/* PRIMARY JOB */}
                <JobBlock
                  label="Primary Job"
                  characterId={selectedChar?.id}
                  jobType={form.workplace_type}
                  onJobTypeChange={v => setForm(p => ({ ...p, workplace_type: v }))}
                  jobTitle={form.job_title}
                  onJobTitleChange={v => setForm(p => ({ ...p, job_title: v }))}
                  workEnvironment={form.work_environment}
                  onWorkEnvironmentChange={v => setForm(p => ({ ...p, work_environment: v }))}
                  workDays={form.work_days}
                  onWorkDaysChange={v => setForm(p => ({ ...p, work_days: v }))}
                  workStartTime={form.work_start_time}
                  onWorkStartTimeChange={v => setForm(p => ({ ...p, work_start_time: v }))}
                  workEndTime={form.work_end_time}
                  onWorkEndTimeChange={v => setForm(p => ({ ...p, work_end_time: v }))}
                  locationLink={occupationLink}
                  onLocationLinkChange={setOccupationLink}
                />

                {/* SECOND JOB */}
                <JobBlock
                  label="Second Job"
                  characterId={selectedChar?.id}
                  jobType={form.job2_workplace_type}
                  onJobTypeChange={v => setForm(p => ({ ...p, job2_workplace_type: v }))}
                  jobTitle={form.job2_title}
                  onJobTitleChange={v => setForm(p => ({ ...p, job2_title: v }))}
                  workEnvironment={form.job2_work_environment}
                  onWorkEnvironmentChange={v => setForm(p => ({ ...p, job2_work_environment: v }))}
                  workDays={job2Schedule.work_days}
                  onWorkDaysChange={v => setJob2Schedule(p => ({ ...p, work_days: v }))}
                  workStartTime={job2Schedule.work_start_time}
                  onWorkStartTimeChange={v => setJob2Schedule(p => ({ ...p, work_start_time: v }))}
                  workEndTime={job2Schedule.work_end_time}
                  onWorkEndTimeChange={v => setJob2Schedule(p => ({ ...p, work_end_time: v }))}
                  locationLink={occupationLink2}
                  onLocationLinkChange={setOccupationLink2}
                />

                {/* Criminal Record */}
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
                <Input value={form.education_course_name} onChange={e => setForm(p => ({ ...p, education_course_name: e.target.value }))} placeholder="Course / Program name" className="rounded-xl text-sm" />
                <Input value={form.education_institution} onChange={e => setForm(p => ({ ...p, education_institution: e.target.value }))} placeholder="Institution" className="rounded-xl text-sm" />
                <Input value={form.education_location} onChange={e => setForm(p => ({ ...p, education_location: e.target.value }))} placeholder="Location (city, online...)" className="rounded-xl text-sm" />
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Start Date</label>
                    <Input type="date" value={form.education_start_date} onChange={e => setForm(p => ({ ...p, education_start_date: e.target.value }))} className="rounded-xl text-sm" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Expected Completion</label>
                    <Input type="date" value={form.education_expected_completion_date} onChange={e => setForm(p => ({ ...p, education_expected_completion_date: e.target.value }))} className="rounded-xl text-sm" />
                  </div>
                </div>
                {/* Location link for education */}
                <div className="pt-2 border-t border-border">
                  <OccupationLocationPicker
                    characterId={selectedChar?.id}
                    linkType="education"
                    currentLocationId={educationLink.locationId}
                    currentTitle={educationLink.title}
                    onLinkChange={setEducationLink}
                    placeholder="e.g. Psychology 101, MBA Program"
                  />
                </div>

                {/* Completed Education History */}
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed Education</label>
                    <button onClick={() => setEducationEntries([...educationEntries, { course_name: "", institution: "", start_date: "", completion_date: "" }])} className="text-xs text-primary hover:text-primary/80">+ Add</button>
                  </div>
                  {educationEntries.map((entry, idx) => (
                    <div key={idx} className="space-y-2 p-3 rounded-lg bg-secondary/30 border border-border">
                      <div className="flex justify-between items-start">
                        <div className="flex-1 space-y-2">
                          <Input value={entry.course_name || ""} onChange={e => { const newEntries = [...educationEntries]; newEntries[idx].course_name = e.target.value; setEducationEntries(newEntries); }} placeholder="Course name" className="rounded-xl text-sm" />
                          <Input value={entry.institution || ""} onChange={e => { const newEntries = [...educationEntries]; newEntries[idx].institution = e.target.value; setEducationEntries(newEntries); }} placeholder="Institution" className="rounded-xl text-sm" />
                          <div className="flex gap-2">
                            <Input type="date" value={entry.start_date || ""} onChange={e => { const newEntries = [...educationEntries]; newEntries[idx].start_date = e.target.value; setEducationEntries(newEntries); }} className="rounded-xl text-sm flex-1" />
                            <Input type="date" value={entry.completion_date || ""} onChange={e => { const newEntries = [...educationEntries]; newEntries[idx].completion_date = e.target.value; setEducationEntries(newEntries); }} className="rounded-xl text-sm flex-1" />
                          </div>
                        </div>
                        <button onClick={() => setEducationEntries(educationEntries.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive ml-2"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>

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
                  <Input value={form.job_training_name} onChange={e => setForm(p => ({ ...p, job_training_name: e.target.value }))} placeholder="Training / Program name" className="rounded-xl text-sm" />
                  <Input value={form.job_training_company} onChange={e => setForm(p => ({ ...p, job_training_company: e.target.value }))} placeholder="Company" className="rounded-xl text-sm" />
                  <Input value={form.job_training_position} onChange={e => setForm(p => ({ ...p, job_training_position: e.target.value }))} placeholder="Position title" className="rounded-xl text-sm" />
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-muted-foreground">Start Date</label>
                      <Input type="date" value={form.job_training_start_date} onChange={e => setForm(p => ({ ...p, job_training_start_date: e.target.value }))} className="rounded-xl text-sm" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-muted-foreground">Expected Completion</label>
                      <Input type="date" value={form.job_training_expected_completion_date} onChange={e => setForm(p => ({ ...p, job_training_expected_completion_date: e.target.value }))} className="rounded-xl text-sm" />
                    </div>
                  </div>

                  {/* Completed Job Training History */}
                  <div className="pt-2 border-t border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed Training</label>
                      <button onClick={() => setJobTrainingEntries([...jobTrainingEntries, { training_name: "", company: "", position_title: "", completion_date: "" }])} className="text-xs text-primary hover:text-primary/80">+ Add</button>
                    </div>
                    {jobTrainingEntries.map((entry, idx) => (
                      <div key={idx} className="space-y-2 p-3 rounded-lg bg-secondary/30 border border-border">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 space-y-2">
                            <Input value={entry.training_name || ""} onChange={e => { const newEntries = [...jobTrainingEntries]; newEntries[idx].training_name = e.target.value; setJobTrainingEntries(newEntries); }} placeholder="Training name" className="rounded-xl text-sm" />
                            <Input value={entry.company || ""} onChange={e => { const newEntries = [...jobTrainingEntries]; newEntries[idx].company = e.target.value; setJobTrainingEntries(newEntries); }} placeholder="Company" className="rounded-xl text-sm" />
                            <Input value={entry.position_title || ""} onChange={e => { const newEntries = [...jobTrainingEntries]; newEntries[idx].position_title = e.target.value; setJobTrainingEntries(newEntries); }} placeholder="Position title" className="rounded-xl text-sm" />
                            <Input type="date" value={entry.completion_date || ""} onChange={e => { const newEntries = [...jobTrainingEntries]; newEntries[idx].completion_date = e.target.value; setJobTrainingEntries(newEntries); }} className="rounded-xl text-sm" />
                          </div>
                          <button onClick={() => setJobTrainingEntries(jobTrainingEntries.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive ml-2"><X className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                  character={selectedChar}
                />
              </div>
            )}

            {/* RELATIONSHIPS TAB */}
            {activeTab === "Relationships" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Define how {selectedChar.name} relates to other characters. Both characters will be updated.</p>
                {/* Linked characters */}
                {filteredCharRelationships.map(rel => {
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
                          <div className="space-y-3">
                            {Object.entries(RELATIONSHIP_CATEGORIES).filter(([_, def]) => def).map(([category, categoryDef]) => {
                              const typesInCat = Object.entries(RELATIONSHIP_TYPES).filter(([_, def]) => def.category === category);
                              return (
                                <div key={category} className="space-y-1.5">
                                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{categoryDef.label}</p>
                                  <div className="flex flex-wrap gap-2">
                                    {typesInCat.map(([key, type]) => (
                                      <button key={key} onClick={() => updateCharRel(rel.related_character_id, "relationship_type", key)}
                                        className={`px-3 py-1 rounded-full text-xs border transition-colors ${rel.relationship_type === key ? `bg-primary text-primary-foreground border-primary` : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
                                        title={type.description}>
                                        {type.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
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