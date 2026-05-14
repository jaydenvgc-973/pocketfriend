import React, { useState } from 'react';
import { DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import SendMoneyModal from './SendMoneyModal';
import ReceiveMoneyModal from './ReceiveMoneyModal';

export default function FinancialActionsPanel({ character, userBalance, onSendMoney, isSending }) {
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  return (
    <>
      {/* Action Buttons */}
      <div className="flex gap-2 px-4 py-2 border-t border-border bg-secondary/20">
        <button
          onClick={() => setShowSend(true)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors"
        >
          <TrendingDown className="w-4 h-4" />
          Send Money
        </button>
        <button
          onClick={() => setShowReceive(true)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-600 text-sm font-medium transition-colors"
        >
          <TrendingUp className="w-4 h-4" />
          Receive Money
        </button>
      </div>

      {/* Modals */}
      {showSend && (
        <SendMoneyModal
          character={character}
          userBalance={userBalance}
          onSend={(amount, reason) => {
            onSendMoney(amount, reason);
            setShowSend(false);
          }}
          onClose={() => setShowSend(false)}
          isSending={isSending}
        />
      )}

      {showReceive && (
        <ReceiveMoneyModal
          character={character}
          conversationCharacterId={character?.id}
          onClose={() => setShowReceive(false)}
        />
      )}
    </>
  );
}