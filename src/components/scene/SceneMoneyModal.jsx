import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, ArrowRight, DollarSign, Loader2 } from "lucide-react";
import SendMoneyModal from "@/components/chat/SendMoneyModal";
import ReceiveMoneyModal from "@/components/chat/ReceiveMoneyModal";
import { resolveOrCreateConversation } from "@/lib/conversationResolver";

/**
 * SceneMoneyModal — the scene's way INTO the established financial interactions.
 *
 * It only decides WHO is paying and WHO is paid, using the scene's own participants
 * (the selected cast, plus the User only while they are physically present). The money
 * itself is always moved by the existing pathways, unchanged:
 *   • User pays a character  → the Chat page's SendMoneyModal → sendMoneyToCharacter
 *   • a character pays the User → the Chat page's ReceiveMoneyModal → processMoneyRequest /
 *     processMoneytake (Request and Take keep their own meaning and consequences)
 *   • a character pays a character → transferMoneyBetweenCharacters
 * Balances, records and outcomes are never touched here.
 */
export default function SceneMoneyModal({
  mode = "send",
  actors = [],
  userBalance = 0,
  currentUser,
  onClose,
  onCompleted,
}) {
  const userActor = actors.find((a) => a.isUser) || null;
  const charActors = actors.filter((a) => !a.isUser && a.id);
  const firstChar = charActors[0] || null;

  const [fromId, setFromId] = useState(() =>
    mode === "send" ? (userActor?.id ?? firstChar?.id ?? null) : (firstChar?.id ?? null)
  );
  const [toId, setToId] = useState(() => {
    if (mode === "send") return firstChar?.id ?? null;
    if (userActor) return userActor.id;
    return charActors[1]?.id ?? null;
  });
  const [route, setRoute] = useState(null); // null | 'send' | 'receive' | 'character'
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);

  const from = actors.find((a) => a.id === fromId) || null;
  const to = actors.find((a) => a.id === toId) || null;
  const samePerson = !!from && !!to && from.id === to.id;
  const canContinue = !!from && !!to && !samePerson && charActors.length > 0;

  // Choosing someone already on the other side swaps the two, so the pair is never the
  // same person and a two-person scene can still be turned around.
  const selectSide = (side, id) => {
    if (side === "from") {
      if (id === toId) setToId(fromId);
      setFromId(id);
    } else {
      if (id === fromId) setFromId(toId);
      setToId(id);
    }
  };

  const openEstablished = () => {
    if (!canContinue) return;
    setError(null);
    if (from.isUser) return setRoute("send");
    if (to.isUser) return setRoute("receive");
    setRoute("character");
  };

  // ── USER PAYS A CHARACTER — the Chat page's own send pathway ──────────────
  const handleSend = async (sendAmount, reason, direction) => {
    setIsBusy(true);
    setError(null);
    try {
      const conversationId = currentUser?.email
        ? await resolveOrCreateConversation({
            characterId: to.id,
            characterName: to.name,
            chatType: "direct",
            ownerEmail: currentUser.email,
          }).catch(() => null)
        : null;
      await base44.functions.invoke("sendMoneyToCharacter", {
        characterId: to.id,
        conversationId,
        amount: sendAmount,
        reason,
        direction,
      });
      onCompleted?.(`💸 ${from.name} sent $${sendAmount.toLocaleString()} to ${to.name}.`);
      onClose();
    } catch (err) {
      // Nothing was transferred — back to the picker, where the reason is shown.
      setError(err?.message || "The transfer could not be completed.");
      setIsBusy(false);
      setRoute(null);
    }
  };

  // ── A CHARACTER PAYS THE USER — Request and Take keep their outcomes ──────
  const handleReceiveResult = (data, receiveMode, requestedAmount) => {
    if (!data) return;
    if (receiveMode === "take" && data.success) {
      onCompleted?.(`💸 $${Number(requestedAmount).toLocaleString()} moved from ${from.name}'s account.`);
      return;
    }
    if (data.outcome === "approved" || data.outcome === "counter_offer") {
      const paid = Number(data.finalAmount ?? requestedAmount);
      onCompleted?.(`💸 ${from.name} sent $${paid.toLocaleString()} to ${to.name}.`);
      return;
    }
    if (data.outcome === "denied") {
      onCompleted?.(`${from.name} declined the request.`);
    }
  };

  // ── CHARACTER PAYS CHARACTER — the established transfer function ──────────
  const handleCharacterTransfer = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0 || isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("transferMoneyBetweenCharacters", {
        from_type: "character",
        from_id: from.id,
        to_character_id: to.id,
        amount: value,
        transfer_type: "gift",
        note: note.trim() || undefined,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      onCompleted?.(`💸 ${from.name} sent $${value.toLocaleString()} to ${to.name}.`);
      onClose();
    } catch (err) {
      setError(err?.message || "The transfer could not be completed.");
      setIsBusy(false);
    }
  };

  // ── The established modals, exactly as Chat uses them ────────────────────
  if (route === "send") {
    return (
      <SendMoneyModal
        character={{ id: to.id, name: to.name }}
        userBalance={userBalance}
        isSending={isBusy}
        onSend={handleSend}
        onClose={() => setRoute(null)}
      />
    );
  }

  if (route === "receive") {
    return (
      <ReceiveMoneyModal
        character={{ id: from.id, name: from.name }}
        conversationCharacterId={from.id}
        onClose={() => setRoute(null)}
        onResult={handleReceiveResult}
      />
    );
  }

  // ── WHO PAYS AND WHO IS PAID ─────────────────────────────────────────────
  const renderRow = (label, selectedId, onSelect) => (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {actors.map((a) => {
          const isSelected = a.id === selectedId;
          return (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                isSelected
                  ? "bg-primary/20 border-primary/60 text-primary"
                  : "bg-secondary border-border text-foreground hover:border-primary/40"
              }`}
            >
              {a.isUser ? `${a.name} (you)` : a.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm px-3 pb-4 sm:pb-0" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-4 space-y-4 max-h-[85dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {mode === "send" ? "Send Money" : "Receive Money"}
            </h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {charActors.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No one else is in this scene to exchange money with.
          </p>
        ) : (
          <>
            {renderRow("From", fromId, (id) => selectSide("from", id))}
            {renderRow("To", toId, (id) => selectSide("to", id))}

            {route === "character" ? (
              <div className="space-y-3 pt-1">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Amount ($)</p>
                  <input
                    type="number"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-foreground text-base font-semibold outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Note (optional)</p>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. rent, groceries…"
                    className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-foreground text-xs outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <button
                  onClick={handleCharacterTransfer}
                  disabled={isBusy || !parseFloat(amount)}
                  className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                  Send from {from.name} to {to.name}
                </button>
                <button onClick={() => setRoute(null)} className="w-full text-[11px] text-muted-foreground underline">
                  Change who pays
                </button>
              </div>
            ) : (
              <button
                onClick={openEstablished}
                disabled={!canContinue}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </>
        )}

        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
}