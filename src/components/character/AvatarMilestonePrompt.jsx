import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { pendingAvatarMilestone } from "@/lib/avatarMilestones";

/**
 * AvatarMilestonePrompt
 *
 * Offered app-wide when a character crosses a developmental milestone after they
 * already existed: the user decides whether to refresh the avatar in the existing
 * avatar editor. The avatar is NEVER changed automatically, and declining keeps the
 * current avatar authoritative. The decision is saved on the character so the same
 * milestone is offered only once.
 */
export default function AvatarMilestonePrompt() {
  const navigate = useNavigate();
  const [target, setTarget] = useState(null); // { character, milestone }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('avatar_milestone_checked')) return;
    sessionStorage.setItem('avatar_milestone_checked', '1');

    base44.auth.me()
      .then(async (me) => {
        if (!me?.email) return;
        const chars = await base44.entities.Character.filter({
          owner_email: me.email,
          status: 'active',
        });
        const found = (chars || [])
          .filter(c => !c.character_type || ['active_created_character', 'npc_family_member', 'npc_regular'].includes(c.character_type))
          .map(c => ({ character: c, milestone: pendingAvatarMilestone(c) }))
          .find(x => x.milestone);
        if (found) setTarget(found);
      })
      .catch(() => {});
  }, []);

  const decide = async (openEditor) => {
    if (!target || saving) return;
    setSaving(true);
    const { character, milestone } = target;
    const existing = Array.isArray(character.triggered_milestones) ? character.triggered_milestones : [];
    try {
      await base44.entities.Character.update(character.id, {
        triggered_milestones: [...new Set([...existing, milestone.key])],
      });
    } catch {
      // A failed save must not trap the user in the prompt; it will return next session.
    }
    setTarget(null);
    setSaving(false);
    if (openEditor) navigate('/edit-character-photos');
  };

  if (!target) return null;
  const { character, milestone } = target;
  const name = character.name || character.display_name || 'This character';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          {character.avatar_url ? (
            <img
              src={character.avatar_url}
              alt={name}
              className="w-14 h-14 rounded-full object-cover border border-border"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center text-lg font-semibold text-foreground">
              {name.charAt(0)}
            </div>
          )}
          <div>
            <p className="text-foreground font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">Turns {milestone.age}</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {name} has grown. Would you like to update their avatar so pictures match how
          they look now? Their current avatar stays in place unless you change it.
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => decide(false)}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Keep current avatar
          </button>
          <button
            onClick={() => decide(true)}
            disabled={saving}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Update avatar
          </button>
        </div>
      </div>
    </div>
  );
}