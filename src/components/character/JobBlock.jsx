import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import OccupationLocationPicker from "@/components/character/OccupationLocationPicker";

const JOB_TYPES = [
  "Retail / Customer Service", "Food Service / Restaurant", "Healthcare / Medical",
  "Corporate / Office", "Education / Teaching", "Creative / Arts", "Tech / Software",
  "Trades / Construction", "Freelance / Self-employed", "Student", "Student & Internship",
  "Unemployed", "Crime / Illegal", "Between jobs"
];

const DAY_LABELS = [["Sun",0],["Mon",1],["Tue",2],["Wed",3],["Thu",4],["Fri",5],["Sat",6]];

/**
 * JobBlock — renders an identical UI block for Primary or Second job.
 * Props:
 *   label: "Primary Job" | "Second Job"
 *   characterId: string
 *   linkType: "occupation"
 *   jobType, onJobTypeChange
 *   jobTitle, onJobTitleChange
 *   workEnvironment, onWorkEnvironmentChange
 *   workDays, onWorkDaysChange
 *   workStartTime, onWorkStartTimeChange
 *   workEndTime, onWorkEndTimeChange
 *   locationLink: { locationId, locationName, title }
 *   onLocationLinkChange
 */
export default function JobBlock({
  label,
  characterId,
  jobType, onJobTypeChange,
  jobTitle, onJobTitleChange,
  workEnvironment, onWorkEnvironmentChange,
  workDays, onWorkDaysChange,
  workStartTime, onWorkStartTimeChange,
  workEndTime, onWorkEndTimeChange,
  locationLink,
  onLocationLinkChange,
}) {
  const toggleDay = (day) => {
    const current = workDays || [];
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
    onWorkDaysChange(next);
  };

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <p className="text-xs font-bold text-foreground uppercase tracking-wider">{label}</p>

      {/* Job Type */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Job Type</label>
        <Select value={jobType || ""} onValueChange={onJobTypeChange}>
          <SelectTrigger className="rounded-xl">
            <SelectValue placeholder="Select job type" />
          </SelectTrigger>
          <SelectContent>
            {JOB_TYPES.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Job Title */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Job Title</label>
        <Input
          value={jobTitle || ""}
          onChange={e => onJobTitleChange(e.target.value)}
          placeholder="e.g. Nurse, Barista, Software Engineer"
          className="rounded-xl text-sm"
        />
      </div>

      {/* Linked Workplace */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Linked Workplace</label>
        <OccupationLocationPicker
          characterId={characterId}
          linkType="occupation"
          currentLocationId={locationLink?.locationId}
          currentTitle={locationLink?.title}
          onLinkChange={onLocationLinkChange}
          placeholder="e.g. Hospital, Coffee Shop, Studio"
          hideTitle
        />
      </div>

      {/* Work Days */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Work Days</label>
        <div className="flex gap-1 flex-wrap">
          {DAY_LABELS.map(([dayLabel, day]) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                (workDays || []).includes(day)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {dayLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Start / End Time */}
      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Start Time</label>
          <Input
            type="time"
            value={workStartTime || ""}
            onChange={e => onWorkStartTimeChange(e.target.value)}
            className="rounded-xl text-sm"
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">End Time</label>
          <Input
            type="time"
            value={workEndTime || ""}
            onChange={e => onWorkEndTimeChange(e.target.value)}
            className="rounded-xl text-sm"
          />
        </div>
      </div>

      {/* Work Environment */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Work Environment Description</label>
        <Textarea
          value={workEnvironment || ""}
          onChange={e => onWorkEnvironmentChange(e.target.value)}
          placeholder="Describe the day-to-day work environment..."
          className="rounded-xl min-h-[80px] text-sm resize-none"
        />
      </div>
    </div>
  );
}