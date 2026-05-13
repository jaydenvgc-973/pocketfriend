import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';

// US Holidays and observances for 2025-2026
const HOLIDAYS = {
  2025: [
    { date: '2025-01-01', name: 'New Year\'s Day', color: 'bg-blue-500/20 text-blue-400' },
    { date: '2025-02-14', name: 'Valentine\'s Day', color: 'bg-pink-500/20 text-pink-400' },
    { date: '2025-03-17', name: 'St. Patrick\'s Day', color: 'bg-green-500/20 text-green-400' },
    { date: '2025-04-20', name: 'Easter', color: 'bg-purple-500/20 text-purple-400' },
    { date: '2025-05-12', name: 'Mother\'s Day', color: 'bg-red-500/20 text-red-400' },
    { date: '2025-06-01', name: 'Pride Month Begins', color: 'bg-rainbow-500/20 text-rainbow-400' },
    { date: '2025-06-19', name: 'Juneteenth', color: 'bg-red-500/20 text-red-400' },
    { date: '2025-06-15', name: 'Father\'s Day', color: 'bg-blue-500/20 text-blue-400' },
    { date: '2025-07-04', name: 'Independence Day', color: 'bg-red-500/20 text-red-400' },
    { date: '2025-09-01', name: 'Labor Day', color: 'bg-amber-500/20 text-amber-400' },
    { date: '2025-10-31', name: 'Halloween', color: 'bg-orange-500/20 text-orange-400' },
    { date: '2025-11-27', name: 'Thanksgiving', color: 'bg-amber-500/20 text-amber-400' },
    { date: '2025-12-25', name: 'Christmas', color: 'bg-red-500/20 text-red-400' },
  ],
  2026: [
    { date: '2026-01-01', name: 'New Year\'s Day', color: 'bg-blue-500/20 text-blue-400' },
    { date: '2026-02-14', name: 'Valentine\'s Day', color: 'bg-pink-500/20 text-pink-400' },
    { date: '2026-03-17', name: 'St. Patrick\'s Day', color: 'bg-green-500/20 text-green-400' },
    { date: '2026-04-05', name: 'Easter', color: 'bg-purple-500/20 text-purple-400' },
    { date: '2026-05-10', name: 'Mother\'s Day', color: 'bg-red-500/20 text-red-400' },
    { date: '2026-06-01', name: 'Pride Month Begins', color: 'bg-fuchsia-500/20 text-fuchsia-400' },
    { date: '2026-06-19', name: 'Juneteenth', color: 'bg-red-500/20 text-red-400' },
    { date: '2026-06-21', name: 'Father\'s Day', color: 'bg-blue-500/20 text-blue-400' },
    { date: '2026-07-04', name: 'Independence Day', color: 'bg-red-500/20 text-red-400' },
    { date: '2026-09-07', name: 'Labor Day', color: 'bg-amber-500/20 text-amber-400' },
    { date: '2026-10-31', name: 'Halloween', color: 'bg-orange-500/20 text-orange-400' },
    { date: '2026-11-26', name: 'Thanksgiving', color: 'bg-amber-500/20 text-amber-400' },
    { date: '2026-12-25', name: 'Christmas', color: 'bg-red-500/20 text-red-400' },
  ],
};

export default function MomentsCalendar({ characters = [], userBirthday = null }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [userEvents, setUserEvents] = useState([]);
  const [showEventForm, setShowEventForm] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [eventName, setEventName] = useState('');

  // Build birthday map from characters
  const getBirthdaysForMonth = () => {
    const birthdays = [];
    const year = currentMonth.getFullYear();

    characters.forEach(char => {
      if (char.birthday) {
        const [month, day] = char.birthday.split('-');
        birthdays.push({
          date: `${year}-${month}-${day}`,
          name: `${char.name}'s Birthday`,
          color: 'bg-rose-500/20 text-rose-300',
          type: 'birthday',
        });
      }
    });

    if (userBirthday) {
      const [month, day] = userBirthday.split('-');
      birthdays.push({
        date: `${year}-${month}-${day}`,
        name: 'Your Birthday',
        color: 'bg-amber-500/20 text-amber-300',
        type: 'birthday',
      });
    }

    return birthdays;
  };

  const getEventsForDate = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const year = date.getFullYear();

    // Get holidays
    const holidays = (HOLIDAYS[year] || []).filter(h => h.date === dateStr);

    // Get user events
    const events = userEvents.filter(e => e.date === dateStr);

    // Get birthdays
    const birthdays = getBirthdaysForMonth().filter(b => b.date === dateStr);

    return [...holidays, ...events, ...birthdays];
  };

  const handleAddEvent = () => {
    if (!selectedDate || !eventName.trim()) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    setUserEvents([...userEvents, { date: dateStr, name: eventName, color: 'bg-indigo-500/20 text-indigo-400', type: 'user' }]);
    setEventName('');
    setShowEventForm(false);
    setSelectedDate(null);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const firstDayOfWeek = monthStart.getDay();
  const emptyDays = Array(firstDayOfWeek).fill(null);

  return (
    <div className="bg-card/50 border border-border rounded-xl p-6 mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">{format(currentMonth, 'MMMM yyyy')}</h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedDate(new Date());
              setShowEventForm(true);
            }}
            className="ml-2 h-8 gap-1"
          >
            <Plus className="w-3 h-3" /> Add Event
          </Button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="text-xs font-semibold text-muted-foreground text-center py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {emptyDays.map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}

        {daysInMonth.map(date => {
          const events = getEventsForDate(date);
          const isToday = isSameDay(date, new Date());

          return (
            <div
              key={date.toISOString()}
              onClick={() => {
                setSelectedDate(date);
                setShowEventForm(true);
              }}
              className={`aspect-square border border-border rounded-lg p-1 cursor-pointer transition-colors ${
                isToday ? 'bg-primary/20 border-primary/40' : 'bg-secondary/20 hover:bg-secondary/40'
              }`}
            >
              <div className="text-xs font-semibold text-foreground mb-1">{date.getDate()}</div>
              <div className="space-y-0.5 overflow-hidden">
                {events.slice(0, 2).map((event, i) => (
                  <div
                    key={i}
                    className={`text-[10px] px-1 py-0.5 rounded truncate ${event.color}`}
                    title={event.name}
                  >
                    {event.name}
                  </div>
                ))}
                {events.length > 2 && (
                  <div className="text-[9px] text-muted-foreground px-1">
                    +{events.length - 2} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Event form */}
      {showEventForm && selectedDate && (
        <div className="mt-6 p-4 bg-secondary/40 rounded-lg border border-border">
          <p className="text-sm text-foreground mb-3">{format(selectedDate, 'MMMM d, yyyy')}</p>
          <input
            type="text"
            placeholder="Event name..."
            value={eventName}
            onChange={e => setEventName(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleAddEvent()}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-primary/50"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddEvent} className="h-8">
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowEventForm(false);
                setEventName('');
                setSelectedDate(null);
              }}
              className="h-8"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}