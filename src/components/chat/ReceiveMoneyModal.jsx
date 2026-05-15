import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { AlertCircle, Check, X, Loader2 } from 'lucide-react';

const STEP_CHARACTER = 'character';
const STEP_MODE = 'mode';
const STEP_DETAILS = 'details';
const STEP_CONFIRM = 'confirm';
const STEP_RESULT = 'result';

const BALANCE_UNAVAILABLE = 'UNAVAILABLE';

export default function ReceiveMoneyModal({ character, onClose, conversationCharacterId }) {
  const [step, setStep] = useState(conversationCharacterId ? STEP_MODE : STEP_CHARACTER);
  const [selectedCharacter, setSelectedCharacter] = useState(() => {
    if (conversationCharacterId) return null;
    return character || null;
  });
  const [mode, setMode] = useState(null);
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [urgency, setUrgency] = useState('normal');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [characterBalance, setCharacterBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const loadCharacterBalance = async (charId, charName) => {
    setLoadingBalance(true);
    setCharacterBalance(null);
    try {
      const finRecords = await base44.entities.CharacterFinancial.filter({ character_id: charId }, null, 1);
      const finRecord = finRecords?.[0];
      const balance = (finRecord && typeof finRecord.current_balance === 'number')
        ? finRecord.current_balance
        : BALANCE_UNAVAILABLE;
      setCharacterBalance(balance);
    } catch (err) {
      setCharacterBalance(BALANCE_UNAVAILABLE);
    } finally {
      setLoadingBalance(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const me = await base44.auth.me();
        const chars = await base44.entities.Character.filter({ owner_email: me.email }, null, 200);
        const filtered = chars.filter(c => !['deleted', 'soft_deleted', 'merged'].includes(c.status));
        setCharacters(filtered);
        if (conversationCharacterId) {
          const convChar = filtered.find(c => c.id === conversationCharacterId);
          if (convChar) setSelectedCharacter(convChar);
        }
      } catch (err) {
        console.error('Failed to load characters:', err.message);
      }
    };
    loadData();
  }, [conversationCharacterId]);

  const handleSelectCharacter = (char) => {
    setSelectedCharacter(char);
    setStep(STEP_MODE);
  };

  const handleSelectMode = async (selectedMode) => {
    setMode(selectedMode);
    setStep(STEP_DETAILS);
    if (selectedMode === 'take' && selectedCharacter) {
      await loadCharacterBalance(selectedCharacter.id, selectedCharacter.name);
    }
  };

  const amountExceedsBalance =
    mode === 'take' &&
    typeof characterBalance === 'number' &&
    parseFloat(amount) > characterBalance;

  const balanceIsReady =
    mode !== 'take' ||
    (typeof characterBalance === 'number' && !loadingBalance);

  const reviewDisabled =
    !amount ||
    !title ||
    !balanceIsReady ||
    amountExceedsBalance;

  const reviewDisabledReason = !amount
    ? 'Enter an amount.'
    : !title
    ? 'Enter a statement title.'
    : mode === 'take' && loadingBalance
    ? 'Balance is still loading.'
    : mode === 'take' && characterBalance === BALANCE_UNAVAILABLE
    ? 'Balance could not be loaded.'
    : amountExceedsBalance
    ? 'Amount exceeds available balance.'
    : null;

  const handleDetailsSubmit = () => {
    if (reviewDisabled) return;
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
      setResult({ success: false, error: err.message });
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

  const fmtBalance = (bal) =>
    typeof bal === 'number'
      ? bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';

  return (
    // Full-screen overlay
    <div className="fixed inset-0 z-[9999] bg-black/60 flex flex-col justify-end">

      {/* ━━━ MODAL SHELL — fixed bottom sheet, never taller than viewport minus nav ━━━ */}
      <div
        className="w-full bg-card rounded-t-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 68px)' }}
      >

        {/* ━━━ HEADER — flex-shrink-0, never scrolls ━━━ */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center justify-between rounded-t-2xl bg-card">
          <h2 className="text-lg font-bold">Receive Money</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ━━━ BODY — scrollable, flex-1 with min-h-0 so it doesn't push footer ━━━ */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">

          {step === STEP_CHARACTER && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Select who to receive from</p>
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
                    <div className="text-xs text-muted-foreground">{char.is_active_character ? 'Active Character' : 'NPC'}</div>
                  </button>
                ))
              )}
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
                  <div className="font-semibold text-green-500">REQUEST</div>
                  <div className="text-xs text-muted-foreground mt-1">They know &amp; decide</div>
                </button>
                <button
                  onClick={() => handleSelectMode('take')}
                  className="p-4 rounded-lg border-2 border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                >
                  <div className="font-semibold text-amber-500">TAKE</div>
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
                  placeholder={mode === 'request' ? 'e.g., "Help with groceries"' : 'e.g., "Payroll" or "coffee"'}
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
                      className="mt-1 h-20"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Urgency</label>
                    <select
                      value={urgency}
                      onChange={(e) => setUrgency(e.target.value)}
                      className="w-full mt-1 p-2 rounded-lg border border-border bg-background text-foreground"
                    >
                      <option value="low">Low - whenever you can</option>
                      <option value="normal">Normal - soon</option>
                      <option value="urgent">Urgent - ASAP</option>
                    </select>
                  </div>
                </>
              )}

              {mode === 'take' && (
                <>
                  <div className={`p-3 rounded-lg border ${
                    loadingBalance ? 'bg-secondary/30 border-border'
                    : characterBalance === BALANCE_UNAVAILABLE ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-blue-500/10 border-blue-500/30'
                  }`}>
                    <p className={`text-xs font-semibold mb-1 ${
                      loadingBalance ? 'text-muted-foreground'
                      : characterBalance === BALANCE_UNAVAILABLE ? 'text-red-400'
                      : 'text-blue-400'
                    }`}>
                      {selectedCharacter?.name}'s Available Balance
                    </p>
                    {loadingBalance ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Loading account...</span>
                      </div>
                    ) : characterBalance === BALANCE_UNAVAILABLE ? (
                      <p className="text-lg font-bold text-red-400">Balance unavailable</p>
                    ) : (
                      <p className="text-2xl font-bold text-blue-300">${fmtBalance(characterBalance)}</p>
                    )}
                  </div>

                  {amountExceedsBalance && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex gap-2 items-start">
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-400">
                        Insufficient funds. {selectedCharacter?.name} only has ${fmtBalance(characterBalance)} available.
                      </p>
                    </div>
                  )}

                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex gap-2 items-start">
                    <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-400">
                      This may affect trust if discovered. Character will see this as a normal transaction.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {step === STEP_CONFIRM && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-foreground">Review your transaction</p>
              <Card className="p-4 space-y-3 bg-secondary/30">
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
                    <span className="font-semibold text-green-400">${parseFloat(amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{mode === 'request' ? 'Reason' : 'Statement'}:</span>
                    <span className="font-semibold text-right max-w-[200px]">{title}</span>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {step === STEP_RESULT && (
            <div className={`p-4 rounded-lg border flex gap-3 ${result?.success ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
              {result?.success
                ? <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                : <X className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              }
              <div className="text-sm">
                {result?.success ? (
                  <>
                    <div className="font-semibold text-green-400">{result.message || 'Transaction complete.'}</div>
                    {result.outcome && <div className="text-xs text-green-500 mt-1">{result.outcome}</div>}
                  </>
                ) : (
                  <div className="font-semibold text-red-400">{result?.error || 'Transaction failed.'}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            FOOTER — flex-shrink-0, OUTSIDE scroll body, ALWAYS VISIBLE
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div className="flex-shrink-0 bg-card border-t border-border px-4 pt-3 pb-4 space-y-2">

          {/* Disabled reason hint — visible when Review is blocked */}
          {step === STEP_DETAILS && reviewDisabled && reviewDisabledReason && (
            <p className="text-xs text-center text-muted-foreground">{reviewDisabledReason}</p>
          )}

          <div className="flex gap-3">
            {/* BACK — shown on all steps except character picker */}
            {step !== STEP_CHARACTER && step !== STEP_RESULT && (
              <Button variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
            )}

            {/* CANCEL — only on character picker step */}
            {step === STEP_CHARACTER && (
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
            )}

            {/* REVIEW — STEP_DETAILS */}
            {step === STEP_DETAILS && (
              <Button
                onClick={handleDetailsSubmit}
                disabled={reviewDisabled}
                className="flex-1 font-semibold"
              >
                Review
              </Button>
            )}

            {/* CONFIRM TAKE / SEND REQUEST — STEP_CONFIRM */}
            {step === STEP_CONFIRM && (
              <Button
                onClick={handleConfirmSubmit}
                disabled={isProcessing}
                className="flex-1 font-semibold"
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                ) : mode === 'take' ? 'Confirm TAKE' : 'Send Request'}
              </Button>
            )}

            {/* DONE / TRY AGAIN — STEP_RESULT */}
            {step === STEP_RESULT && (
              <Button onClick={result?.success ? onClose : handleBack} className="flex-1 font-semibold">
                {result?.success ? 'Done' : 'Try Again'}
              </Button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}