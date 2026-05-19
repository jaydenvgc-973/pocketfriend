import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { RefreshCw, Check, X, ShoppingBag } from "lucide-react";

/**
 * SceneProductCard — venue-aware product card with:
 * 1. Item-specific AI-generated image (never scene/venue photo)
 * 2. Accept / Reject / Ask for another review flow before any transaction
 * 3. Clothing → ProductPurchaseModal for closet save
 * 4. Consumable → direct deduction only after explicit Accept
 */
export default function SceneProductCard({
  msg,
  settings,
  location,
  currentUser,
  queryClient,
  base44: b44,
  setPendingPurchase,
  setMessages,
}) {
  const [itemImageUrl, setItemImageUrl] = useState(null);
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [status, setStatus] = useState("pending"); // pending | accepted | rejected

  // Build a focused product image prompt — item-specific, never scene/venue background.
  // item_category is the authoritative type set by the action and venue context.
  const buildItemPrompt = () => {
    const itemLabel = msg.item_label || "product";
    const category = msg.item_category;

    switch (category) {
      case "drink":
        return `Professional bar photography of a ${itemLabel}, beautifully presented in a glass on a bar surface, close-up, clean background, high detail, no food items`;
      case "food":
        return `Professional food photography of ${itemLabel}, beautifully plated on a dish, restaurant quality, close-up, clean light background, high detail, no drinks`;
      case "clothing":
        return `Professional retail product photography of ${itemLabel}, isolated on clean white background, studio lighting, high detail, no people`;
      case "home_goods":
        return `Professional product photography of ${itemLabel}, clean white or light grey background, studio shot, sharp detail, no people`;
      case "hardware":
        return `Professional product photography of ${itemLabel}, isolated on clean background, hardware store presentation, sharp detail, no people`;
      case "grocery":
        return `Professional grocery product photography of ${itemLabel}, clean background, sharp detail, well-lit, no people`;
      case "pharmacy":
        return `Professional pharmacy product photography of ${itemLabel}, clean white background, clinical presentation, sharp detail, no people`;
      case "electronics":
        return `Professional electronics product photography of ${itemLabel}, isolated on clean dark or white background, tech product style, high detail, no people`;
      default: {
        // Infer from label
        const labelLower = itemLabel.toLowerCase();
        if (/\b(cocktail|drink|beer|wine|shot|mojito|margarita|vodka|rum|gin|whiskey|bourbon|lager|cider|champagne|prosecco|daiquiri|martini|latte|espresso|coffee)\b/i.test(labelLower)) {
          return `Professional bar or café photography of a ${itemLabel}, beautifully presented, close-up, clean background`;
        }
        if (/\b(shirt|jacket|pants|shoes|boots|bag|dress|coat|sneakers|hoodie|jeans)\b/i.test(labelLower)) {
          return `Professional retail product photography of ${itemLabel}, clean white background, studio lighting, high detail`;
        }
        if (/\b(drill|hammer|wrench|saw|screwdriver|paint|lumber|tool)\b/i.test(labelLower)) {
          return `Professional product photography of ${itemLabel}, hardware store presentation, clean background, sharp detail`;
        }
        return `Professional product photography of ${itemLabel}, clean background, studio lighting, sharp detail, no people`;
      }
    }
  };

  // Generate item-specific image on mount
  useEffect(() => {
    let cancelled = false;
    setIsLoadingImage(true);
    base44.integrations.Core.GenerateImage({ prompt: buildItemPrompt() })
      .then(r => { if (!cancelled) setItemImageUrl(r.url); })
      .catch(() => { if (!cancelled) setItemImageUrl(null); })
      .finally(() => { if (!cancelled) setIsLoadingImage(false); });
    return () => { cancelled = true; };
  }, [msg.id]); // only once per card

  const handleAccept = () => {
    if (status !== "pending") return;
    setStatus("accepted");

    if (msg.purchase_type === "clothing") {
      // Clothing → ProductPurchaseModal (handles closet save)
      setPendingPurchase({
        price: msg.price,
        productId: msg.id,
        preview_image_url: itemImageUrl,
        item_label: msg.item_label,
        purchase_type: msg.purchase_type,
      });
    } else {
      // Consumable — direct deduction after explicit accept
      const cost = msg.price;
      const newBalance = Math.max(0, (settings.user_balance ?? 6000) - cost);
      if (settings.id) {
        base44.entities.UserSettings.update(settings.id, { user_balance: newBalance }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      }
      base44.functions.invoke("recordVenueSpending", {
        locationId: location?.id,
        locationName: location?.name,
        amount: cost,
        description: msg.item_label || "Scene purchase",
        ownerEmail: currentUser?.email,
      }).catch(() => {});
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, purchased: true } : m
      ));
    }
  };

  const handleReject = () => {
    setStatus("rejected");
    // Fade the card — no transaction, no save
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, rejected: true } : m
    ));
  };

  const handleAskAnother = () => {
    // Remove this card and post a user message to re-trigger generation
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    setMessages(prev => [...prev, {
      id: `regen_${Date.now()}`,
      sender: "user",
      content: `Show me a different ${msg.item_label || "option"}.`,
      timestamp: new Date().toISOString(),
    }]);
  };

  // Rejected — visually faded, no interaction
  if (msg.rejected || status === "rejected") {
    return (
      <div className="flex flex-col items-center gap-1 p-2 rounded-2xl bg-card border border-border/30 max-w-[220px] opacity-40">
        <p className="text-xs text-muted-foreground line-through">{msg.item_label || "Item"}</p>
        <p className="text-[10px] text-muted-foreground">Rejected</p>
      </div>
    );
  }

  // Purchased state (consumable accepted)
  if (msg.purchased || status === "accepted" && msg.purchase_type !== "clothing") {
    return (
      <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-card border-2 border-green-500/40 max-w-[220px] opacity-70">
        {itemImageUrl && (
          <div className="w-28 h-28 rounded-xl overflow-hidden">
            <img src={itemImageUrl} alt={msg.item_label} className="w-full h-full object-cover" />
          </div>
        )}
        <p className="text-xs font-semibold text-foreground">{msg.item_label || "Item"}</p>
        <p className="text-sm font-bold text-green-400">✓ Purchased · ${msg.price}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 p-3 rounded-2xl bg-card border-2 border-primary/40 max-w-[220px] shadow-lg">
      {/* Item image */}
      <div className="w-32 h-32 rounded-xl bg-secondary flex items-center justify-center overflow-hidden relative">
        {isLoadingImage ? (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-[10px]">Loading...</span>
          </div>
        ) : itemImageUrl ? (
          <img src={itemImageUrl} alt={msg.item_label || "Product"} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ShoppingBag className="w-8 h-8" />
            <span className="text-[10px]">{msg.item_label || "Item"}</span>
          </div>
        )}
      </div>

      {/* Item info */}
      <div className="text-center">
        <p className="text-xs font-semibold text-foreground leading-tight">{msg.item_label || "Item"}</p>
        <p className="text-sm font-bold text-primary mt-0.5">${msg.price}</p>
        {msg.locationName && (
          <p className="text-[10px] text-muted-foreground">{msg.locationName}</p>
        )}
      </div>

      {/* Review actions */}
      <div className="flex gap-2 w-full">
        <button
          onClick={handleReject}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all"
        >
          <X className="w-3 h-3" /> Pass
        </button>
        <button
          onClick={handleAccept}
          disabled={isLoadingImage}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <Check className="w-3 h-3" /> {msg.purchase_type === "clothing" ? "Buy" : "Order"}
        </button>
      </div>

      {/* Ask for another */}
      <button
        onClick={handleAskAnother}
        className="w-full text-[10px] text-primary/70 hover:text-primary underline transition-colors"
      >
        Show me another {msg.item_label ? msg.item_label.split(" ").slice(-1)[0] : "option"}
      </button>
    </div>
  );
}