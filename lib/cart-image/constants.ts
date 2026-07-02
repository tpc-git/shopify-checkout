/** Final PNG width (mobile-friendly for MMS). */
export const CART_IMAGE_OUTPUT_WIDTH = 640;

/** Supersample factor: render layout at OUTPUT_WIDTH × SCALE, then downscale for sharp text/images. */
export const CART_IMAGE_RENDER_SCALE = 2;

/** Shopify featured image fetch size (2× thumb for retina). */
export const CART_IMAGE_THUMB_PX = 56;
export const CART_IMAGE_SHOPIFY_IMAGE_WIDTH = CART_IMAGE_THUMB_PX * CART_IMAGE_RENDER_SCALE * 2;
