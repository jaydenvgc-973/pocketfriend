import { Home, Briefcase, GraduationCap, Dumbbell, ShoppingCart, Heart, User, Users, DollarSign, Clock, ArrowRight } from "lucide-react";
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import ConfirmCharacterMoveModal from "./ConfirmCharacterMoveModal";
const Church = Heart;

function DetailRow({ label, value, highlight }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
      <span className={`text-xs font-medium text-right ${highlight ? 'text-green-400' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 mt-3 first:mt-0">
      <Icon className="w-3.5 h-3.5 text-primary" />
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

export default function LocationDetailPanel({ location, characters = [], allLocations = [], onResidentsChanged = null }) {
  const [confirmMove, setConfirmMove] = useState(null);
  const [isMoving, setIsMoving] = useState(false);

  if (!location) return null;

  const cat = location.category || 'generic';
  const totalUtilities = location.utility_costs
    ? Object.values(location.utility_costs).reduce((s, v) => s + (v || 0), 0)
    : 0;

  const activeResidents = (location.resident_character_ids || []).map(id => {
    const c = characters.find(ch => ch.id === id);
    return c ? c.name : null;
  }).filter(Boolean);
  const npcResidents = (location.resident_family_members || []).map(r => r.name).filter(Boolean);

  const allResidentCount = activeResidents.length + npcResidents.length;
  const householdSize = location.grocery_household_size || allResidentCount || 1;
  const grocerySpend = location.grocery_average_spend || Math.round(householdSize * 150);

  const rentSplit = allResidentCount > 1
    ? ((location.rent_or_housing_cost || 0) / allResidentCount).toFixed(0)
    : null;

  const totalHousingCost = (location.rent_or_housing_cost || 0) + totalUtilities;

  const workerIds = location.worker_character_ids || [];

  const hoursText = (location.operating_hours || []).map(h => {
    const day = h.day_of_week != null ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][h.day_of_week] : 'Daily';
    return `${day}: ${h.open_time}–${h.close_time}${h.note ? ` (${h.note})` : ''}`;
  }).join(' · ');

  // Get other home locations for moving residents
  const otherHomes = (allLocations || []).filter(l => (l.category === 'home' || l.category === 'generic') && l.id !== location.id);

  const handleMoveConfirm = async (toLocation) => {
    setIsMoving(true);
    try {
      await base44.functions.invoke('moveCharacterToNewHome', {
        characterId: confirmMove.character.id,
        fromLocationId: confirmMove.fromLocation.id,
        toLocationId: toLocation.id,
      });
      setConfirmMove(null);
      onResidentsChanged?.();
    } catch (err) {
      console.error('Move failed:', err);
      alert('Failed to move character. Please try again.');
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="px-4 pt-1 pb-4 space-y-1 text-xs">

      {(cat === 'home' || cat === 'generic') && (
        <>
          <SectionHeader icon={Home} label="Housing" />
          <DetailRow label="Rent" value={location.rent_or_housing_cost ? `$${location.rent_or_housing_cost}/mo` : null} highlight />
          <DetailRow label="Bedrooms" value={location.bedroom_count} />
          <DetailRow label="Utilities" value={totalUtilities > 0 ? `$${totalUtilities}/mo` : null} />
          <DetailRow label="Total Housing Cost" value={totalHousingCost > 0 ? `$${totalHousingCost}/mo` : null} highlight />
          {rentSplit && <DetailRow label="Per-Resident Rent" value={`$${rentSplit}/mo`} />}

          {(location.owner_character_name || location.owner_npc_name) && (
            <>
              <SectionHeader icon={User} label="Owner / Landlord" />
              <DetailRow
                label={location.owner_role || 'owner'}
                value={location.owner_is_npc ? location.owner_npc_name : location.owner_character_name}
              />
            </>
          )}

          {(activeResidents.length > 0 || npcResidents.length > 0) && (
            <>
              <SectionHeader icon={Users} label="Residents" />
              {activeResidents.map(name => {
                const char = characters.find(c => c.name === name);
                const isResident = char?.current_home_location_id === location.id;
                return (
                  <div key={name} className="flex items-center gap-2 py-0.5 group">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    <span className="text-xs text-foreground">{name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">active character</span>
                    {isResident && char && otherHomes.length > 0 && (
                      <button
                        onClick={() => setConfirmMove({ character: char, fromLocation: location, toLocation: otherHomes[0] })}
                        title="Move to different home"
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-primary/20 rounded transition-all"
                      >
                        <ArrowRight className="w-3 h-3 text-primary" />
                      </button>
                    )}
                  </div>
                );
              })}
              {npcResidents.map(name => (
                <div key={name} className="flex items-center gap-2 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">{name}</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">NPC</span>
                </div>
              ))}
              <DetailRow label="Household Size" value={householdSize} />
              <DetailRow label="Est. Grocery Need" value={`$${grocerySpend}/mo`} />
            </>
          )}
        </>
      )}

      {(cat === 'workplace' || cat === 'business' || cat === 'food_drink' || cat === 'social' || cat === 'medical' || cat === 'government') && (
        <>
          {(location.owner_character_name || location.owner_npc_name) && (
            <>
              <SectionHeader icon={User} label="Owner / Manager" />
              <DetailRow
                label={location.owner_role || 'owner'}
                value={location.owner_is_npc ? location.owner_npc_name : location.owner_character_name}
              />
            </>
          )}

          {workerIds.length > 0 && (
            <>
              <SectionHeader icon={Briefcase} label="Workers" />
              <div className="space-y-1.5">
                {workerIds.map(id => {
                  const char = characters.find(c => c.id === id);
                  const displayName = char?.name || id;
                  const jobTitle = location.worker_job_titles?.[id];
                  const payRate = location.worker_pay_rates?.[id];
                  const payType = location.worker_pay_type?.[id] || 'hourly';
                  const shift = location.worker_shifts?.[id];
                  return (
                    <div key={id} className="bg-secondary/40 rounded-lg p-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground font-medium">{jobTitle ? `${displayName} — ${jobTitle}` : displayName}</span>
                        {payRate > 0 && (
                          <span className="text-xs text-green-400 font-semibold">
                            ${payRate}{payType === 'hourly' ? '/hr' : '/yr'}
                          </span>
                        )}
                      </div>
                      {shift && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="w-2.5 h-2.5" />
                          {shift.start} – {shift.end}
                          {shift.days && ` · ${shift.days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {totalUtilities > 0 && (
            <>
              <SectionHeader icon={DollarSign} label="Operating Costs" />
              <DetailRow label="Utilities / Month" value={`$${totalUtilities}/mo`} />
              {location.operating_cost > 0 && <DetailRow label="Operating Cost" value={`$${location.operating_cost}/mo`} />}
            </>
          )}
        </>
      )}

      {(cat === 'school' || cat === 'education') && (
        <>
          <SectionHeader icon={GraduationCap} label="School / Education" />

          {(() => {
            const students = characters.filter(c =>
              c.education_location_id === location.id ||
              c.additional_education_locations?.some(e => e.location_id === location.id)
            );
            return students.length > 0 ? (
              <>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Students</div>
                {students.map(s => {
                  const prog = s.education_location_id === location.id
                    ? s.education_details?.course_name || s.current_education_activity
                    : s.additional_education_locations?.find(e => e.location_id === location.id)?.program_name;
                  return (
                    <div key={s.id} className="flex items-center gap-2 py-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      <span className="text-xs text-foreground">{s.name}</span>
                      {prog && <span className="text-[10px] text-muted-foreground ml-auto">{prog}</span>}
                    </div>
                  );
                })}
              </>
            ) : null;
          })()}

          {workerIds.length > 0 && (
            <>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-2 mb-1">Staff / Faculty</div>
              {workerIds.map(id => {
                const char = characters.find(c => c.id === id);
                return (
                  <div key={id} className="flex items-center gap-2 py-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">{char?.name || id}</span>
                    {location.worker_job_titles?.[id] && (
                      <span className="text-[10px] text-muted-foreground ml-auto">{location.worker_job_titles[id]}</span>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {cat === 'gym' && (
        <>
          <SectionHeader icon={Dumbbell} label="Gym" />
          <DetailRow label="Monthly Fee" value={location.gym_membership_fee ? `$${location.gym_membership_fee}/mo` : null} highlight />

          {(location.owner_character_name || location.owner_npc_name) && (
            <DetailRow
              label={location.owner_role || 'owner'}
              value={location.owner_is_npc ? location.owner_npc_name : location.owner_character_name}
            />
          )}

          {(location.gym_members || []).length > 0 && (
            <>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-2 mb-1">Members</div>
              {(location.gym_members || []).map(id => {
                const char = characters.find(c => c.id === id);
                return char ? (
                  <div key={id} className="flex items-center gap-2 py-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">{char.name}</span>
                  </div>
                ) : null;
              })}
            </>
          )}
        </>
      )}

      {cat === 'grocery' && (
        <>
          <SectionHeader icon={ShoppingCart} label="Grocery" />
          <DetailRow label="Avg Monthly Spend" value={location.grocery_average_spend ? `$${location.grocery_average_spend}/mo` : '$150–$400/mo (household avg)'} />
          <DetailRow label="Household Size Served" value={location.grocery_household_size || 'auto-detect'} />
          <div className="mt-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[10px] text-muted-foreground">
              Grocery spending is calculated from household size using U.S. average baselines (~$150/person/mo).
              Resident characters at linked home locations drive this estimate.
            </p>
          </div>
        </>
      )}

      {cat === 'religion' && (
        <>
          <SectionHeader icon={Church} label="Place of Worship" />

          {(location.owner_character_name || location.owner_npc_name) && (
            <DetailRow
              label={location.owner_role || 'leader'}
              value={location.owner_is_npc ? location.owner_npc_name : location.owner_character_name}
            />
          )}

          {(() => {
            const attendees = characters.filter(c =>
              c.religion && c.religion !== 'None' && c.belief_level !== 'in_name_only'
            );
            return attendees.length > 0 ? (
              <>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-2 mb-1">Expected Attendees</div>
                {attendees.map(c => (
                  <div key={c.id} className="flex items-center gap-2 py-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto capitalize">{c.religion} · {c.belief_level?.replace('_', ' ')}</span>
                  </div>
                ))}
              </>
            ) : null;
          })()}

          {workerIds.length > 0 && (
            <>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-2 mb-1">Clergy / Staff / Volunteers</div>
              {workerIds.map(id => {
                const char = characters.find(c => c.id === id);
                return (
                  <div key={id} className="flex items-center gap-2 py-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                    <span className="text-xs text-foreground">{char?.name || id}</span>
                    {location.worker_job_titles?.[id] && (
                      <span className="text-[10px] text-muted-foreground ml-auto">{location.worker_job_titles[id]}</span>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {cat === 'community' && (
        <>
          <SectionHeader icon={Users} label="Community Location" />
          {location.community_type && <DetailRow label="Type" value={location.community_type.replace(/_/g, ' ')} />}
          {(location.owner_character_name || location.owner_npc_name) && (
            <DetailRow label={location.owner_role || 'operator'} value={location.owner_is_npc ? location.owner_npc_name : location.owner_character_name} />
          )}
        </>
      )}

      {hoursText && (
        <>
          <SectionHeader icon={Clock} label="Active Hours" />
          <p className="text-xs text-muted-foreground leading-relaxed">{hoursText}</p>
        </>
      )}

      {confirmMove && (
        <ConfirmCharacterMoveModal
          isOpen={!!confirmMove}
          onClose={() => setConfirmMove(null)}
          character={confirmMove.character}
          fromLocation={confirmMove.fromLocation}
          toLocation={confirmMove.toLocation}
          onConfirm={() => handleMoveConfirm(confirmMove.toLocation)}
          isLoading={isMoving}
        />
      )}

    </div>
  );
}