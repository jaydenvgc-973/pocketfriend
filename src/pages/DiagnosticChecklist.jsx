import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, Circle, AlertCircle, Loader2, Copy } from 'lucide-react';

export default function DiagnosticChecklist() {
  const [checks, setChecks] = useState({
    character_data_fetched: false,
    reference_images_analyzed: false,
    location_structure_analyzed: false,
    zone_images_checked: false,
    avif_detection_completed: false,
    identity_vs_location_compared: false,
    behavior_flags_examined: false,
    message_history_reviewed: false,
  });

  const [findings, setFindings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [testChar, setTestChar] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    runDiagnostic();
  }, []);

  const runDiagnostic = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('listAllCharacters', {});
      const character = res.data.characters[0];
      setTestChar(character);

      // Mark checks as completed as we analyze
      const newChecks = { ...checks };
      
      // Check 1: Character data
      console.log(`[CHECK 1] Fetching character: ${character.name}`);
      newChecks.character_data_fetched = true;
      setChecks(newChecks);

      // Get full character record
      const charResult = await base44.entities.Character.filter({ id: character.id }, null, 1);
      const fullChar = charResult[0];

      // Check 2: Reference images
      console.log(`[CHECK 2] Reference images: ${(fullChar.reference_image_urls || []).length}`);
      newChecks.reference_images_analyzed = true;
      setChecks(newChecks);

      // Check 3: Location assignment
      console.log(`[CHECK 3] Home location: ${fullChar.current_home_location_id || fullChar.home_location_id || 'NONE'}`);
      newChecks.location_structure_analyzed = true;
      setChecks(newChecks);

      // Check 4: Zone images
      const homeLocId = fullChar.current_home_location_id || fullChar.home_location_id;
      let zoneImageCount = 0;
      let avifCount = 0;
      
      if (homeLocId) {
        const locResult = await base44.entities.LocationReference.filter({ id: homeLocId }, null, 1);
        const location = locResult[0];
        if (location && location.zones) {
          zoneImageCount = location.zones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);
          avifCount = location.zones.reduce((sum, z) => 
            sum + (z.image_urls || []).filter(u => u.includes('avif')).length, 0
          );
        }
      }

      console.log(`[CHECK 4] Zone images: ${zoneImageCount}`);
      newChecks.zone_images_checked = true;
      setChecks(newChecks);

      // Check 5: AVIF detection
      console.log(`[CHECK 5] AVIF format files: ${avifCount}`);
      newChecks.avif_detection_completed = true;
      setChecks(newChecks);

      // Check 6: Compare identity vs location
      console.log(`[CHECK 6] Identity refs: ${(fullChar.reference_image_urls || []).length} vs Location images: ${zoneImageCount}`);
      newChecks.identity_vs_location_compared = true;
      setChecks(newChecks);

      // Check 7: Behavior flags
      const behaviorFlags = {
        is_photogenic: fullChar.is_photogenic,
        is_protected: fullChar.is_protected,
        is_test_character: fullChar.is_test_character,
      };
      console.log(`[CHECK 7] Behavior flags:`, behaviorFlags);
      newChecks.behavior_flags_examined = true;
      setChecks(newChecks);

      // Check 8: Message history
      const messages = await base44.entities.Message.filter({
        character_id: character.id,
        image_url: { $exists: true }
      }, '-created_date', 10);
      console.log(`[CHECK 8] Image messages: ${messages.length}`);
      newChecks.message_history_reviewed = true;
      setChecks(newChecks);

      // Compile findings
      setFindings({
        character_name: character.name,
        character_id: character.id,
        reference_images_count: (fullChar.reference_image_urls || []).length,
        location_assigned: !!homeLocId,
        zone_image_count: zoneImageCount,
        avif_format_images: avifCount,
        behavior_flags: behaviorFlags,
        recent_image_messages: messages.length,
        generated_images_in_refs: (fullChar.reference_image_urls || []).filter(u => u.includes('generated')).length,
      });

    } catch (error) {
      console.error('Diagnostic error:', error);
    }
    setLoading(false);
  };

  const CheckItem = ({ checked, label, detail }) => (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
      <div className="mt-0.5">
        {checked ? (
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        ) : (
          <Circle className="w-5 h-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1">
        <p className="font-medium text-sm">{label}</p>
        {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
      </div>
    </div>
  );

  const FindingItem = ({ label, value, isWarning = false }) => (
    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border">
      <span className={`text-sm ${isWarning ? 'text-amber-500 font-semibold' : 'text-muted-foreground'}`}>
        {isWarning && <AlertCircle className="inline w-4 h-4 mr-2" />}
        {label}
      </span>
      <span className="font-mono text-sm text-foreground">
        {typeof value === 'object' ? JSON.stringify(value) : value}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Image Generation Diagnostic</h1>
          <p className="text-sm text-muted-foreground">
            Deep analysis of {testChar?.name || 'character'}'s image generation pipeline
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {!loading && (
          <>
            {/* INVESTIGATION CHECKLIST */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Investigation Checklist</h2>
              <div className="space-y-2">
                <CheckItem checked={checks.character_data_fetched} label="✓ Character Data Fetched" detail={`Loaded ${testChar?.name}'s complete record from database`} />
                <CheckItem checked={checks.reference_images_analyzed} label="✓ Reference Images Analyzed" detail={`Found ${findings?.reference_images_count || 0} reference_image_urls in database`} />
                <CheckItem checked={checks.location_structure_analyzed} label="✓ Location Assignment Analyzed" detail={`Home location: ${findings?.location_assigned ? '✓ Assigned' : '✗ None'}`} />
                <CheckItem checked={checks.zone_images_checked} label="✓ Zone Images Checked" detail={`Counted ${findings?.zone_image_count || 0} total images across all zones`} />
                <CheckItem checked={checks.avif_detection_completed} label="✓ AVIF Format Detection" detail={`Found ${findings?.avif_format_images || 0} AVIF/HEIC format zone images`} />
                <CheckItem checked={checks.identity_vs_location_compared} label="✓ Identity vs Location Compared" detail={`Identity: ${findings?.reference_images_count || 0} | Location: ${findings?.zone_image_count || 0}`} />
                <CheckItem checked={checks.behavior_flags_examined} label="✓ Behavior Flags Examined" detail={`is_photogenic: ${findings?.behavior_flags?.is_photogenic ? 'YES' : 'NO'} | is_protected: ${findings?.behavior_flags?.is_protected ? 'YES' : 'NO'}`} />
                <CheckItem checked={checks.message_history_reviewed} label="✓ Message History Reviewed" detail={`${findings?.recent_image_messages || 0} recent image generation messages found`} />
              </div>
            </div>

            {/* FINDINGS */}
            {findings && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">Diagnostic Findings</h2>
                <div className="space-y-2">
                  <FindingItem label="Character Name" value={findings.character_name} />
                  <FindingItem label="Character ID" value={findings.character_id} />
                  <FindingItem label="Reference Images (identity)" value={findings.reference_images_count} />
                  <FindingItem label="Generated Images in References" value={findings.generated_images_in_refs} isWarning={findings.generated_images_in_refs > 0} />
                  <FindingItem label="Home Location Assigned" value={findings.location_assigned ? 'YES' : 'NO'} />
                  <FindingItem label="Zone Images (location)" value={findings.zone_image_count} />
                  <FindingItem label="AVIF Format Zone Images (AI incompatible)" value={findings.avif_format_images} isWarning={findings.avif_format_images > 0} />
                  <FindingItem label="Recent Image Messages" value={findings.recent_image_messages} />
                </div>
              </div>
            )}

            {/* INSIGHTS */}
            {findings && (
              <div className="space-y-3 p-4 rounded-lg bg-primary/10 border border-primary/20">
                <h3 className="font-semibold text-foreground">Key Insights</h3>
                <ul className="space-y-2 text-sm text-foreground">
                  {findings.reference_images_count === 0 && (
                    <li className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
                      <span><strong>No identity reference images:</strong> Character avatar is used by default, but avatar backgrounds contaminate scene generation</span>
                    </li>
                  )}
                  {findings.generated_images_in_refs > 0 && (
                    <li className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
                      <span><strong>Generated images in references:</strong> AI copies pose/background/props from these generated images instead of creating new scenes</span>
                    </li>
                  )}
                  {findings.avif_format_images > 0 && (
                    <li className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
                      <span><strong>AVIF format zone images:</strong> AI generation model cannot read AVIF files (Apple iPhone format). Falls back to avatar when zone refs fail</span>
                    </li>
                  )}
                  {findings.zone_image_count === 0 && findings.location_assigned && (
                    <li className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
                      <span><strong>No zone images:</strong> Location assigned but no images in zones. AI has no environment reference, invents background (often copies from avatar)</span>
                    </li>
                  )}
                  {findings.reference_images_count > 0 && findings.zone_image_count > 0 && (
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500 flex-shrink-0" />
                      <span><strong>Properly configured:</strong> Both identity and location references present. Image generation should work correctly</span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* ACTION BUTTON */}
            <button
              onClick={runDiagnostic}
              disabled={loading}
              className="w-full py-2 px-4 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Re-run Diagnostic
            </button>
          </>
        )}
      </div>
    </div>
  );
}