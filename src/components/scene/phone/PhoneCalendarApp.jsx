import React from "react";
import { ChevronLeft, CalendarDays } from "lucide-react";
import MomentsCalendar from "@/components/moments/MomentsCalendar";

/**
 * PhoneCalendarApp — the existing Moments calendar, shown inside the phone.
 *
 * The same component the Moments page renders, reading the same records: birthdays,
 * holidays, awareness and cultural dates, seasonal and fun days, community events, story
 * events and the user's own events. It is another place to view the calendar, never a
 * second set of events.
 */
export default function PhoneCalendarApp({ characters = [], currentUser, userSettings, onBack }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-2 text-white/90">
        <button onClick={onBack} className="p-1 rounded-full hover:bg-white/10"><ChevronLeft className="w-4 h-4" /></button>
        <CalendarDays className="w-3.5 h-3.5" />
        <span className="text-[11px] font-semibold">Calendar</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-background/95 rounded-t-xl">
        <MomentsCalendar
          characters={characters}
          currentUser={currentUser}
          userSettings={userSettings}
          userBirthday={userSettings?.user_birthday || null}
        />
      </div>
    </div>
  );
}