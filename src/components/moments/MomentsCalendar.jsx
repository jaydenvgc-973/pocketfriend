import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Cake, Calendar, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';

// US Holidays and public observances — year-keyed
const HOLIDAYS = {
  2025: [
    { date: '2025-01-01', name: "New Year's Day", color: 'bg-blue-500/20 text-blue-400', icon: '🎉' },
    { date: '2025-01-20', name: 'MLK Day', color: 'bg-indigo-500/20 text-indigo-400', icon: '✊' },
    { date: '2025-02-14', name: "Valentine's Day", color: 'bg-pink-500/20 text-pink-400', icon: '❤️' },
    { date: '2025-02-17', name: "Presidents' Day", color: 'bg-blue-500/20 text-blue-400', icon: '🇺🇸' },
    { date: '2025-03-17', name: "St. Patrick's Day", color: 'bg-green-500/20 text-green-400', icon: '🍀' },
    { date: '2025-04-01', name: "April Fools' Day", color: 'bg-yellow-500/20 text-yellow-400', icon: '😂' },
    { date: '2025-04-20', name: 'Easter', color: 'bg-purple-500/20 text-purple-400', icon: '🐣' },
    { date: '2025-05-05', name: 'Cinco de Mayo', color: 'bg-green-500/20 text-green-400', icon: '🎊' },
    { date: '2025-05-12', name: "Mother's Day", color: 'bg-rose-500/20 text-rose-400', icon: '💐' },
    { date: '2025-05-26', name: 'Memorial Day', color: 'bg-red-500/20 text-red-400', icon: '🇺🇸' },
    { date: '2025-06-01', name: 'Pride Month Begins', color: 'bg-fuchsia-500/20 text-fuchsia-400', icon: '🏳️‍🌈' },
    { date: '2025-06-15', name: "Father's Day", color: 'bg-sky-500/20 text-sky-400', icon: '👨‍👧' },
    { date: '2025-06-19', name: 'Juneteenth', color: 'bg-red-500/20 text-red-400', icon: '✊' },
    { date: '2025-06-27', name: 'National HIV Testing Day', color: 'bg-orange-500/20 text-orange-400', icon: '🎗️' },
    { date: '2025-07-04', name: 'Independence Day', color: 'bg-red-500/20 text-red-400', icon: '🎆' },
    { date: '2025-09-01', name: 'Labor Day', color: 'bg-amber-500/20 text-amber-400', icon: '⚒️' },
    { date: '2025-10-31', name: 'Halloween', color: 'bg-orange-500/20 text-orange-400', icon: '🎃' },
    { date: '2025-11-11', name: "Veterans Day", color: 'bg-red-500/20 text-red-400', icon: '🇺🇸' },
    { date: '2025-11-27', name: 'Thanksgiving', color: 'bg-amber-500/20 text-amber-400', icon: '🦃' },
    { date: '2025-12-24', name: 'Christmas Eve', color: 'bg-red-500/20 text-red-400', icon: '🎄' },
    { date: '2025-12-25', name: 'Christmas', color: 'bg-red-500/20 text-red-400', icon: '🎁' },
    { date: '2025-12-31', name: "New Year's Eve", color: 'bg-blue-500/20 text-blue-400', icon: '🥂' },
  ],
  2026: [
    { date: '2026-01-01', name: "New Year's Day", color: 'bg-blue-500/20 text-blue-400', icon: '🎉' },
    { date: '2026-01-19', name: 'MLK Day', color: 'bg-indigo-500/20 text-indigo-400', icon: '✊' },
    { date: '2026-02-14', name: "Valentine's Day", color: 'bg-pink-500/20 text-pink-400', icon: '❤️' },
    { date: '2026-02-16', name: "Presidents' Day", color: 'bg-blue-500/20 text-blue-400', icon: '🇺🇸' },
    { date: '2026-03-17', name: "St. Patrick's Day", color: 'bg-green-500/20 text-green-400', icon: '🍀' },
    { date: '2026-04-05', name: 'Easter', color: 'bg-purple-500/20 text-purple-400', icon: '🐣' },
    { date: '2026-05-10', name: "Mother's Day", color: 'bg-rose-500/20 text-rose-400', icon: '💐' },
    { date: '2026-05-25', name: 'Memorial Day', color: 'bg-red-500/20 text-red-400', icon: '🇺🇸' },
    { date: '2026-06-01', name: 'Pride Month Begins', color: 'bg-fuchsia-500/20 text-fuchsia-400', icon: '🏳️‍🌈' },
    { date: '2026-06-19', name: 'Juneteenth', color: 'bg-red-500/20 text-red-400', icon: '✊' },
    { date: '2026-06-21', name: "Father's Day", color: 'bg-sky-500/20 text-sky-400', icon: '👨‍👧' },
    { date: '2026-06-27', name: 'National HIV Testing Day', color: 'bg-orange-500/20 text-orange-400', icon: '🎗️' },
    { date: '2026-07-04', name: 'Independence Day', color: 'bg-red-500/20 text-red-400', icon: '🎆' },
    { date: '2026-09-07', name: 'Labor Day', color: 'bg-amber-500/20 text-amber-400', icon: '⚒️' },
    { date: '2026-10-31', name: 'Halloween', color: 'bg-orange-500/20 text-orange-400', icon: '🎃' },
    { date: '2026-11-11', name: "Veterans Day", color: 'bg-red-500/20 text-red-400', icon: '🇺🇸' },
    { date: '2026-11-26', name: 'Thanksgiving', color: 'bg-amber-500/20 text-amber-400', icon: '🦃' },
    { date: '2026-12-24', name: 'Christmas Eve', color: 'bg-red-500/20 text-red-400', icon: '🎄' },
    { date: '2026-12-25', name: 'Christmas', color: 'bg-red-500/20 text-red-400', icon: '🎁' },
    { date: '2026-12-31', name: "New Year's Eve", color: 'bg-blue-500/20 text-blue-400', icon: '🥂' },
  ],
};

// Parse a birthday string (YYYY-MM-DD or MM-DD) into month (1-based) and day
function parseBirthday(bdStr) {
  if (!bdStr) return null;
  const parts = bdStr.split('-');
  if (parts.length === 3) {
    // YYYY-MM-DD
    return { month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
  }
  if (parts.length === 2) {
    // MM-DD
    return { month: parseInt(parts[0], 10), day: parseInt(parts[1], 10) };
  }
  return null;
}

export default function MomentsCalendar({ characters = [], userBirthday = null }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [userEvents, setUserEvents] = useState([]);
  // selectedDay: open the day panel; mode: 'view' | 'add'
  const [selectedDay, setSelectedDay] = useState(null);
  const [panelMode, setPanelMode] = useState('view'); // 'view' or 'add'
  const [eventName, setEventName] = useState('');
  const [addToCommunity, setAddToCommunity] = useState(null); // null | true | false

  const year = currentMonth.getFullYear();

  // Collect all birthdays for the current year (recurring annual)
  const getBirthdays = () => {
    const result = [];
    characters.forEach(char => {
      if (!char.birthday) return;
      const parsed = parseBirthday(char.birthday);
      if (!parsed) return;
      const dateStr = `${year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
      result.push({
        date: dateStr,
        name: `${char.name}'s Birthday 🎂`,
        color: 'bg-rose-500/20 text-rose-300',
        icon: '🎂',
        type: 'birthday',
      });
    });

    if (userBirthday) {
      const parsed = parseBirthday(userBirthday);
      if (parsed) {
        const dateStr = `${year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
        result.push({
          date: dateStr,
          name: 'Your Birthday 🎂',
          color: 'bg-amber-500/20 text-amber-300',
          icon: '🎂',
          type: 'birthday',
        });
      }
    }
    return result;
  };

  const getEventsForDate = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const holidays = (HOLIDAYS[year] || []).filter(h => h.date === dateStr);
    const birthdays = getBirthdays().filter(b => b.date === dateStr);
    const custom = userEvents.filter(e => e.date === dateStr);
    return [...holidays, ...birthdays, ...custom];
  };

  const handleDayClick = (date) => {
    setSelectedDay(date);
    setPanelMode('view');
    setEventName('');
    setAddToCommunity(null);
  };

  const handleAddEvent = () => {
    if (!selectedDay || !eventName.trim() || addToCommunity === null) return;
    const dateStr = format(selectedDay, 'yyyy-MM-dd');
    setUserEvents(prev => [...prev, {
      date: dateStr,
      name: eventName.trim(),
      color: 'bg-indigo-500/20 text-indigo-400',
      icon: '📅',
      type: 'user',
      addedToCommunity: addToCommunity,
    }]);
    setEventName('');
    setAddToCommunity(null);
    setPanelMode('view');
  };

  const closePanel = () => {
    setSelectedDay(null);
    setPanelMode('view');
    setEventName('');
    setAddToCommunity(null);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfWeek = monthStart.getDay();
  const emptyDays = Array(firstDayOfWeek).fill(null);

  const selectedEvents = selectedDay ? getEventsForDate(selectedDay) : [];

  return (
    <div className="bg-card/50 border border-border rounded-xl overflow-hidden mb-2">
      {/* Calendar header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">{format(currentMonth, 'MMMM yyyy')}</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="h-7 w-7 p-0">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="h-7 w-7 p-0">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedDay(new Date());
              setPanelMode('add');
            }}
            className="ml-1 h-7 px-2 gap-1 text-xs"
          >
            <Plus className="w-3 h-3" /> Add
          </Button>
        </div>
      </div>

      <div className="p-3">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-[10px] font-semibold text-muted-foreground text-center py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {emptyDays.map((_, i) => <div key={`e-${i}`} />)}
          {daysInMonth.map(date => {
            const events = getEventsForDate(date);
            const isToday = isSameDay(date, new Date());
            const isSelected = selectedDay && isSameDay(date, selectedDay);
            const hasBirthday = events.some(e => e.type === 'birthday');
            const hasHoliday = events.some(e => !e.type || e.type === 'holiday');
            const hasCustom = events.some(e => e.type === 'user');

            return (
              <div
                key={date.toISOString()}
                onClick={() => handleDayClick(date)}
                className={`relative flex flex-col items-center justify-start rounded-md p-1 cursor-pointer transition-colors min-h-[36px]
                  ${isSelected ? 'bg-primary/30 border border-primary/60' : isToday ? 'bg-primary/15 border border-primary/30' : 'hover:bg-secondary/50 border border-transparent'}
                `}
              >
                <span className={`text-[11px] font-medium leading-none mb-0.5 ${isToday ? 'text-primary font-bold' : 'text-foreground'}`}>
                  {date.getDate()}
                </span>
                {/* Event dots */}
                {events.length > 0 && (
                  <div className="flex gap-0.5 flex-wrap justify-center">
                    {hasBirthday && <span className="w-1 h-1 rounded-full bg-rose-400" />}
                    {hasHoliday && <span className="w-1 h-1 rounded-full bg-primary/70" />}
                    {hasCustom && <span className="w-1 h-1 rounded-full bg-indigo-400" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day panel — shows when a day is selected */}
      {selectedDay && (
        <div className="border-t border-border bg-secondary/20 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{format(selectedDay, 'EEEE, MMMM d')}</h3>
            <button onClick={closePanel} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* View mode — show events on this day */}
          {panelMode === 'view' && (
            <div>
              {selectedEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground mb-3">Nothing on this day.</p>
              ) : (
                <ul className="space-y-1.5 mb-3">
                  {selectedEvents.map((ev, i) => (
                    <li key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${ev.color}`}>
                      <span className="text-base leading-none">{ev.icon}</span>
                      <span className="font-medium">{ev.name}</span>
                      {ev.type === 'user' && ev.addedToCommunity && (
                        <span className="ml-auto text-[10px] text-muted-foreground">Community</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPanelMode('add')}
                className="h-7 px-3 text-xs gap-1"
              >
                <Plus className="w-3 h-3" /> Add event on this day
              </Button>
            </div>
          )}

          {/* Add mode — create a new event */}
          {panelMode === 'add' && (
            <div>
              <input
                type="text"
                placeholder="Event name..."
                value={eventName}
                onChange={e => setEventName(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-primary/50"
                autoFocus
              />

              {/* Community strip prompt */}
              <p className="text-xs text-muted-foreground mb-2">Add to Homepage Community Event strip?</p>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setAddToCommunity(true)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    addToCommunity === true
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary/40 text-muted-foreground border-border hover:border-primary/40'
                  }`}
                >
                  Yes
                </button>
                <button
                  onClick={() => setAddToCommunity(false)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    addToCommunity === false
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary/40 text-muted-foreground border-border hover:border-primary/40'
                  }`}
                >
                  No
                </button>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddEvent}
                  disabled={!eventName.trim() || addToCommunity === null}
                  className="h-8 flex-1"
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectedEvents.length > 0 ? setPanelMode('view') : closePanel()}
                  className="h-8"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}