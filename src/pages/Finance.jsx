import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Zap, DollarSign, User, PlusCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BottomNav from '@/components/BottomNav';
import CharacterAvatar from '@/components/chat/CharacterAvatar';
import FinancialDashboard from '@/components/finance/FinancialDashboard';
import ManualTransactionModal from '@/components/finance/ManualTransactionModal';

// ── Character type display config ─────────────────────────────────────────────
// Ordered: active created → family → regular NPCs → fictitious → legacy/unknown
const TYPE_ORDER = [
  'active_created_character',
  'npc_family_member',
  'npc_regular',
  'npc_fictitious',
];

const TYPE_LABELS = {
  active_created_character: 'Your Characters',
  npc_family_member: 'Family Members',
  npc_regular: 'Regular NPCs',
  npc_fictitious: 'Fictitious NPCs',
};

function getTypeLabel(type) {
  return TYPE_LABELS[type] || `Other (${type || 'legacy'})`;
}

/**
 * Group and sort characters by type, then alphabetically within each group.
 * Legacy characters with missing/unknown character_type are placed in their own group
 * rather than discarded — backward compatible with all pre-schema records.
 */
function groupCharacters(characters) {
  const groups = {};
  for (const char of characters) {
    const type = char.character_type || '__legacy__';
    if (!groups[type]) groups[type] = [];
    groups[type].push(char);
  }

  // Sort within each group alphabetically
  for (const type of Object.keys(groups)) {
    groups[type].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  // Build ordered list: known types first (in TYPE_ORDER), then any extras
  const ordered = [];
  const seen = new Set();
  for (const type of TYPE_ORDER) {
    if (groups[type]) {
      ordered.push({ type, label: getTypeLabel(type), chars: groups[type] });
      seen.add(type);
    }
  }
  for (const type of Object.keys(groups)) {
    if (!seen.has(type)) {
      ordered.push({ type, label: getTypeLabel(type), chars: groups[type] });
    }
  }
  return ordered;
}

// ── User Account Panel ────────────────────────────────────────────────────────
function UserAccountPanel({ user, userSettings }) {
  const balance = userSettings?.user_balance ?? null;
  return (
    <div className="bg-card border border-primary/30 rounded-2xl p-4 space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{user?.full_name || 'You'}</p>
          <p className="text-xs text-muted-foreground">Your Account</p>
        </div>
        {balance !== null && (
          <div className="flex items-center gap-0.5 text-base font-bold text-green-400">
            <DollarSign className="w-4 h-4" />
            {Number(balance).toLocaleString()}
          </div>
        )}
        {balance === null && (
          <span className="text-xs text-muted-foreground">$ --</span>
        )}
      </div>
    </div>
  );
}

// ── Character Account Row ─────────────────────────────────────────────────────
function CharacterAccountRow({ char, financialRecord, isSelected, onSelect, onManualTransaction }) {
  const balance = financialRecord?.current_balance;
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
      isSelected ? 'bg-primary/10 border-primary/50' : 'bg-card border-border hover:border-primary/30'
    }`}>
      <div onClick={onSelect} className="flex items-center gap-3 flex-1 min-w-0">
        <CharacterAvatar character={char} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{char.name}</p>
          {char.occupation && (
            <p className="text-xs text-muted-foreground truncate">{char.occupation}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 text-sm font-semibold shrink-0">
          {balance !== undefined && balance !== null ? (
            <span className={balance >= 0 ? 'text-green-400' : 'text-destructive'}>
              ${Number(balance).toLocaleString()}
            </span>
          ) : (
            <span className="text-muted-foreground/50">$ --</span>
          )}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onManualTransaction(); }}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
        title="Manual transaction"
      >
        <PlusCircle className="w-4 h-4" />
      </button>
      <button
        onClick={onSelect}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title={isSelected ? 'Collapse' : 'View details'}
      >
        {isSelected ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ── Main Finance Page ─────────────────────────────────────────────────────────
export default function Finance() {
  const queryClient = useQueryClient();
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [manualTransactionChar, setManualTransactionChar] = useState(null);
  const [processing, setProcessing] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userSettings } = useQuery({
    queryKey: ['userSettings', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserSettings.filter({ owner_email: currentUser.email }, '-created_date', 1).then(r => r[0] || null)
      : null,
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all characters owned by this user — not filtered to active only,
  // so legacy/moved_away characters also appear in finance.
  const { data: regularChars = [] } = useQuery({
    queryKey: ['financeChars', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ owner_email: currentUser.email }, '-created_date', 300)
      : [],
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch NPC/fictitious characters via backend (bypasses RLS)
  const { data: npcChars = [] } = useQuery({
    queryKey: ['financeNPCs', currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const res = await base44.functions.invoke('fetchNPCsForUser', {});
      return res?.data?.npcs || [];
    },
    enabled: !!currentUser?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Deduplicate
  const allChars = (() => {
    const seen = new Set();
    return [...regularChars, ...npcChars].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  // Fetch all CharacterFinancial records for this user
  const { data: financialRecords = [] } = useQuery({
    queryKey: ['allFinancialRecords', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.CharacterFinancial.filter({ owner_email: currentUser.email }, '-updated_date', 300)
      : [],
    enabled: !!currentUser?.email,
    staleTime: 3 * 60 * 1000,
  });

  // Build financial index: character_id → financial record
  const financialIndex = {};
  for (const rec of financialRecords) {
    if (rec.character_id) financialIndex[rec.character_id] = rec;
  }

  const characterGroups = groupCharacters(allChars);

  const handlePayroll = async () => {
    setProcessing(true);
    try {
      const res = await base44.functions.invoke('processPayroll', {});
      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['financeChars'] });
        queryClient.invalidateQueries({ queryKey: ['allFinancialRecords'] });
        alert(`Payroll processed for ${res.data.processed || 0} characters`);
      }
    } catch (err) {
      alert('Failed to process payroll');
    } finally {
      setProcessing(false);
    }
  };

  const handleHousingCosts = async () => {
    setProcessing(true);
    try {
      const res = await base44.functions.invoke('processHousingCosts', { backdated: false });
      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['allFinancialRecords'] });
        alert(`Housing costs processed for ${res.data.processed || 0} characters`);
      }
    } catch (err) {
      alert('Failed to process housing costs');
    } finally {
      setProcessing(false);
    }
  };

  const handleTransactionSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['allFinancialRecords', currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
  };

  const toggleChar = (id) => setSelectedCharId(prev => prev === id ? null : id);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 z-10">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-base font-bold text-foreground">Finance &amp; Accounts</h1>
          <p className="text-xs text-muted-foreground">Bank view — all accounts</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">

        {/* Your Account */}
        {currentUser && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Your Account</p>
            <UserAccountPanel user={currentUser} userSettings={userSettings} />
          </div>
        )}

        {/* Manual Triggers */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            Manual Triggers
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handlePayroll} disabled={processing} variant="outline" className="rounded-lg text-xs h-9">
              {processing ? 'Processing...' : 'Run Payroll Now'}
            </Button>
            <Button onClick={handleHousingCosts} disabled={processing} variant="outline" className="rounded-lg text-xs h-9">
              {processing ? 'Processing...' : 'Process Housing'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Manually trigger payroll and housing cost processing.</p>
        </div>

        {/* Character Accounts — grouped by type, alphabetized */}
        {characterGroups.map(group => (
          <div key={group.type} className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {group.label} <span className="font-normal">({group.chars.length})</span>
            </p>
            <div className="space-y-2">
              {group.chars.map(char => (
                <div key={char.id}>
                  <CharacterAccountRow
                    char={char}
                    financialRecord={financialIndex[char.id] || null}
                    isSelected={selectedCharId === char.id}
                    onSelect={() => toggleChar(char.id)}
                    onManualTransaction={() => setManualTransactionChar(char)}
                  />
                  {selectedCharId === char.id && (
                    <div className="mt-2 ml-2">
                      <FinancialDashboard characterId={char.id} key={char.id} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {allChars.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-sm">
            No characters found.
          </div>
        )}
      </div>

      {/* Manual Transaction Modal */}
      {manualTransactionChar && (
        <ManualTransactionModal
          character={manualTransactionChar}
          financialRecord={financialIndex[manualTransactionChar.id] || null}
          onClose={() => setManualTransactionChar(null)}
          onSuccess={handleTransactionSuccess}
        />
      )}

      <BottomNav />
    </div>
  );
}