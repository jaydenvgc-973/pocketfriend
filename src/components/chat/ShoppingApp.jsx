import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShoppingBag, DollarSign } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SAMPLE_PRODUCTS = [
  { id: "p1", category: "clothes", type: "hoodie", name: "Essential Hoodie", brand: "Basic", price: 65, color: "Black", image: "🖤" },
  { id: "p2", category: "clothes", type: "hoodie", name: "Oversized Hoodie", brand: "Comfort", price: 75, color: "Gray", image: "🩶" },
  { id: "p3", category: "clothes", type: "shirt", name: "Classic Tee", brand: "Basic", price: 25, color: "White", image: "⚪" },
  { id: "p4", category: "clothes", type: "jacket", name: "Denim Jacket", brand: "Classic", price: 95, color: "Blue", image: "🔵" },
  { id: "p5", category: "sneakers", type: "sneakers", name: "High Tops", brand: "Street", price: 120, color: "Black", image: "👟" },
  { id: "p6", category: "sneakers", type: "sneakers", name: "Minimalist Sneakers", brand: "Clean", price: 100, color: "White", image: "⚪" },
  { id: "p7", category: "accessories", type: "hat", name: "Baseball Cap", brand: "Basic", price: 30, color: "Black", image: "⚫" },
  { id: "p8", category: "accessories", type: "bag", name: "Canvas Backpack", brand: "Carry", price: 85, color: "Khaki", image: "🎒" },
];

export default function ShoppingApp({ conversationId, characterId, character, onClose, currentUser }) {
  const [category, setCategory] = useState("clothes");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [actionMode, setActionMode] = useState(null); // null | "buy_self" | "forward" | "ask_character"
  const queryClient = useQueryClient();

  const { data: userBalance = 0 } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: async () => {
      const settings = await base44.entities.UserSettings.filter({ created_by: currentUser?.email });
      return settings[0]?.user_balance || 0;
    },
    enabled: !!currentUser?.email,
  });

  const products = SAMPLE_PRODUCTS.filter(p => p.category === category);

  const handleBuyForSelf = async (product) => {
    if (userBalance < product.price) {
      alert("Insufficient funds");
      return;
    }

    try {
      await base44.functions.invoke("processShoppingPurchase", {
        payer: { type: "user", name: currentUser.full_name },
        recipient: { type: "user", name: currentUser.full_name },
        product,
      });
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      alert(`Purchased ${product.name}!`);
      setSelectedProduct(null);
    } catch (err) {
      alert("Purchase failed: " + err.message);
    }
  };

  const handleForwardToCharacter = async (product) => {
    if (!characterId || !conversationId) return;

    try {
      const message = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "user",
        content: `What do you think of this? ${product.name} ($${product.price})`,
        timestamp: new Date().toISOString(),
      });

      await base44.entities.Character.update(characterId, {
        _forwarded_product: { ...product, forwarded_at: new Date().toISOString() },
      });

      alert(`Forwarded ${product.name} to ${character.name}`);
      setSelectedProduct(null);
      onClose();
    } catch (err) {
      alert("Forward failed: " + err.message);
    }
  };

  const handleAskCharacterToBuy = async (product) => {
    if (!characterId || !conversationId) return;

    try {
      await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "user",
        content: `Would you buy this for me? ${product.name} ($${product.price})`,
        timestamp: new Date().toISOString(),
      });

      alert(`Asked ${character.name} to buy ${product.name}`);
      setSelectedProduct(null);
      onClose();
    } catch (err) {
      alert("Request failed: " + err.message);
    }
  };

  if (selectedProduct) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-card border border-border rounded-3xl shadow-2xl p-6"
      >
        <button
          onClick={() => setSelectedProduct(null)}
          className="absolute top-4 right-4 p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-5xl text-center mb-4">{selectedProduct.image}</div>
        <h3 className="text-lg font-semibold text-foreground text-center">{selectedProduct.name}</h3>
        <p className="text-xs text-muted-foreground text-center mb-2">{selectedProduct.brand} • {selectedProduct.color}</p>
        <p className="text-2xl font-bold text-primary text-center mb-6">${selectedProduct.price}</p>

        <div className="space-y-2.5">
          <button
            onClick={() => handleBuyForSelf(selectedProduct)}
            disabled={userBalance < selectedProduct.price}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
          >
            Buy for Yourself
          </button>

          {character && (
            <>
              <button
                onClick={() => handleForwardToCharacter(selectedProduct)}
                className="w-full py-2.5 rounded-lg bg-secondary text-foreground font-medium hover:bg-secondary/80"
              >
                Show to {character.name}
              </button>
              <button
                onClick={() => handleAskCharacterToBuy(selectedProduct)}
                className="w-full py-2.5 rounded-lg bg-secondary text-foreground font-medium hover:bg-secondary/80"
              >
                Ask Them to Buy It
              </button>
            </>
          )}

          <button
            onClick={() => setSelectedProduct(null)}
            className="w-full py-2.5 rounded-lg border border-border text-foreground font-medium"
          >
            Close
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-card border border-border rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Shopping</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {["clothes", "sneakers", "accessories"].map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium capitalize transition-colors ${
              category === cat
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AnimatePresence>
          {products.map(product => (
            <motion.button
              key={product.id}
              onClick={() => setSelectedProduct(product)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-2xl bg-secondary hover:bg-secondary/80 transition-colors text-center"
            >
              <div className="text-4xl mb-2">{product.image}</div>
              <p className="text-xs font-medium text-foreground truncate">{product.name}</p>
              <p className="text-xs text-primary font-semibold mt-1">${product.price}</p>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}