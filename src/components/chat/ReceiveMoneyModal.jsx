import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { AlertCircle, Check, X } from 'lucide-react';
import { Loader2 } from 'lucide-react';

const STEP_CHARACTER = 'character';
const STEP_MODE = 'mode';
const STEP_DETAILS = 'details';
const STEP_CONFIRM = 'confirm';
const STEP_RESULT = 'result';

export default function ReceiveMoneyModal({ character, onClose }) {
  const [step, setStep] = useState(STEP_CHARACTER);
  const [selectedCharacter, setSelectedCharacter] = useState(character || null);
  const [mode, setMode] = useState(null); // 'request' or 'take'
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [urgency, setUrgency] = useState('normal');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const me = await base44.auth.me();
        setUser(me);
        const chars = await base44.entities.Character.filter(
          { owner_email: me.email },
          null,
          100
        );
        setCharacters(chars.filter(c => c.is_active_character || c.character_type === 'npc_fictitious'));
      } catch (err) {
        console.error('Failed to load characters:', err.message);
      }
    };
    loadData();
  }, []);

  const handleSelectCharacter = (char) => {
    setSelectedCharacter(char);
    setStep(STEP_MODE);
  };

  const handleSelectMode = (selectedMode) => {
    setMode(selectedMode);
    setStep(STEP_DETAILS);
  };

  const handleDetailsSubmit = () => {
    if (!amount || !title) return;
    setStep(STEP_CONFIRM);
  };

  const handleConfirmSubmit = async () => {
    if (!selectedCharacter || !mode || !amount) return;
    setIsProcessing(true);
    try {
      const payload = {
        characterId: selectedCharacter.id,
        mode,
        amount: parseFloat(amount),
        title,
        note: note || undefined,
        urgency: mode === 'request' ? urgency : undefined,
      };

      const response = await base44.functions.invoke(
        mode === 'request' ? 'processMoneyRequest' : 'processMoneytake',
        payload
      );

      setResult(response.data);
      setStep(STEP_RESULT);
    } catch (err) {
      setResult({
        success: false,
        error: err.message,
      });
      setStep(STEP_RESULT);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    if (step === STEP_MODE) setStep(STEP_CHARACTER);
    else if (step === STEP_DETAILS) setStep(STEP_MODE);
    else if (step === STEP_CONFIRM) setStep(STEP_DETAILS);
    else if (step === STEP_RESULT) {
      setStep(STEP_CHARACTER);
      setSelectedCharacter(null);
      setMode(null);
      setAmount('');
      setTitle('');
      setNote('');
      if (result?.success) onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50">
      <div className="w-full max-w-lg bg-card rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex justify-between items-center">
          <h2 className="text-xl font-bold">Receive Money</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {step === STEP_CHARACTER && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Select who to receive from</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {characters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No characters available</p>
                ) : (
                  characters.map(char => (
                    <button
                      key={char.id}
                      onClick={() => handleSelectCharacter(char)}
                      className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary transition-colors"
                    >
                      <div className="font-semibold">{char.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {char.is_active_character ? 'Active Character' : 'NPC'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {step === STEP_MODE && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Choose interaction type with <span className="font-semibold">{selectedCharacter?.name}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleSelectMode('request')}
                  className="p-4 rounded-lg border-2 border-green-500/30 hover:bg-green-500/10 transition-colors"
                >
                  <div className="font-semibold text-green-600">REQUEST</div>
                  <div className="text-xs text-muted-foreground mt-1">They know &amp; decide</div>
                </button>
                <button
                  onClick={() => handleSelectMode('take')}
                  className="p-4 rounded-lg border-2 border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                >
                  <div className="font-semibold text-amber-600">TAKE</div>
                  <div className="text-xs text-muted-foreground mt-1">Hidden withdrawal</div>
                </button>
              </div>
            </div>
          )}

          {step === STEP_DETAILS && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Amount ($)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium">
                  {mode === 'request' ? 'Reason / Title' : 'Statement Title'}
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    mode === 'request'
                      ? 'e.g., "Help with groceries"'
                      : 'e.g., "McDonald\'s" or "Uber"'
                  }
                  className="mt-1"
                />
              </div>

              {mode === 'request' && (
                <>
                  <div>
                    <label className="text-sm font-medium">Note (optional)</label>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add context or emotional framing..."
                      className="mt-1 h-24"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Urgency</label>
                    <select
                      value={urgency}
                      onChange={(e) => setUrgency(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-border bg-background"
                    >
                      <option value="low">Low - whenever you can</option>
                      <option value="normal">Normal - soon</option>
                      <option value="urgent">Urgent - ASAP</option>
                    </select>
                  </div>
                </>
              )}

              {mode === 'take' && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    This may affect trust if discovered. Character will see this as a normal transaction.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === STEP_CONFIRM && (
            <Card className="p-4 space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">From:</span>
                  <span className="font-semibold">{selectedCharacter?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type:</span>
                  <span className="font-semibold capitalize">{mode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-semibold">${parseFloat(amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{mode === 'request' ? 'Reason' : 'Statement'}:</span>
                  <span className="font-semibold text-right max-w-xs">{title}</span>
                </div>
              </div>
            </Card>
          )}

          {step === STEP_RESULT && (
            <div
              className={`p-4 rounded-lg border flex gap-3 ${
                result?.success
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-red-500/10 border-red-500/30'
              }`}
            >
              {result?.success ? (
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <X className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                {result?.success ? (
                  <div>
                    <div className="font-semibold text-green-700">{result.message}</div>
                    {result.outcome && (
                      <div className="text-xs text-green-600 mt-1">{result.outcome}</div>
                    )}
                  </div>
                ) : (
                  <div className="font-semibold text-red-700">{result?.error || 'Transaction failed'}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex gap-3">
          {step !== STEP_CHARACTER && (
            <Button variant="outline" onClick={handleBack} className="flex-1">
              Back
            </Button>
          )}
          {step === STEP_DETAILS && (
            <Button
              onClick={handleDetailsSubmit}
              disabled={!amount || !title}
              className="flex-1"
            >
              Review
            </Button>
          )}
          {step === STEP_CONFIRM && (
            <Button
              onClick={handleConfirmSubmit}
              disabled={isProcessing}
              className="flex-1"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          )}
          {step === STEP_RESULT && (
            <Button onClick={handleBack} className="flex-1">
              {result?.success ? 'Done' : 'Try Again'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}