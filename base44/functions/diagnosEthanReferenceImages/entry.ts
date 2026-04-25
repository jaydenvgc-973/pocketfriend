/**
 * diagnosEthanReferenceImages
 * Tests every reference image URL for Ethan and reports which ones are reachable.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Skip auth — admin diagnostic only, hardcoded character ID

    // Use the known reference URLs directly from the DB read (already confirmed above)
    const char = {
      reference_image_urls: [
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/28a1a049a_1000025500.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/455dcc670_1000024943.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/c8ec2d02d_1000024937.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/c584a24c6_1000024941.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/17856ce7f_1000024942.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/3eec82252_1000024642.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/8b49c3dd7_1000024302.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/a7d016f83_1000024089.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/a4ab6c413_1000024085.png",
        "https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/2e9f04be3_1000024005.png"
      ]
    };

    const rawUrls = char.reference_image_urls || [];
    console.log(`[diag] Total reference_image_urls: ${rawUrls.length}`);

    const results = await Promise.all(rawUrls.map(async (rawUrl, i) => {
      const cdnUrl = toPublicCDN(rawUrl);
      let status = null;
      let reachable = false;
      try {
        const r = await fetch(cdnUrl, { method: 'HEAD' });
        status = r.status;
        reachable = r.ok;
      } catch (e) {
        status = `ERROR: ${e.message}`;
      }
      console.log(`[diag] [${i}] ${reachable ? '✅' : '❌'} ${status} | ${cdnUrl}`);
      return { index: i, raw: rawUrl, cdn: cdnUrl, status, reachable };
    }));

    const reachable = results.filter(r => r.reachable);
    const broken = results.filter(r => !r.reachable);

    return Response.json({
      total: rawUrls.length,
      reachableCount: reachable.length,
      brokenCount: broken.length,
      reachable: reachable.map(r => ({ index: r.index, cdn: r.cdn, status: r.status })),
      broken: broken.map(r => ({ index: r.index, cdn: r.cdn, status: r.status })),
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});