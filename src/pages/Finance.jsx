import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Zap, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BottomNav from '@/components/BottomNav';
import CharacterAvatar from '@/components/chat/CharacterAvatar';
import FinancialDashboard from '@/components/finance/FinancialDashboard';

export default function Finance() {
  const queryClient = useQueryClient();
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [processing, setProcessing] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ owner_email: currentUser.email, status: 'active' }, '-created_date')
      : [],
    enabled: !!currentUser?.email,
  });

  const handlePayroll = async () => {
    setProcessing(true);
    try {
      const res = await base44.functions.invoke('processPayroll', {});
      if (res?.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        alert(`Payroll processed for ${res.data.processed} characters`);
      }
    } catch (err) {
      console.error('Payroll error:', err);
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
      console.error('Housing costs error:', err);
      alert('Failed to process housing costs');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-base font-bold text-foreground">Financial System</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Manual Triggers */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            Manual Triggers
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handlePayroll}
              disabled={processing}
              variant="outline"
              className="rounded-lg text-xs h-10"
            >
              {processing ? 'Processing...' : 'Run Payroll Now'}
            </Button>
            <Button
              onClick={handleHousingCosts}
              disabled={processing}
              variant="outline"
              className="rounded-lg text-xs h-10"
            >
              {processing ? 'Processing...' : 'Process Housing'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Manually trigger payroll and housing cost processing for all characters.
          </p>
        </div>

        {/* Character Selection */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Characters</h2>
          <div className="grid grid-cols-2 gap-2">
            {characters.map(char => (
              <button
                key={char.id}
                onClick={() => setSelectedCharId(char.id)}
                className={`p-3 rounded-xl border transition-colors flex flex-col items-center gap-2 text-center ${
                  selectedCharId === char.id
                    ? 'bg-primary/10 border-primary'
                    : 'bg-card border-border hover:border-primary/40'
                }`}
              >
                <CharacterAvatar character={char} size="sm" />
                <span className="text-xs font-medium text-foreground truncate">{char.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Financial Dashboard */}
        {selectedCharId ? (
          <FinancialDashboard characterId={selectedCharId} key={selectedCharId} />
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Select a character to view financial details
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}