import React from "react";

/**
 * SceneProductCard — renders a purchasable item card in the scene chat.
 * - clothing: routes to ProductPurchaseModal for closet save
 * - consumable (food/drink): direct financial deduction, no closet save
 */
export default function SceneProductCard({ msg, settings, location, currentUser, queryClient, base44, setPendingPurchase, setMessages }) {
  const handleBuy = () => {
    if (msg.purchased) return;

    if (msg.purchase_type === "clothing") {
      // Clothing → ProductPurchaseModal which handles closet save
      setPendingPurchase({
        price: msg.price,
        productId: msg.id,
        preview_image_url: msg.preview_image_url,
        purchase_type: msg.purchase_type,
      });
    } else {
      // Consumable (food/drink) — direct financial deduction, NO closet/gallery save
      const cost = msg.price;
      const newBalance = Math.max(0, (settings.user_balance ?? 6000) - cost);
      if (settings.id) {
        base44.entities.UserSettings.update(settings.id, { user_balance: newBalance }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      }
      // Record venue spend for financial history
      base44.functions.invoke('recordVenueSpending', {
        locationId: location?.id,
        locationName: location?.name,
        amount: cost,
        description: 'Scene purchase',
        ownerEmail: currentUser?.email,
      }).catch(() => {});
      // Mark card as purchased so it can't be double-clicked
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, purchased: true } : m));
    }
  };

  return (
    <button
      onClick={handleBuy}
      disabled={msg.purchased}
      className={`flex flex-col items-center gap-2 p-3 rounded-2xl bg-card border-2 transition-all max-w-[75%] ${
        msg.purchased
          ? "border-green-500/40 opacity-60 cursor-default"
          : "border-primary/40 hover:border-primary/80 hover:shadow-lg"
      }`}
    >
      <div className="w-32 h-32 bg-primary/10 rounded-lg flex items-center justify-center overflow-hidden">
        {msg.preview_image_url
          ? <img src={msg.preview_image_url} alt="Product" className="w-full h-full object-cover rounded-lg" />
          : <span className="text-4xl">{msg.purchase_type === "clothing" ? "👔" : "🍽️"}</span>
        }
      </div>
      <p className="text-sm font-bold text-foreground">${msg.price}</p>
      <p className="text-xs text-muted-foreground">{msg.purchased ? "✓ Purchased" : "Click to buy"}</p>
    </button>
  );
}