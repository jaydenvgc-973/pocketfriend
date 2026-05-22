/**
 * WorkerEmploymentControls
 *
 * Shows fire/quit/rehire buttons on a worker card in the Location detail panel.
 * Source of truth: location.worker_character_ids (roster) + character.employment_status
 */
import { useState } from "react";
import { UserX, UserCheck, LogOut, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function WorkerEmploymentControls({ characterId, characterName, locationId, locationName, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success'|'error', text: string }
  const [confirming, setConfirming] = useState(null); // 'fire'|'quit'|null

  const apply = async (action) => {
    setLoading(true);
    setResult(null);
    setConfirming(null);
    try {
      const res = await base44.functions.invoke('updateWorkerEmploymentStatus', {
        characterId,
        locationId,
        action,
      });
      const data = res?.data;
      if (data?.success) {
        setResult({ type: 'success', text: data.proof?.action_taken || `${action} applied.` });
        onUpdated?.();
      } else {
        setResult({ type: 'error', text: data?.error || 'Action failed.' });
      }
    } catch (err) {
      setResult({ type: 'error', text: err.message || 'Request failed.' });
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className={`mt-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium ${
        result.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'
      }`}>
        {result.text}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="mt-1.5 space-y-1.5">
        <p className="text-[10px] text-amber-400">
          {confirming === 'fire' ? `Confirm: fire ${characterName} from ${locationName}?` : `Confirm: ${characterName} quits ${locationName}?`}
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={() => apply(confirming)}
            disabled={loading}
            className="flex-1 px-2 py-1 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirming(null)}
            className="flex-1 px-2 py-1 rounded bg-secondary text-foreground text-[10px] hover:bg-secondary/80 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex gap-1.5 flex-wrap">
      <button
        onClick={() => setConfirming('fire')}
        title={`Fire ${characterName}`}
        className="flex items-center gap-1 px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-[10px] font-medium transition-colors"
      >
        <UserX className="w-3 h-3" /> Fire
      </button>
      <button
        onClick={() => setConfirming('quit')}
        title={`${characterName} quits`}
        className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-[10px] font-medium transition-colors"
      >
        <LogOut className="w-3 h-3" /> Quit
      </button>
    </div>
  );
}

export function RehireButton({ characterId, characterName, locationId, locationName, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const apply = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('updateWorkerEmploymentStatus', {
        characterId, locationId, action: 'rehire',
      });
      const data = res?.data;
      if (data?.success) {
        setResult({ type: 'success', text: `Rehired. Assign new schedule.` });
        onUpdated?.();
      } else {
        setResult({ type: 'error', text: data?.error || 'Rehire failed.' });
      }
    } catch (err) {
      setResult({ type: 'error', text: err.message || 'Request failed.' });
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className={`px-2 py-1 rounded text-[10px] ${result.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
        {result.text}
      </div>
    );
  }

  return (
    <button
      onClick={apply}
      disabled={loading}
      className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-medium transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
      Rehire
    </button>
  );
}