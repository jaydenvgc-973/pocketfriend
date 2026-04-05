import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, ChevronDown, ChevronUp, Trash2, GitMerge, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

export default function DiagnosticReportViewer({ onMergeClick }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState({});

  const runDiagnostic = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("comprehensiveCharacterDiagnostic", {});
      setReport(response.data);
    } catch (err) {
      console.error("Diagnostic failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiagnostic();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground">Running diagnostic...</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-destructive mb-3">Diagnostic failed</p>
        <Button onClick={runDiagnostic} size="sm" variant="outline" className="rounded-lg">
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Try Again
        </Button>
      </div>
    );
  }

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const issueCount = Object.values(report.issues).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className={`rounded-xl border p-4 space-y-2 ${issueCount > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${issueCount > 0 ? 'text-amber-500' : 'text-green-500'}`} />
          <div className="flex-1">
            <p className={`font-semibold text-sm ${issueCount > 0 ? 'text-amber-900' : 'text-green-900'}`}>
              {issueCount > 0 ? `${issueCount} Issue(s) Found` : 'No Issues Found'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{report.summary}</p>
          </div>
        </div>
        <Button onClick={runDiagnostic} size="sm" variant="outline" className="rounded-lg w-full mt-2">
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-run Diagnostic
        </Button>
      </div>

      {/* Duplicate names section */}
      {report.issues.duplicateNames.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('duplicates')}
            className="w-full p-4 flex items-center justify-between bg-card hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-destructive" />
              <span className="text-sm font-semibold text-foreground">Duplicate Names ({report.issues.duplicateNames.length})</span>
            </div>
            {expandedSections.duplicates ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <AnimatePresence>
            {expandedSections.duplicates && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="border-t border-border overflow-hidden">
                <div className="p-4 space-y-3 bg-secondary/20">
                  {report.issues.duplicateNames.map((dup, i) => (
                    <div key={i} className="bg-card rounded-lg p-3 space-y-2">
                      <p className="text-sm font-semibold text-foreground capitalize">{dup.name} ({dup.count} copies)</p>
                      <div className="space-y-1">
                        {dup.records.map(r => (
                          <div key={r.id} className="text-xs text-muted-foreground pl-3 border-l border-border/50">
                            ID: {r.id.slice(0, 8)}... | Created: {new Date(r.createdDate).toLocaleDateString()}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-amber-600 font-medium mt-2">
                        💡 These should be merged into one using the Manage Characters UI
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* NPC matching active character */}
      {report.issues.npcMatchingActiveChar.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('npcMatch')}
            className="w-full p-4 flex items-center justify-between bg-card hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-foreground">NPC Shadowing Active Character ({report.issues.npcMatchingActiveChar.length})</span>
            </div>
            {expandedSections.npcMatch ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <AnimatePresence>
            {expandedSections.npcMatch && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="border-t border-border overflow-hidden">
                <div className="p-4 space-y-3 bg-secondary/20">
                  {report.issues.npcMatchingActiveChar.map((item, i) => (
                    <div key={i} className="bg-card rounded-lg p-3 space-y-2">
                      <p className="text-sm font-semibold text-foreground">{item.npcName} (NPC type: {item.npcType})</p>
                      <p className="text-xs text-muted-foreground">
                        Duplicate of active character ID: {item.matchingActiveChar.id.slice(0, 8)}...
                      </p>
                      <p className="text-xs text-orange-600 font-medium mt-2">
                        ⚠️ Delete this NPC and use the active character instead
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Incorrect family references */}
      {report.issues.incorrectFamilyReferences.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('familyRef')}
            className="w-full p-4 flex items-center justify-between bg-card hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-semibold text-foreground">Incorrect Family References ({report.issues.incorrectFamilyReferences.length})</span>
            </div>
            {expandedSections.familyRef ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <AnimatePresence>
            {expandedSections.familyRef && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="border-t border-border overflow-hidden">
                <div className="p-4 space-y-3 bg-secondary/20">
                  {report.issues.incorrectFamilyReferences.map((item, i) => (
                    <div key={i} className="bg-card rounded-lg p-3 space-y-2">
                      <p className="text-sm font-semibold text-foreground">{item.charName}</p>
                      <p className="text-xs text-muted-foreground">
                        Has "{item.familyMemberName}" as family member → should link to active character "{item.shouldLinkToCharName}" ({item.shouldLinkToCharId.slice(0, 8)}...)
                      </p>
                      <p className="text-xs text-blue-600 font-medium mt-2">
                        🔗 Remove from family list and add relationship to the active character instead
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Ghost NPCs */}
      {report.issues.ghostNPCs.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('ghost')}
            className="w-full p-4 flex items-center justify-between bg-card hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-foreground">Ghost NPCs ({report.issues.ghostNPCs.length})</span>
            </div>
            {expandedSections.ghost ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <AnimatePresence>
            {expandedSections.ghost && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="border-t border-border overflow-hidden">
                <div className="p-4 space-y-3 bg-secondary/20">
                  {report.issues.ghostNPCs.map((npc, i) => (
                    <div key={i} className="bg-card rounded-lg p-3 space-y-2">
                      <p className="text-sm font-semibold text-foreground">{npc.name}</p>
                      <p className="text-xs text-muted-foreground">ID: {npc.id.slice(0, 8)}...</p>
                      <p className="text-xs text-slate-600 font-medium mt-2">
                        👻 Unreferenced NPC — safe to delete
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Cross-reference errors */}
      {report.issues.crossReferenceErrors.length > 0 && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('crossRef')}
            className="w-full p-4 flex items-center justify-between bg-card hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-semibold text-foreground">Broken Cross-References ({report.issues.crossReferenceErrors.length})</span>
            </div>
            {expandedSections.crossRef ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <AnimatePresence>
            {expandedSections.crossRef && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="border-t border-border overflow-hidden">
                <div className="p-4 space-y-3 bg-secondary/20">
                  {report.issues.crossReferenceErrors.map((err, i) => (
                    <div key={i} className="bg-card rounded-lg p-3 space-y-2">
                      <p className="text-sm font-semibold text-foreground">{err.charName}</p>
                      <p className="text-xs text-muted-foreground">
                        References missing character ID: {err.brokenRelId.slice(0, 8)}... ({err.personName})
                      </p>
                      <p className="text-xs text-red-600 font-medium mt-2">
                        ❌ Remove or update this relationship
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {issueCount === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">
          ✓ All systems clean — no character duplicates or inconsistencies detected
        </div>
      )}
    </div>
  );
}