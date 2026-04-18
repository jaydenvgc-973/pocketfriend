import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const styleMap = {
  clothes: "product_clean",
  sneakers: "shoe_product_shot",
  accessories: "accessory_product_shot"
};

const styleDescriptions = {
  product_clean: "clean product shot on neutral white background, professional product photography, well-lit, clear and readable",
  hanger_display: "item on a hanger or stand, product display style, neutral background, professional retail presentation",
  mannequin_display: "item on a mannequin or dress form, fashion display style, neutral background, professional presentation",
  shoe_product_shot: "pair of shoes angled product shot on neutral background, shoe showcase, professional retail photography, clear sole and profile visible",
  accessory_product_shot: "close-up accessory product shot, clean presentation, neutral background, detail visible, professional product photography"
};

const categoryDefaults = {
  clothes: ["product_clean", "hanger_display", "mannequin_display"],
  sneakers: ["shoe_product_shot"],
  accessories: ["accessory_product_shot"]
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { productId, category, itemType, name, color, brand, forceStyle } = await req.json();

    if (!productId) {
      return Response.json({ error: 'Missing productId' }, { status: 400 });
    }

    // Fetch the product
    const products = await base44.entities.ShoppingProduct.filter({ id: productId });
    const product = products[0];
    if (!product) {
      return Response.json({ error: 'Product not found' }, { status: 404 });
    }

    // Determine style
    const availableStyles = categoryDefaults[product.category] || ["product_clean"];
    const style = forceStyle && availableStyles.includes(forceStyle) ? forceStyle : availableStyles[0];
    const styleDesc = styleDescriptions[style];

    // Build generation prompt
    const colorDesc = product.color ? `${product.color} ` : '';
    const brandDesc = product.brand ? `by ${product.brand} ` : '';
    const prompt = `AI-generated product image: ${colorDesc}${product.item_type} ${brandDesc}for an online shopping app. ${styleDesc}. The item must be clearly visible and readable. Suitable for shopping decision-making. Professional retail product photography.`;

    // Generate image
    const imageRes = await base44.integrations.Core.GenerateImage({
      prompt
    });

    const imageUrl = imageRes?.url;
    if (!imageUrl) {
      throw new Error('Image generation returned no URL');
    }

    // Update product with generated image
    await base44.entities.ShoppingProduct.update(productId, {
      image_url: imageUrl,
      image_status: "generated",
      image_generation_prompt: prompt,
      image_generation_style: style,
      visual_identity_seed: `${product.category}_${product.item_type}_${product.color || 'default'}_${Date.now()}`
    });

    return Response.json({
      success: true,
      image_url: imageUrl,
      image_status: "generated",
      style: style
    });
  } catch (error) {
    console.error('[generateProductImage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});