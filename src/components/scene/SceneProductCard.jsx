import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { RefreshCw, Check, X, ShoppingBag, Shirt } from "lucide-react";
import { pickMerchandise } from "@/lib/venueMerchandise.js";

/**
 * SceneProductCard — venue-aware product card with:
 * 1. Item-specific AI-generated image (never scene/venue photo)
 * 2. Pass / Buy / Try On — trying on is free, buying goes through the purchase flow
 * 3. Show me something else — another item from the same shopping category
 * 4. Clothing → ProductPurchaseModal for closet save
 * 5. Consumable → direct deduction only after explicit Accept
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
  // Try On runs through the existing top-Scenes image pathway, choosing WHO tries it on
  // from the people actually in this scene. It never charges and never touches a closet.
  onTryOn,
}) {
  // The image this card generated is kept on the message itself, so a re-render or a
  // remount reuses the exact image the user saw instead of generating a different one.
  const [itemImageUrl, setItemImageUrl] = useState(msg.item_image_url || null);
  const [isLoadingImage, setIsLoadingImage] = useState(!msg.item_image_url);
  const [status, setStatus] = useState("pending"); // pending | accepted | rejected

  // Build a focused product image prompt — item-specific, never scene/venue background.
  // item_category is the authoritative type set by the action and venue context.
  const buildItemPrompt = () => {
    const itemLabel = msg.item_label || "product";
    const category = msg.item_category;

    switch (category) {
      case "drink": {
        // Serve the item in the drinkware and setting its own name implies —
        // coffee in a mug, a shake in a tall glass, a cocktail in bar glassware.
        const l = itemLabel.toLowerCase();
        if (/coffee|espresso|latte|cappuccino|mocha|americano|macchiato|tea|chai|matcha|cocoa|hot chocolate/.test(l)) {
          return `Professional café beverage photography of a ${itemLabel}, served hot in a ceramic mug or cup on a café counter, close-up, clean background, high detail, no alcohol, not a cocktail, no food items`;
        }
        if (/milkshake|smoothie|juice|soda|cola|lemonade|water|iced/.test(l)) {
          return `Professional beverage photography of a ${itemLabel}, served in a tall glass with a straw, close-up, clean background, high detail, no alcohol, no food items`;
        }
        return `Professional bar photography of a ${itemLabel}, beautifully presented in a glass on a bar surface, close-up, clean background, high detail, no food items`;
      }
      case "food": {
        const f = itemLabel.toLowerCase();
        if (/buffet/.test(f)) {
          // Buffet format: one loaded plate from the spread, not a single à la carte dish.
          return `Professional food photography of a loaded buffet plate — rice, vegetables, crab legs, pizza, seafood, grilled chicken and pasta — warm buffet counter lighting, close-up, high detail, no drinks`;
        }
        if (msg.is_free) {
          return `Professional food photography of ${itemLabel}, served generously in a simple bowl or on a tray at a community meal service, warm natural light, close-up, high detail, no drinks`;
        }
        return `Professional food photography of ${itemLabel}, beautifully plated on a dish, restaurant quality, close-up, clean light background, high detail, no drinks`;
      }
      case "clothing":
        // A complete outfit is photographed as a whole look; a single item on its own.
        if (msg.item_kind === "outfit") {
          return `Professional retail flat-lay photography of a complete ${itemLabel} outfit — every piece of the look laid out together on a clean light background, studio lighting, high detail, no people wearing it`;
        }
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
    // Already generated for this card: keep it, never generate a second one.
    if (msg.item_image_url) {
      setItemImageUrl(msg.item_image_url);
      setIsLoadingImage(false);
      return;
    }
    let cancelled = false;
    setIsLoadingImage(true);
    base44.integrations.Core.GenerateImage({ prompt: buildItemPrompt() })
      .then(r => {
        if (cancelled) return;
        setItemImageUrl(r.url);
        // Stored on the message so the purchased entry carries this exact image.
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, item_image_url: r.url } : m));
      })
      .catch(() => { if (!cancelled) setItemImageUrl(null); })
      .finally(() => { if (!cancelled) setIsLoadingImage(false); });
    return () => { cancelled = true; };
  }, [msg.id]); // only once per card

  // Wearable store merchandise can be tried on. Food, drink and non-wearable goods cannot.
  const canTryOn = msg.purchase_type === "purchase"
    && msg.item_category === "clothing"
    && msg.item_wearable !== false;

  const handleAccept = () => {
    if (status !== "pending") return;
    setStatus("accepted");

    if (msg.purchase_type === "clothing" || msg.purchase_type === "purchase") {
      // Clothing/durable goods → ProductPurchaseModal (handles closet save + transaction authority)
      setPendingPurchase({
        price: msg.price,
        productId: msg.id,
        preview_image_url: itemImageUrl,
        item_label: msg.item_label,
        item_category: msg.item_category,
        item_wearable: msg.item_wearable,
        action_id: msg.id,
        purchase_type: msg.purchase_type,
        action_class: msg.action_class || 'purchase',
        purchase_source: msg.purchase_source || 'menu',
        item_kind: msg.item_kind || 'item',
      });
    } else {
      // Consumable — route through transaction authority.
      // RULE: No direct UserSettings.update here. Balance changes must pass through executeSceneTransaction.
      const cost = msg.price;
      if (cost > 0) {
        base44.functions.invoke('executeSceneTransaction', {
          action_class: 'purchase',
          is_paid: true,
          cost,
          payer_type: 'user',
          action_id: msg.id,
          purchase_source: msg.purchase_source || 'menu',
          action_label: msg.item_label,
          location_name: msg.locationName,
        }).then(() => {
          queryClient.invalidateQueries({ queryKey: ['userSettings'] });
        }).catch(() => {});
      }
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
    // Another offer from the SAME shopping category this card came from — never unrelated
    // merchandise, never a charge. The offer is made from the store's own merchandise.
    const families = msg.item_merchandise_families
      || (msg.item_merchandise ? [msg.item_merchandise] : null);
    const next = families ? pickMerchandise(families) : null;
    if (next) {
      setMessages(prev => [
        ...prev.filter(m => m.id !== msg.id),
        {
          ...msg,
          id: `product_${Date.now()}`,
          item_image_url: null,
          item_label: next.label,
          item_category: next.category,
          item_wearable: next.wearable !== false,
          item_merchandise: next.family,
          item_merchandise_families: families,
          tried_on: false,
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }
    // No known merchandise family: keep the established behaviour.
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    setMessages(prev => [...prev, {
      id: `regen_${Date.now()}`,
      sender: "user",
      content: `Show me a different ${msg.item_label ? msg.item_label.toLowerCase() : "option"}.`,
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
        <p className="text-sm font-bold text-green-400">{msg.is_free ? "✓ Received · Free" : `✓ Purchased · $${msg.price}`}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 p-3 rounded-2xl bg-card border-2 border-primary/40 max-w-[220px] shadow-lg">
      {/* Item image — the authoritative reference for this merchandise */}
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
        <p className="text-sm font-bold text-primary mt-0.5">{msg.is_free ? "Free" : `$${msg.price}`}</p>
        {msg.locationName && (
          <p className="text-[10px] text-muted-foreground">{msg.locationName}</p>
        )}
      </div>

      {/* Review actions — Pass, Buy, and (for wearables) Try On */}
      <div className="flex gap-1.5 w-full">
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
          <Check className="w-3 h-3" /> {msg.purchase_type === "clothing" || msg.purchase_type === "purchase" ? "Buy" : (msg.is_free ? "Take" : "Order")}
        </button>
        {canTryOn && (
          <button
            onClick={() => onTryOn?.(msg, itemImageUrl)}
            disabled={isLoadingImage || !itemImageUrl}
            title="Try it on — no charge"
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-secondary border border-border text-xs text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Shirt className="w-3 h-3" /> Try On
          </button>
        )}
      </div>

      {/* Ask for another */}
      <button
        onClick={handleAskAnother}
        className="w-full text-[10px] text-primary/70 hover:text-primary underline transition-colors"
      >
        Show me something else
      </button>
    </div>
  );
}