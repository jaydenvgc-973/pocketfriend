import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Plus, UserX, AlertTriangle, Calendar, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

const CONFINEMENT_STATUSES = [
  { value: 'pretrial', label: 'Pretrial / Awaiting Trial' },
  { value: 'sentenced', label: 'Sentenced / Serving' },
  { value: 'held', label: 'Administrative Hold' },
  { value: 'work_release', label: 'Work Release' },
  { value: 'solitary', label: 'Solitary Confinement' },
];

function InmateForm({ allCharacters, existingInmateIds, onAdd, onCancel }) {
  const [selectedCharId, setSelectedCharId] = useState('');
  const [charges, setCharges] = useState('');
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('pretrial');
  const [sentenceDays, setSentenceDays] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [charSearch, setCharSearch] = useState('');

  const available = allCharacters.filter(c =>
    !existingInmateIds.has(c.id) &&
    (!charSearch || (c.name || '').toLowerCase().includes(charSearch.toLowerCase()))
  );

  const canAdd = selectedCharId && charges.trim() && bookingDate;

  const handleAdd = () => {
    if (!canAdd) return;
    const char = allCharacters.find(c => c.id === selectedCharId);
    onAdd({
      character_id: selectedCharId,
      character_name: char?.name || '',
      charges: charges.trim(),
      booking_date: bookingDate,
      confinement_status: status,
      sentence_days: sentenceDays ? parseInt(sentenceDays) : null,
      expected_release_date: releaseDate || null,
      notes: notes.trim() || null,
      confined_at: new Date().toISOString(),
    });
  };

  return (
    <div className="border border-border rounded-xl p-4 space-y-4 bg-secondary/20">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Book / Confine Character</p>

      {/* Character search */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Select Character</label>
        <Input
          value={charSearch}
          onChange={e => setCharSearch(e.target.value)}
          placeholder="Search characters..."
          className="h-8 text-xs rounded-lg mb-2"
        />
        <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-card">
          {available.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCharId(c.id)}
              className={`w-full flex items-center gap-2 p-2 text-left transition-colors hover:bg-secondary ${selectedCharId === c.id ? 'bg-primary/10 border-l-2 border-primary' : ''}`}
            >
              <CharacterAvatar character={c} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{c.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{c.character_type?.replace(/_/g, ' ') || 'character'}</p>
              </div>
              {selectedCharId === c.id && <span className="text-xs text-primary font-medium">✓</span>}
            </button>
          ))}
          {available.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">No characters available</p>
          )}
        </div>
      </div>

      {/* Charges */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Charge(s) <span className="text-destructive">*</span></label>
        <Input
          value={charges}
          onChange={e => setCharges(e.target.value)}
          placeholder="e.g. Armed robbery, assault, possession..."
          className="h-9 text-sm rounded-xl"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Booking date */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Booking Date <span className="text-destructive">*</span></label>
          <Input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="h-9 text-xs rounded-xl" />
        </div>
        {/* Sentence days */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Sentence (days)</label>
          <Input type="number" min="0" value={sentenceDays} onChange={e => setSentenceDays(e.target.value)} placeholder="e.g. 365" className="h-9 text-xs rounded-xl" />
        </div>
      </div>

      {/* Confinement status */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Confinement Status</label>
        <div className="grid grid-cols-2 gap-2">
          {CONFINEMENT_STATUSES.map(s => (
            <button key={s.value} onClick={() => setStatus(s.value)}
              className={`py-1.5 px-2 rounded-lg text-xs border transition-colors text-left ${status === s.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:border-primary/40'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Expected release date */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Expected Release Date (optional)</label>
        <Input type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} className="h-9 text-xs rounded-xl" />
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Notes / Source Event (optional)</label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Arrested after bank heist in Scene 14..." className="h-9 text-xs rounded-xl" />
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button size="sm" onClick={handleAdd} disabled={!canAdd} className="flex-1 rounded-xl">Confine Character</Button>
      </div>
    </div>
  );
}

export default function JailInmatePanel({ inmates = [], allCharacters = [], onChange }) {
  const [showForm, setShowForm] = useState(false);

  const existingInmateIds = new Set(inmates.map(i => i.character_id));

  const handleAdd = (inmateData) => {
    onChange([...inmates, inmateData]);
    setShowForm(false);
  };

  const handleRemove = (idx) => {
    onChange(inmates.filter((_, i) => i !== idx));
  };

  const handleRelease = (idx) => {
    const updated = inmates.map((inm, i) => i === idx
      ? { ...inm, confinement_status: 'released', actual_release_date: new Date().toISOString().slice(0, 10) }
      : inm
    );
    onChange(updated);
  };

  const active = inmates.filter(i => i.confinement_status !== 'released');
  const released = inmates.filter(i => i.confinement_status === 'released');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Confined Characters / Inmates</label>
          <p className="text-xs text-muted-foreground mt-0.5">Characters assigned here are locked to this facility. Movement is blocked until released.</p>
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="rounded-xl gap-1 shrink-0">
            <Plus className="w-3.5 h-3.5" /> Book
          </Button>
        )}
      </div>

      {showForm && (
        <InmateForm
          allCharacters={allCharacters}
          existingInmateIds={existingInmateIds}
          onAdd={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Active inmates */}
      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Currently Confined ({active.length})</p>
          {active.map((inmate, idx) => {
            const char = allCharacters.find(c => c.id === inmate.character_id);
            const realIdx = inmates.indexOf(inmate);
            const statusDef = CONFINEMENT_STATUSES.find(s => s.value === inmate.confinement_status);
            return (
              <div key={idx} className="bg-red-950/20 border border-red-500/20 rounded-xl p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">
                    {char ? <CharacterAvatar character={char} size="sm" /> : (
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                        {inmate.character_name?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{inmate.character_name}</p>
                    <p className="text-xs text-red-400 mt-0.5">{inmate.charges}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <span className="text-[10px] bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-medium">
                        🔒 {statusDef?.label || inmate.confinement_status}
                      </span>
                      {inmate.booking_date && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" /> Booked {inmate.booking_date}
                        </span>
                      )}
                      {inmate.expected_release_date && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" /> Release {inmate.expected_release_date}
                        </span>
                      )}
                      {inmate.sentence_days && (
                        <span className="text-[10px] text-muted-foreground">{inmate.sentence_days} day sentence</span>
                      )}
                    </div>
                    {inmate.notes && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1 italic">{inmate.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleRelease(realIdx)}
                      className="text-xs text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg px-2 py-1 transition-colors"
                    >
                      Release
                    </button>
                    <button onClick={() => handleRemove(realIdx)} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Released (collapsed) */}
      {released.length > 0 && (
        <details className="group">
          <summary className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold cursor-pointer select-none">
            Released / Discharged ({released.length})
          </summary>
          <div className="space-y-2 mt-2">
            {released.map((inmate, idx) => {
              const realIdx = inmates.indexOf(inmate);
              return (
                <div key={idx} className="bg-secondary/30 border border-border rounded-xl p-3 flex items-center justify-between gap-2 opacity-60">
                  <div>
                    <p className="text-xs font-medium text-foreground">{inmate.character_name}</p>
                    <p className="text-[10px] text-muted-foreground">{inmate.charges} · Released {inmate.actual_release_date || '—'}</p>
                  </div>
                  <button onClick={() => handleRemove(realIdx)} className="p-1 text-muted-foreground hover:text-destructive rounded-lg">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {active.length === 0 && !showForm && (
        <div className="py-4 rounded-xl border border-dashed border-border text-center">
          <UserX className="w-5 h-5 text-muted-foreground/40 mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No confined characters. Click "Book" to assign inmates.</p>
        </div>
      )}

      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <p className="text-xs text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Confined characters cannot autonomously travel until released. They will appear in Scene and Travel at this facility.
        </p>
      </div>
    </div>
  );
}