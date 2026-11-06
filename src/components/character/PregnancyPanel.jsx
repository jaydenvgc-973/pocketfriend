import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assignNewbornToBirthParentHousehold } from "@/lib/newbornResidency";
import {
  pregnancyProfile,
  buildPregnancyLifeEvent,
  buildPostBirthLifeEvent,
  easternDateString,
  addDaysToDateString,
} from "@/lib/pregnancyState";

const AUTO_NAMES = ["Ava", "Noah", "Mia", "Eli", "Nora", "Jonah", "Zoe", "Miles", "Iris", "Theo"];

function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.length > 1 ? parts[parts.length - 1] : "" };
}

function autoChildName(motherName, gender) {
  const seed = (motherName || "").length + new Date().getDate();
  const first = AUTO_NAMES[seed % AUTO_NAMES.length];
  const { last } = splitName(motherName);
  return last ? `${first} ${last}` : first;
}

/**
 * PregnancyPanel
 *
 * Persistent pregnancy + birth continuity for one character.
 * The state is stored on the character's existing current_life_event slot, so every
 * image generated from then on renders the current stage without the user repeating it.
 * Birth creates the baby as a real family character and links it to both parents.
 */
export default function PregnancyPanel({ character, onUpdated }) {
  const [beganDate, setBeganDate] = useState(easternDateString());
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [childName, setChildName] = useState("");
  const [childGender, setChildGender] = useState("female");
  const [otherParentId, setOtherParentId] = useState("");
  const [partners, setPartners] = useState([]);
  const [error, setError] = useState("");

  // Other parent is picked from the user's own characters — never another account's.
  useEffect(() => {
    let cancelled = false;
    base44.entities.Character.list(null, 300)
      .then(list => {
        if (cancelled) return;
        setPartners((list || []).filter(c => c.id !== character?.id && c.status !== 'deleted' && c.status !== 'soft_deleted'));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [character?.id]);

  if (!character) return null;
  const profile = pregnancyProfile(character);

  const recordPregnancy = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await base44.entities.Character.update(character.id, {
        current_life_event: buildPregnancyLifeEvent(beganDate, dueDate || addDaysToDateString(beganDate, 280)),
      });
      onUpdated?.();
    } catch (e) {
      setError(e?.message || "Could not save the pregnancy state.");
    }
    setSaving(false);
  };

  const recordBirth = async (dismissed = false) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const me = await base44.auth.me();
      const today = easternDateString();
      const name = (!dismissed && childName.trim()) || autoChildName(character.name, childGender);
      const { first, last } = splitName(character.name);
      const relationshipType = childGender === "male" ? "son" : "daughter";

      // The baby exists as a real family character so every existing pipeline
      // (roster, image generation, milestone prompts) handles them normally.
      const baby = await base44.entities.Character.create({
        name,
        character_type: "npc_family_member",
        status: "active",
        owner_user_id: me.id,
        owner_email: me.email,
        created_by_role: me.role || "user",
        data_scope: "private_user",
        visibility_scope: "account_private",
        created_by_user: true,
        is_active_character: false,
        birthday: today,
        age: 0,
        gender: childGender,
        current_home_location_id: character.current_home_location_id || character.resolved_current_location_id || undefined,
        resolved_current_location_id: character.resolved_current_location_id || character.current_home_location_id || undefined,
        resolved_current_location_name: character.resolved_current_location_name || undefined,
        current_life_event: `Born ${today}`,
        family_history: `Child of ${character.name}.`,
      });

      // Mother's family list + relationship entry
      const motherFamily = character.family_members || [];
      const motherRels = character.fictional_relationships || [];
      const familyEntry = {
        _member_id: `birth_${baby.id}`,
        name,
        relationship_type: relationshipType,
        photo_url: null,
        age_at_creation: 0,
        age_set_date: today,
      };
      const relEntry = {
        person_name: name,
        relationship_type: relationshipType,
        description: `${character.name}'s ${relationshipType}, born ${today}.`,
        current_status: "newborn",
        friendship_level: 100,
        chosen_family_level: 100,
        source_character_id: baby.id,
        relationship_context: "birth",
      };

      await base44.entities.Character.update(character.id, {
        current_life_event: buildPostBirthLifeEvent(name, today),
        family_members: [...motherFamily.filter(m => m.name !== name), familyEntry],
        fictional_relationships: [...motherRels.filter(r => r.person_name !== name), relEntry],
      });

      // Every known parent is carried onto the child here and written ONCE, so a
      // later parent can never overwrite the birth parent out of the child's record.
      const childFamily = [
        { _member_id: `birth_mother_${character.id}`, name: character.name, relationship_type: "mother", photo_url: character.avatar_url || null, age_at_creation: character.age ?? null, age_set_date: today },
      ];
      const childRels = [
        { person_name: character.name, relationship_type: "mother", description: `${name}'s mother.`, source_character_id: character.id, relationship_context: "birth" },
      ];

      // Both parents list the child.
      if (otherParentId) {
        const others = await base44.entities.Character.filter({ id: otherParentId });
        const other = others?.[0];
        if (other) {
          const otherGender = other.gender || null;
          const otherRelType = otherGender === "male" ? "father" : otherGender === "female" ? "mother" : "parent";
          await base44.entities.Character.update(other.id, {
            family_members: [...(other.family_members || []).filter(m => m.name !== name), { ...familyEntry, _member_id: `birth_${baby.id}_${other.id}` }],
            fictional_relationships: [...(other.fictional_relationships || []).filter(r => r.person_name !== name), {
              ...relEntry,
              description: `${other.name}'s ${relationshipType}, born ${today}.`,
            }],
          });
          childFamily.push({ _member_id: `birth_${otherRelType}_${other.id}`, name: other.name, relationship_type: otherRelType, photo_url: other.avatar_url || null, age_at_creation: other.age ?? null, age_set_date: today });
          childRels.push({ person_name: other.name, relationship_type: otherRelType, description: `${name}'s ${otherRelType}.`, source_character_id: other.id, relationship_context: "birth" });
        }
      }

      // The child's own family record — birth parent first, every established parent kept.
      await base44.entities.Character.update(baby.id, {
        family_members: childFamily,
        fictional_relationships: childRels,
      });

      // The newborn lives in the birth parent's existing household and dwelling unit.
      await assignNewbornToBirthParentHousehold(character, baby);

      setNaming(false);
      setChildName("");
      onUpdated?.();
    } catch (e) {
      setError(e?.message || "Could not record the birth.");
    }
    setSaving(false);
  };

  if (!profile) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Not pregnant. Recording a pregnancy makes every generated image show the current stage
          until the birth is recorded.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Began</label>
            <Input type="date" value={beganDate} onChange={e => setBeganDate(e.target.value)} className="h-9 rounded-lg text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Due (optional)</label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9 rounded-lg text-xs" />
          </div>
        </div>
        <Button size="sm" className="w-full h-9 rounded-lg" disabled={saving || !beganDate} onClick={recordPregnancy}>
          {saving ? "Saving…" : "Record pregnancy"}
        </Button>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    );
  }

  const { first, last } = splitName(character.name);
  const suggested = `${first} ${last}`.trim();

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-pink-400/20 bg-pink-400/10 p-3">
        <p className="text-sm font-medium text-pink-300">{character.name} is pregnant</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {profile.weeks != null ? `Week ${profile.weeks} · ${profile.months} month${profile.months === 1 ? "" : "s"}` : "Stage not recorded"}
          {profile.dueDate ? ` · due ${profile.dueDate}` : ""}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
          Every generated image shows this stage automatically. It advances as time passes and
          stops on the recorded birth date.
        </p>
      </div>

      {!naming ? (
        <Button size="sm" variant="outline" className="w-full h-9 rounded-lg" onClick={() => setNaming(true)}>
          Record birth
        </Button>
      ) : (
        <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
          <p className="text-xs text-foreground">Name the baby</p>
          <Input
            value={childName}
            onChange={e => setChildName(e.target.value)}
            placeholder={`Leave blank for ${autoChildName(character.name, childGender)}`}
            className="h-9 rounded-lg text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={childGender}
              onChange={e => setChildGender(e.target.value)}
              className="h-9 rounded-lg bg-background border border-border text-xs px-2 text-foreground"
            >
              <option value="female">Girl</option>
              <option value="male">Boy</option>
            </select>
            <select
              value={otherParentId}
              onChange={e => setOtherParentId(e.target.value)}
              className="h-9 rounded-lg bg-background border border-border text-xs px-2 text-foreground"
            >
              <option value="">Other parent (optional)</option>
              {partners.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-muted-foreground">
            The baby is added as a family character with today's birthday, so they appear as an
            infant and grow normally afterwards.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 h-9 rounded-lg" disabled={saving} onClick={() => recordBirth(true)}>
              Skip naming
            </Button>
            <Button size="sm" className="flex-1 h-9 rounded-lg" disabled={saving} onClick={() => recordBirth(false)}>
              {saving ? "Recording…" : "Confirm birth"}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}