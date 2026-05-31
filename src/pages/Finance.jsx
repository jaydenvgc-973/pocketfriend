import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Zap, DollarSign, User, PlusCircle, MinusCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BottomNav from '@/components/BottomNav';
import CharacterAvatar from '@/components/chat/CharacterAvatar';
import FinancialDashboard from '@/components/finance/FinancialDashboard';
import ManualTransactionModal from '@/components/finance/ManualTransactionModal';

// ── Character type grouping config ───────────────────────────────────────────
// Uses existing schema values only. Legacy types fall into "Other" — never hidden.
const TYPE_GROUPS = [
  { key: 'active_created_character', label: 'Your Characters' },
  { key: 'npc_family_member',        label: 'Family NPCs' },
  { key: 'npc_regular',              label: 'Regular NPCs' },
  { key: 'npc_fictitious',           label: 'Fictitious NPCs' },
];

function groupAndSortCharacters(characters) {
  const knownKeys = new Set(TYPE_GROUPS.map(g => g.key));
  const groups = [];

  for (const { key, label } of TYPE_GROUPS) {
    const members = characters
      .filter(c => c.character_type === key)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (members.length > 0) groups.push({ key, label, members });
  }

  // Legacy / unknown types — include all, never hide
  const legacyMembers = characters
    .filter(c => !c.character_type || !knownKeys.has(c.character_type))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (legacyMembers.length > 0) {
    groups.push({ key: '__legacy__', label: 'Other Characters', members: legacyMembers });
  }

  return groups;
}

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

// ── Per-character account row ─────────────────────────────────────────────────
function CharacterAccountRow({ character, isSelected, onSelect, onTransact, balance }) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
        isSelected ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-primary/40'
      }`}
      onClick={onSelect}
    >
      <CharacterAvatar character={character} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{character.name}</p>
        <p className="text-xs text-muted-foreground capitalize">
          {character.character_type?.replace(/_/g, ' ') || 'character'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {balance !== undefined && balance !== null ? (
          <span className="text-xs font-semibold text-green-400 flex items-center gap-0.5">
            <DollarSign className="w-3 h-3" />{Number(balance).toLocaleString()}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/40">$ --</span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            onClick={e => { e.stopPropagation(); onTransact('income'); }}
            className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/15 transition-colors"
            title="Add money"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onTransact('expense'); }}
            className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/15 transition-colors"
            title="Subtract money"
          >
            <MinusCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Character type group section ──────────────────────────────────────────────
function CharacterGroup({ label, members, selectedCharId, onSelectChar, onTransact, financialIndex }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-2 w-full text-left"
      >
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex-1">{label} ({members.length})</p>
        {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {!collapsed && (
        <div className="space-y-2">
          {members.map(char => (
            <div key={char.id}>
              <CharacterAccountRow
                character={char}
                isSelected={selectedCharId === char.id}
                onSelect={() => onSelectChar(char.id === selectedCharId ? null : char.id)}
                onTransact={(dir) => onTransact(char, dir)}
                balance={financialIndex?.[char.id]?.current_balance}
              />
              {selectedCharId === char.id && (
                <div className="mt-2 ml-1 border-l-2 border-primary/30 pl-3">
                  <FinancialDashboard characterId={char.id} key={char.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── User account panel ────────────────────────────────────────────────────────
function UserAccountPanel({ user, settings, isLoading }) {
  const balance = settings?.user_balance;
  const showBalance = balance !== undefined && balance !== null;
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{user?.full_name || 'You'}</p>
          <p className="text-xs text-muted-foreground">Your account</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold ${showBalance && balance >= 0 ? 'text-green-400' : showBalance ? 'text-red-400' : 'text-muted-foreground/50'}`}>
            {showBalance ? formatCurrency(balance) : isLoading ? '...' : '$ --'}
          </p>
          <p className="text-[10px] text-muted-foreground">current balance</p>
        </div>
      </div>
    </div>
  );
}

// ── Main Finance page ─────────────────────────────────────────────────────────
export default function Finance() {
  const queryClient = useQueryClient();
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [transactionTarget, setTransactionTarget] = useState(null); // { character, direction }
  const [processing, setProcessing] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  // All characters scoped to owner_email — no type filter, legacy-safe
  const { data: rlsCharacters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ owner_email: currentUser.email }, '-created_date', 300)
      : [],
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
  });

  // NPC fictitious — needs service-role fetch (same as Settings)
  const { data: npcFictitious = [] } = useQuery({
    queryKey: ['npc-characters', currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const res = await base44.functions.invoke('fetchNPCsForUser', {});
      return res?.data?.npcs || [];
    },
    enabled: !!currentUser?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Merge + deduplicate — all active/moved_away characters, never filter by type
  const allCharacters = (() => {
    const seen = new Set();
    return [...rlsCharacters, ...npcFictitious].filter(c => {
      if (!c.id || seen.has(c.id)) return false;
      if (c.status === 'deleted' || c.status === 'soft_deleted' || c.status === 'merged') return false;
      seen.add(c.id);
      return true;
    });
  })();

  const groups = groupAndSortCharacters(allCharacters);

  // User settings for user_balance
  const { data: userSettingsList = [], isLoading: isSettingsLoading } = useQuery({
    queryKey: ['userSettings', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserSettings.filter({ owner_email: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const userSettings = userSettingsList[0] || null;

  // Fetch all CharacterFinancial records to show balances on rows
  const { data: allFinancials = [] } = useQuery({
    queryKey: ['allCharacterFinancials', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.CharacterFinancial.filter({ owner_email: currentUser.email }, null, 300)
      : [],
    enabled: !!currentUser?.email,
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  // Index by character_id for O(1) lookup
  const financialIndex = allFinancials.reduce((acc, f) => {
    if (f.character_id) acc[f.character_id] = f;
    return acc;
  }, {});

  const handlePayroll = async () => {
    setProcessing(true);
    try {
      const res = await base44.functions.invoke('processPayroll', {});
      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        alert(`Payroll processed for ${res.data.processed} characters`);
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
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        alert(`Housing costs processed for ${res.data.processed} characters`);
      }
    } catch (err) {
      alert('Failed to process housing costs');
    } finally {
      setProcessing(false);
    }
  };

  const openTransact = (character, direction) => {
    setTransactionTarget({ character, direction });
  };

  const handleTransactionSuccess = (result) => {
    setTransactionTarget(null);
    // Invalidate financial data for the affected character
    queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ['allCharacterFinancials', currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ['financials', result.character_id || transactionTarget?.character?.id] });
    // Refresh the selected dashboard if open
    if (selectedCharId) {
      setSelectedCharId(null);
      setTimeout(() => setSelectedCharId(result.character_id || selectedCharId), 50);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 z-10">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-foreground">Finance &amp; Accounts</h1>
          <p className="text-[10px] text-muted-foreground">Bank dashboard — all accounts</p>
        </div>
        <DollarSign className="w-5 h-5 text-green-400" />
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">

        {/* User Account Panel */}
        {currentUser && (
          <UserAccountPanel user={currentUser} settings={userSettings} isLoading={isSettingsLoading} />
        )}

        {/* Manual Triggers */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
            Automatic Systems
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handlePayroll} disabled={processing} variant="outline" className="rounded-lg text-xs h-9">
              {processing ? 'Processing...' : 'Run Payroll Now'}
            </Button>
            <Button onClick={handleHousingCosts} disabled={processing} variant="outline" className="rounded-lg text-xs h-9">
              {processing ? 'Processing...' : 'Process Housing'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Manually trigger automatic payroll and housing cost systems. These do not affect manual transactions.</p>
        </div>

        {/* Character Groups */}
        {groups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No characters found.</div>
        ) : (
          <div className="space-y-5">
            {groups.map(group => (
              <div key={group.key} className="bg-card border border-border rounded-xl p-4 space-y-3">
                <CharacterGroup
                  label={group.label}
                  members={group.members}
                  selectedCharId={selectedCharId}
                  onSelectChar={setSelectedCharId}
                  onTransact={openTransact}
                  financialIndex={financialIndex}
                />
              </div>
            ))}
          </div>
        )}


      </div>

      {/* Manual Transaction Modal */}
      {transactionTarget && (
        <ManualTransactionModal
          character={transactionTarget.character}
          initialDirection={transactionTarget.direction}
          onClose={() => setTransactionTarget(null)}
          onSuccess={handleTransactionSuccess}
        />
      )}

      <BottomNav />
    </div>
  );
}