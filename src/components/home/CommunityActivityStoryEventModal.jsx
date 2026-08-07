import { useState } from 'react';
import { Button } from '@/components/ui/button';
import StoryEventCreator from '@/components/moments/StoryEventCreator';
import { X, BookOpen, Calendar, MapPin, Users } from 'lucide-react';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function formatTimeForInput(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export default function CommunityActivityStoryEventModal({
  activity,
  attendees = [],
  characters = [],
  currentUser = null,
  userSettings = null,
  appLocations = [],
  onClose,
  onCreated,
}) {
  const [confirmed, setConfirmed] = useState(false);

  if (!activity) return null;

  const startDate = new Date(activity.start_date);
  const endDate = new Date(startDate.getTime() + TWO_HOURS_MS);
  const startTimeStr = formatTimeForInput(startDate);
  const endTimeStr = formatTimeForInput(endDate);

  const initialPlot = activity.description
    ? `${activity.name}${activity.location_name ? ` at ${activity.location_name}` : ''}. ${activity.description}`
    : `${activity.name}${activity.location_name ? ` at ${activity.location_name}` : ''}.`;

  const participantIds = attendees.map(a => a.id);

  const handleCreated = (storyEventId, eventPreview) => {
    if (onCreated) onCreated(storyEventId, eventPreview);
    if (onClose) onClose();
  };

  if (!confirmed) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="bg-card border border-border rounded-xl p-5 max-w-sm w-full space-y-4"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Create Story Event?</h3>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Create a Story Event from{' '}
            <span className="text-foreground font-medium">"{activity.name}"</span>? This will
            prefill the Story Event with the activity's details, venue, and likely attendees.
          </p>

          <div className="space-y-1.5 text-xs text-muted-foreground bg-secondary/30 rounded-lg p-3">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3 flex-shrink-0" />
              <span>
                {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span>·</span>
              <span>
                {startTimeStr} – {endTimeStr}
              </span>
            </div>
            {activity.location_name && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{activity.location_name}</span>
              </div>
            )}
            {participantIds.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Users className="w-3 h-3 flex-shrink-0" />
                <span>
                  {participantIds.length} likely attendee{participantIds.length !== 1 ? 's' : ''} preselected
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose} className="flex-1 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={() => setConfirmed(true)} className="flex-1 text-xs">
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Create Story Event</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <StoryEventCreator
          date={startDate}
          characters={characters}
          currentUser={currentUser}
          userSettings={userSettings}
          appLocations={appLocations}
          onCreated={handleCreated}
          onCancel={onClose}
          initialTitle={activity.name}
          initialPlot={initialPlot}
          initialVenueId={activity.location_id || ''}
          initialParticipantIds={participantIds}
          initialStartTime={startTimeStr}
          initialEndTime={endTimeStr}
        />
      </div>
    </div>
  );
}