import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * checkLocationMatches
 * 
 * After a new location is created, check if any characters have text-based
 * occupation or education entries that likely match the new location name.
 * Returns match suggestions for approval pop-ups — never auto-links.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { locationId, locationName, locationCategory } = await req.json();
    if (!locationId || !locationName) return Response.json({ error: 'locationId and locationName required' }, { status: 400 });

    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    const normalizedLocName = locationName.toLowerCase().trim();
    const matches = [];

    for (const char of allChars) {
      // Check occupation text fields
      const jobTitle = (char.work_details?.job_title || '').toLowerCase();
      const workEnv = (char.work_details?.work_environment || '').toLowerCase();
      const workplaceType = (char.work_details?.workplace_type || '').toLowerCase();

      // Check if already linked to this location as a worker
      const alreadyWorker = false; // Don't check LocationReference here — frontend does that

      // Education fields
      const institution = (char.education_details?.institution || '').toLowerCase();
      const courseName = (char.education_details?.course_name || '').toLowerCase();
      const eduLocation = (char.education_details?.location || '').toLowerCase();

      // Training fields
      const trainingCompany = (char.job_training_details?.company || '').toLowerCase();

      // Simple substring match with normalized strings
      const nameWords = normalizedLocName.split(/\s+/).filter(w => w.length > 3);

      const occupationScore = nameWords.filter(w =>
        jobTitle.includes(w) || workEnv.includes(w) || workplaceType.includes(w)
      ).length;

      const educationScore = nameWords.filter(w =>
        institution.includes(w) || courseName.includes(w) || eduLocation.includes(w) || trainingCompany.includes(w)
      ).length;

      // Also check if location name contains job/institution name
      const jobMatch = jobTitle && normalizedLocName.includes(jobTitle.substring(0, Math.max(4, jobTitle.length - 2)));
      const instMatch = institution && normalizedLocName.includes(institution.substring(0, Math.max(4, institution.length - 2)));
      const instReverseMatch = institution && institution.includes(normalizedLocName.substring(0, Math.max(4, normalizedLocName.length - 2)));

      const OCCUPATION_CATEGORIES = ['workplace', 'business', 'food_drink', 'gym', 'medical', 'education', 'social', 'grocery', 'religion', 'school', 'government'];
      const EDUCATION_CATEGORIES = ['education', 'school'];

      let matchType = null;
      let confidence = 0;

      if (OCCUPATION_CATEGORIES.includes(locationCategory) && (occupationScore >= 1 || jobMatch)) {
        matchType = 'occupation';
        confidence = jobMatch ? 0.8 : Math.min(0.9, 0.4 + occupationScore * 0.2);
      }

      if (EDUCATION_CATEGORIES.includes(locationCategory) && (educationScore >= 1 || instMatch || instReverseMatch)) {
        const eduConfidence = (instMatch || instReverseMatch) ? 0.85 : Math.min(0.9, 0.4 + educationScore * 0.2);
        if (eduConfidence > confidence) {
          matchType = 'education';
          confidence = eduConfidence;
        }
      }

      if (matchType && confidence >= 0.5) {
        matches.push({
          characterId: char.id,
          characterName: char.name,
          matchType,
          confidence: Math.round(confidence * 100),
          currentText: matchType === 'occupation'
            ? (char.work_details?.job_title || char.work_details?.workplace_type || 'occupation on file')
            : (char.education_details?.institution || char.education_details?.course_name || 'education on file'),
          avatarUrl: char.avatar_url || null,
        });
      }
    }

    // Sort by confidence desc, limit to top 5
    matches.sort((a, b) => b.confidence - a.confidence);

    return Response.json({ success: true, matches: matches.slice(0, 5) });
  } catch (error) {
    console.error('[checkLocationMatches]', error);
    return Response.json({ success: false, error: error.message, matches: [] }, { status: 500 });
  }
});