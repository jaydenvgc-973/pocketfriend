import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShoppingBag, Loader, ChevronRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SAMPLE_PRODUCTS = [
  { category: "clothes", item_type: "hoodie", name: "Essential Hoodie", brand: "Basic", price: 65, color: "Black", image_url: null, image_status: "not_generated" },
  { category: "clothes", item_type: "hoodie", name: "Oversized Hoodie", brand: "Comfort", price: 75, color: "Gray", image_url: null, image_status: "not_generated" },
  { category: "clothes", item_type: "shirt", name: "Classic Tee", brand: "Basic", price: 25, color: "White", image_url: null, image_status: "not_generated" },
  { category: "clothes", item_type: "jacket", name: "Denim Jacket", brand: "Classic", price: 95, color: "Blue", image_url: null, image_status: "not_generated" },
  { category: "clothes", item_type: "sweater", name: "Wool Sweater", brand: "Cozy", price: 85, color: "Cream", image_url: null, image_status: "not_generated" },
  { category: "clothes", item_type: "shirt", name: "Linen Button Up", brand: "Summer", price: 55, color: "Light Blue", image_url: null, image_status: "not_generated" },
  { category: "clothes", item_type: "pants", name: "Black Jeans", brand: "Classic", price: 75, color: "Black", image_url: null, image_status: "not_generated" },
  { category: "clothes", item_type: "pants", name: "Khaki Chinos", brand: "Casual", price: 65, color: "Khaki", image_url: null, image_status: "not_generated" },
  { category: "sneakers", item_type: "sneakers", name: "High Tops", brand: "Street", price: 120, color: "Black", image_url: null, image_status: "not_generated" },
  { category: "sneakers", item_type: "sneakers", name: "Minimalist Sneakers", brand: "Clean", price: 100, color: "White", image_url: null, image_status: "not_generated" },
  { category: "sneakers", item_type: "sneakers", name: "Running Shoes", brand: "Athletic", price: 135, color: "Gray", image_url: null, image_status: "not_generated" },
  { category: "sneakers", item_type: "sneakers", name: "Retro Court Shoes", brand: "Vintage", price: 95, color: "Red", image_url: null, image_status: "not_generated" },
  { category: "accessories", item_type: "hat", name: "Baseball Cap", brand: "Basic", price: 30, color: "Black", image_url: null, image_status: "not_generated" },
  { category: "accessories", item_type: "bag", name: "Canvas Backpack", brand: "Carry", price: 85, color: "Khaki", image_url: null, image_status: "not_generated" },
  { category: "accessories", item_type: "bag", name: "Crossbody Bag", brand: "Urban", price: 75, color: "Black", image_url: null, image_status: "not_generated" },
  { category: "accessories", item_type: "hat", name: "Beanie", brand: "Cozy", price: 25, color: "Navy", image_url: null, image_status: "not_generated" },
];

export default function ShoppingApp({ conversationId, characterId, character, onClose, currentUser }) {
  const [category, setCategory] = useState("clothes");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [generatingImage, setGeneratingImage] = useState(null);
  const [showActionModal, setShowActionModal] = useState(null); // { type: 'buy'|'forward'|'ask', product }
  const queryClient = useQueryClient();

  // Initialize products on mount
  useEffect(() => {
    if (!currentUser?.email) return;
    
    const initProducts = async () => {
      const existing = await base44.entities.ShoppingProduct.filter({ created_by: currentUser.email });
      if (existing.length === 0) {
        await base44.entities.ShoppingProduct.bulkCreate(SAMPLE_PRODUCTS);
        queryClient.invalidateQueries({ queryKey: ["shoppingProducts"] });
      }
    };
    
    initProducts();
  }, [currentUser?.email, queryClient]);

  const { data: userBalance = 0 } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: async () => {
      const settings = await base44.entities.UserSettings.filter({ created_by: currentUser?.email });
      return settings[0]?.user_balance || 0;
    },
    enabled: !!currentUser?.email,
  });

  const { data: dbProducts = [] } = useQuery({
    queryKey: ["shoppingProducts", category],
    queryFn: async () => {
      const all = await base44.entities.ShoppingProduct.list();
      return all.filter(p => p.category === category);
    },
  });

  const products = dbProducts;

  const ensureProductImage = async (product) => {
    if (product.image_url) return product;
    
    setGeneratingImage(product.id);
    try {
      const res = await base44.functions.invoke("generateProductImage", {
        productId: product.id,
        category: product.category,
        itemType: product.item_type,
        name: product.name,
        color: product.color,
        brand: product.brand
      });

      console.log('[ensureProductImage] Response:', res);
      if (res?.data?.image_url) {
        const updated = { ...product, image_url: res.data.image_url, image_status: "generated" };
        setSelectedProduct(updated);
        return updated;
      } else {
        console.warn('[ensureProductImage] No image_url in response:', res?.data);
      }
      return product;
    } catch (err) {
      console.error('[ensureProductImage] Error:', err);
      return product;
    } finally {
      setGeneratingImage(null);
    }
  };

  const handleBuyForSelf = async (product) => {
    if (userBalance < product.price) {
      setShowActionModal({ type: 'error', message: `Insufficient funds. Need $${product.price}`, product });
      return;
    }

    try {
      await base44.functions.invoke("processShoppingPurchase", {
        payer: { type: "user", name: currentUser.full_name },
        recipient: { type: "user", name: currentUser.full_name },
        product,
      });


      
      // Add item to user closet
      const settings = await base44.entities.UserSettings.filter({ created_by: currentUser.email });
      const closet = settings[0]?.user_closet || [];
      const newItem = {
        piece_id: `piece_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "piece",
        created_at: new Date().toISOString(),
        label: product.name,
        piece_type: product.item_type,
        description: `${product.brand} • ${product.color}`,
        image_url: product.image_url,
        is_favorite: false,
      };
      
      await base44.entities.UserSettings.update(settings[0].id, {
        user_closet: [...closet, newItem],
        user_balance: settings[0].user_balance - product.price,
      });


      
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      setShowActionModal({ type: 'success', message: `Added ${product.name} to your closet!`, product });
      setSelectedProduct(null);
    } catch (err) {
      setShowActionModal({ type: 'error', message: "Purchase failed: " + err.message, product });
    }
  };

  const handleForwardToCharacter = async (product) => {
    if (!characterId || !conversationId) return;

    try {
      await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "user",
        content: `What do you think of this? ${product.name} ($${product.price})`,
        timestamp: new Date().toISOString(),
      });

      await base44.entities.Character.update(characterId, {
        _forwarded_product: { ...product, forwarded_at: new Date().toISOString() },
      });

      setShowActionModal({ type: 'success', message: `Showed ${product.name} to ${character.name}!`, product });
      setSelectedProduct(null);
    } catch (err) {
      setShowActionModal({ type: 'error', message: "Forward failed: " + err.message, product });
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

      setShowActionModal({ type: 'success', message: `Asked ${character.name} to buy it!`, product });
      setSelectedProduct(null);
    } catch (err) {
      setShowActionModal({ type: 'error', message: "Request failed: " + err.message, product });
    }
  };

  const handleBuyForCharacter = async (product) => {
    if (!characterId || userBalance < product.price) {
      if (userBalance < product.price) {
        setShowActionModal({ type: 'error', message: `Insufficient funds. Need $${product.price}`, product });
      }
      return;
    }

    try {
      // Deduct from user balance
      const settings = await base44.entities.UserSettings.filter({ created_by: currentUser.email });
      await base44.entities.UserSettings.update(settings[0].id, {
        user_balance: settings[0].user_balance - product.price,
      });

      // Add to character closet
      const charCloset = character.character_closet || [];
      const newItem = {
        outfit_id: `piece_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "piece",
        created_at: new Date().toISOString(),
        label: product.name,
        piece_type: product.item_type,
        description: `${product.brand} • ${product.color}`,
        image_url: product.image_url,
        is_favorite: false,
      };

      await base44.entities.Character.update(characterId, {
        character_closet: [...charCloset, newItem],
      });

      // Record transaction
      await base44.entities.FinancialTransaction.create({
        transaction_type: "gift",
        amount: product.price,
        direction: "out",
        category: "shopping",
        description: `Bought ${product.name} for ${character.name}`,
        character_id: characterId,
        timestamp: new Date().toISOString(),
      });

      queryClient.invalidateQueries({ queryKey: ["userSettings", "character", characterId] });
      setShowActionModal({ type: 'success', message: `Bought ${product.name} for ${character.name}!`, product });
      setSelectedProduct(null);
    } catch (err) {
      setShowActionModal({ type: 'error', message: "Purchase failed: " + err.message, product });
    }
  };

  if (selectedProduct) {
    return (
      <div className="border-t border-border pt-4 mt-4 space-y-3">
        <div className="w-full h-40 bg-secondary rounded-2xl flex items-center justify-center overflow-hidden">
          {selectedProduct.image_url ? (
            <img src={selectedProduct.image_url} alt={selectedProduct.name} className="w-full h-full object-cover" />
          ) : generatingImage === selectedProduct.id ? (
            <div className="flex flex-col items-center gap-2">
              <Loader className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Generating image...</p>
            </div>
          ) : (
            <button
              onClick={() => ensureProductImage(selectedProduct)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
            >
              Generate Image
            </button>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{selectedProduct.name}</h3>
          <p className="text-[10px] text-muted-foreground">{selectedProduct.brand} • {selectedProduct.color}</p>
          <p className="text-lg font-bold text-primary mt-1">${selectedProduct.price}</p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => handleBuyForSelf(selectedProduct)}
            disabled={userBalance < selectedProduct.price}
            className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-colors"
          >
            Add to Closet
          </button>

          {character && (
            <>
              <button
                onClick={() => handleBuyForCharacter(selectedProduct)}
                disabled={userBalance < selectedProduct.price}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-colors"
              >
                Buy for {character.name}
              </button>
              <button
                onClick={() => handleForwardToCharacter(selectedProduct)}
                className="w-full py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Show to {character.name}
              </button>
              <button
                onClick={() => handleAskCharacterToBuy(selectedProduct)}
                className="w-full py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Ask Them to Buy It
              </button>
            </>
          )}

          <button
            onClick={() => setSelectedProduct(null)}
            className="w-full py-2 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-secondary/50 transition-colors"
          >
            Back to Shopping
          </button>
        </div>

        {/* Inline action feedback modal */}
        <AnimatePresence>
          {showActionModal && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`p-3 rounded-lg text-sm font-medium text-center ${
                showActionModal.type === 'success'
                  ? 'bg-green-500/10 text-green-600 border border-green-500/30'
                  : 'bg-amber-500/10 text-amber-600 border border-amber-500/30'
              }`}
            >
              {showActionModal.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed top-20 inset-x-0 z-50 flex items-center justify-center"
    >
      <div className="w-72 bg-card border border-border rounded-3xl shadow-2xl p-6">
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

      <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
        <AnimatePresence>
          {products.map(product => (
            <motion.button
              key={product.id}
              onClick={() => {
                setSelectedProduct(product);
                if (!product.image_url) {
                  ensureProductImage(product);
                }
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-2 rounded-2xl bg-secondary hover:bg-secondary/80 transition-colors text-center overflow-hidden"
            >
              <div className="w-full h-24 bg-secondary-darker rounded-lg mb-2 flex items-center justify-center">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl">📦</span>
                )}
              </div>
              <p className="text-xs font-medium text-foreground truncate">{product.name}</p>
              <p className="text-xs text-primary font-semibold mt-1">${product.price}</p>
            </motion.button>
          ))}
        </AnimatePresence>
        </div>
        </div>
        </motion.div>
  );
}