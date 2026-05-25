import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export default function SleepDebtRemovalPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleRemoveSleepDebt = async () => {
    if (!window.confirm('This will permanently remove all sleep debt from all your characters. Continue?')) {
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await base44.functions.invoke('removeSleepDebtLive', {});
      setResult(response.data);
    } catch (err) {
      setError(err.message || 'Failed to remove sleep debt');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 border-destructive/50">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
          <div>
            <h3 className="font-semibold text-destructive">Sleep Debt Removal</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Sleep debt has been completely removed from the system. Click below to clean up any remaining legacy values from your character records.
            </p>
          </div>
        </div>

        <Button
          onClick={handleRemoveSleepDebt}
          disabled={loading}
          variant="destructive"
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Cleaning up...
            </>
          ) : (
            'Remove Legacy Sleep Debt Values'
          )}
        </Button>

        {result && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded p-3 space-y-2">
            <div className="flex items-center gap-2 text-green-800 dark:text-green-100 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Cleanup Complete
            </div>
            <div className="text-sm text-green-700 dark:text-green-200 space-y-1">
              <p>Characters audited: {result.audit.total_characters}</p>
              <p>Characters repaired: {result.audit.total_repaired}</p>
              {result.characters_repaired.length > 0 && (
                <div className="mt-2">
                  <p className="font-semibold">Cleaned characters:</p>
                  <ul className="list-disc list-inside ml-0">
                    {result.characters_repaired.map(name => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/50 rounded p-3 text-sm text-destructive">
            Error: {error}
          </div>
        )}
      </div>
    </Card>
  );
}