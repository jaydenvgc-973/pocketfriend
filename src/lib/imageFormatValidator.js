/**
 * Image Format Validator
 * 
 * Detects unsupported image formats (AVIF, HEIC) in location/zone image arrays.
 * Provides diagnostics and recovery paths without silently skipping images.
 */

export const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp'];
export const UNSUPPORTED_FORMATS = ['image/avif', 'image/heic', 'image/heif'];

// Check if a URL is likely an unsupported format based on file extension
export function detectUnsupportedFormat(url) {
  if (!url || typeof url !== 'string') return null;

  const lower = url.toLowerCase();
  const ext = lower.split('.').pop()?.split('?')[0];

  if (ext === 'avif') return 'avif';
  if (ext === 'heic' || ext === 'heif') return 'heic';
  return null;
}

// Separate supported and unsupported images from a zone/location
export function categorizeImages(imageUrls = []) {
  const supported = [];
  const unsupported = [];

  imageUrls.forEach(url => {
    const format = detectUnsupportedFormat(url);
    if (format) {
      unsupported.push({ url, format });
    } else {
      supported.push(url);
    }
  });

  return { supported, unsupported };
}

// Generate a user-friendly diagnostic for unsupported images
export function getUnsupportedImagesDiagnostic(unsupported) {
  if (!unsupported || unsupported.length === 0) return null;

  const byFormat = {};
  unsupported.forEach(img => {
    byFormat[img.format] = (byFormat[img.format] || 0) + 1;
  });

  const formatList = Object.entries(byFormat)
    .map(([fmt, count]) => `${count}x ${fmt.toUpperCase()}`)
    .join(', ');

  return {
    hasUnsupported: true,
    message: `This location has ${unsupported.length} image(s) in unsupported format(s): ${formatList}`,
    details: 'These images cannot be used for generation. Replace them with JPEG or PNG photos.',
    action: 'admin_can_re_upload_or_swap',
  };
}

// Validate that a zone/location has at least one usable image
export function validateZoneImages(zone) {
  if (!zone || !zone.image_urls) return { valid: true, warnings: [] };

  const { supported, unsupported } = categorizeImages(zone.image_urls);

  const warnings = [];
  if (unsupported.length > 0) {
    warnings.push({
      type: 'unsupported_format',
      message: getUnsupportedImagesDiagnostic(unsupported).message,
      unsupported,
    });
  }

  return {
    valid: supported.length > 0,
    warnings,
    supported,
    unsupported,
    diagnostic: unsupported.length > 0 ? getUnsupportedImagesDiagnostic(unsupported) : null,
  };
}