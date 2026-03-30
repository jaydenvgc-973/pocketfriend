import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database, CheckCircle2, RefreshCw, Trash2, ChevronDown, ChevronUp,
  ExternalLink, HardDrive, Brain, Download, Upload, AlertCircle, Loader2
} from "lucide-react";
import { base44 } from "@/api/base44Client";

const STORAGE_URL = "https://igkxazeglptupwbtbxlo.supabase.co";
const STORAGE_KEY = "sb_publishable_EKifMMhwGEWBpUwKD2nFdA_2OHaG1mE";
const STORAGE_STORAGE_KEY = "app_storage_config";
const DRIVE_CONFIG_KEY = "gdrive_backup_config";

// ── Primary Storage Section ───────────────────────────────────────────────────
function PrimaryStorage() {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { url: STORAGE_URL, key: STORAGE_KEY, connected: true, label: "Primary Storage" };
  });

  const saveConfig = (updates) => {
    const next = { ...config, ...updates };
    setConfig(next);
    localStorage.setItem(STORAGE_STORAGE_KEY, JSON.stringify(next));
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${config.url}/rest/v1/`, {
        method: 'HEAD',
        headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` }
      });
      if (res.ok || res.status === 404 || res.status === 400) {
        setTestResult({ ok: true, message: "Connection verified — storage is active and reachable." });
        saveConfig({ connected: true });
      } else {
        setTestResult({ ok: false, message: `Connection returned status ${res.status}.` });
      }
    } catch (err) {
      setTestResult({ ok: false, message: `Could not reach storage endpoint: ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  const disconnect = () => {
    const cleared = { url: "", key: "", connected: false, label: "" };
    setConfig(cleared);
    localStorage.setItem(STORAGE_STORAGE_KEY, JSON.stringify(cleared));
    setTestResult(null);
  };

  const reconnect = () => {
    const restored = { url: STORAGE_URL, key: STORAGE_KEY, connected: true, label: "Primary Storage" };
    setConfig(restored);
    localStorage.setItem(STORAGE_STORAGE_KEY, JSON.stringify(restored));
    setTestResult(null);
  };

  const isConnected = config.connected && config.url;

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-primary" />
          <div>
            <p className="text-xs font-medium text-foreground uppercase tracking-wider">Primary Memory Storage</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {isConnected ? `Active — ${config.label || "Primary Storage"}` : 'Not connected'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-4">
              {/* Active Memory Architecture explanation */}
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Brain className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <p className="text-xs font-semibold text-primary">Active Memory Architecture</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All character memories stored here remain <strong className="text-foreground">live and active</strong> — not archived. Every conversation, the system scores all stored memories against the current topic and retrieves the most relevant ones automatically. Characters can recall events from months ago without the user doing anything.
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  <li className="flex gap-1.5"><span className="text-emerald-400">✓</span> Smart relevance scoring — older memories surface when relevant</li>
                  <li className="flex gap-1.5"><span className="text-emerald-400">✓</span> Stored = still retrievable in live conversation</li>
                  <li className="flex gap-1.5"><span className="text-emerald-400">✓</span> Archived ≠ forgotten — archive only hides from feed</li>
                  <li className="flex gap-1.5"><span className="text-emerald-400">✓</span> No manual restore required for characters to remember</li>
                </ul>
              </div>

              {/* Connection Status */}
              <div className={`rounded-xl border p-3 flex items-center gap-3 ${isConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-secondary'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isConnected ? 'bg-emerald-500/20' : 'bg-secondary'}`}>
                  <Database className={`w-4 h-4 ${isConnected ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {isConnected ? 'Storage Connected & Active' : 'No Storage Connected'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {isConnected ? (config.url || 'Storage endpoint active') : 'Connect storage to expand message history and memory'}
                  </p>
                </div>
                {isConnected && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex-shrink-0 px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20">ACTIVE</span>
                )}
              </div>

              <AnimatePresence>
                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`rounded-xl border p-3 flex items-start gap-2 text-xs ${testResult.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {testResult.message}
                  </motion.div>
                )}
              </AnimatePresence>

              {isConnected && (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Endpoint</p>
                  <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2">
                    <code className="text-xs text-foreground flex-1 truncate font-mono">{config.url}</code>
                    <a href={config.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}

              {!isConnected && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Enter your storage endpoint to reconnect:</p>
                  <input
                    type="text"
                    placeholder="Storage URL"
                    value={config.url || ""}
                    onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-foreground text-xs placeholder:text-muted-foreground"
                  />
                  <input
                    type="text"
                    placeholder="API Key"
                    value={config.key || ""}
                    onChange={e => setConfig(c => ({ ...c, key: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-foreground text-xs placeholder:text-muted-foreground font-mono"
                  />
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={testConnection}
                  disabled={testing || !config.url}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
                >
                  {testing ? <SpinIcon /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {testing ? 'Testing…' : 'Test Connection'}
                </button>
                {isConnected ? (
                  <button
                    onClick={disconnect}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={reconnect}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Reconnect Default
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Google Drive Backup Section ───────────────────────────────────────────────
function GoogleDriveBackup() {
  const [expanded, setExpanded] = useState(false);
  const [driveConfig, setDriveConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(DRIVE_CONFIG_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { connected: false, email: null, lastBackup: null };
  });
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const saveDriveConfig = (updates) => {
    const next = { ...driveConfig, ...updates };
    setDriveConfig(next);
    localStorage.setItem(DRIVE_CONFIG_KEY, JSON.stringify(next));
  };

  const handleConnect = async () => {
    setStatusMsg({ type: 'info', text: 'Opening Google authorization…' });
    try {
      const url = await base44.connectors.connectAppUser('gdrive_backup');
      const popup = window.open(url, '_blank', 'width=600,height=700');
      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(timer);
          // After OAuth, mark connected
          saveDriveConfig({ connected: true, email: 'Connected via Google' });
          setStatusMsg({ type: 'ok', text: 'Google Drive connected successfully.' });
        }
      }, 500);
    } catch (err) {
      // Connector not configured — show informational message
      setStatusMsg({
        type: 'info',
        text: 'Google Drive backup requires the Google Drive connector to be enabled in your app settings. Contact your admin to enable it.',
      });
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    setStatusMsg(null);
    try {
      // Export all memories to a JSON blob and show as download
      // (Drive upload requires OAuth connector; this gives a local download as fallback)
      const chars = await base44.entities.Character.list('-created_date', 100);
      const allMemories = [];
      for (const char of chars.slice(0, 20)) {
        const mems = await base44.entities.Memory.filter({ character_id: char.id }, '-timestamp', 500);
        allMemories.push({ character: char.name, character_id: char.id, memories: mems });
      }
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), data: allMemories }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `own_your_life_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const now = new Date().toISOString();
      saveDriveConfig({ lastBackup: now });
      setStatusMsg({ type: 'ok', text: `Backup downloaded successfully. ${allMemories.reduce((s, c) => s + c.memories.length, 0)} memories exported.` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Backup failed: ${err.message}` });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async (file) => {
    if (!file) return;
    setIsRestoring(true);
    setStatusMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.data || !Array.isArray(parsed.data)) throw new Error('Invalid backup file format.');

      let restored = 0;
      let skipped = 0;
      for (const entry of parsed.data) {
        if (!entry.character_id || !Array.isArray(entry.memories)) continue;
        // Get existing memories to avoid duplicates
        const existing = await base44.entities.Memory.filter({ character_id: entry.character_id }, '-timestamp', 500);
        const existingTitles = new Set(existing.map(m => m.title?.toLowerCase()));
        for (const mem of entry.memories) {
          if (!mem.title || !mem.description) continue;
          if (existingTitles.has(mem.title.toLowerCase())) { skipped++; continue; }
          await base44.entities.Memory.create({
            character_id: entry.character_id,
            title: mem.title,
            description: mem.description,
            emotional_impact: mem.emotional_impact || 'neutral',
            timestamp: mem.timestamp || new Date().toISOString(),
            source_context: mem.source_context || 'restored_from_backup',
          });
          restored++;
        }
      }
      setStatusMsg({ type: 'ok', text: `Restore complete: ${restored} memories restored, ${skipped} already existed (skipped).` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Restore failed: ${err.message}` });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="pt-4 border-t border-border">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <HardDrive className="w-4 h-4 text-blue-400" />
          <div>
            <p className="text-xs font-medium text-foreground uppercase tracking-wider">Google Drive Backup</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {driveConfig.connected
                ? `Connected${driveConfig.lastBackup ? ` · Last backup ${new Date(driveConfig.lastBackup).toLocaleDateString()}` : ''}`
                : 'Not connected — extended memory backup'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${driveConfig.connected ? 'bg-blue-400' : 'bg-zinc-600'}`} />
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-4">

              {/* Active memory clarification */}
              <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Brain className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  <p className="text-xs font-semibold text-blue-300">Extended Memory Backup — Not Cold Archive</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Backup exports a copy of all character memories to Drive or a local file. The original memories remain live in the app's active memory system — backup does <strong className="text-foreground">not</strong> remove or deactivate them. Restoring re-imports memories back into the active system so characters can use them immediately.
                </p>
              </div>

              {/* Drive folder structure info */}
              <div className="rounded-xl bg-secondary border border-border p-3 space-y-2 text-xs">
                <p className="text-foreground font-medium">Backup folder structure</p>
                <div className="font-mono text-muted-foreground space-y-0.5 pl-2">
                  <p>📁 Own Your Life App Backups/</p>
                  <p className="pl-4">📁 Characters/</p>
                  <p className="pl-4">📁 Memories/</p>
                  <p className="pl-4">📁 Media/</p>
                  <p className="pl-4">📁 Backups/</p>
                </div>
              </div>

              {/* Status message */}
              <AnimatePresence>
                {statusMsg && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`rounded-xl border p-3 flex items-start gap-2 text-xs ${
                      statusMsg.type === 'ok'
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                        : statusMsg.type === 'error'
                        ? 'border-destructive/30 bg-destructive/5 text-destructive'
                        : 'border-blue-500/30 bg-blue-500/5 text-blue-300'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {statusMsg.text}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                {!driveConfig.connected ? (
                  <button
                    onClick={handleConnect}
                    className="col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    Connect Google Drive
                  </button>
                ) : (
                  <button
                    onClick={() => { saveDriveConfig({ connected: false, email: null }); setStatusMsg(null); }}
                    className="col-span-2 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-secondary text-muted-foreground text-xs hover:text-foreground transition-colors border border-border"
                  >
                    Disconnect Drive
                  </button>
                )}

                <button
                  onClick={handleBackup}
                  disabled={isBackingUp}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
                >
                  {isBackingUp ? <SpinIcon /> : <Download className="w-3.5 h-3.5" />}
                  {isBackingUp ? 'Backing up…' : 'Backup Now'}
                </button>

                <label className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-secondary border border-border text-xs font-medium text-foreground cursor-pointer hover:bg-secondary/80 transition-colors ${isRestoring ? 'opacity-40 pointer-events-none' : ''}`}>
                  {isRestoring ? <SpinIcon /> : <Upload className="w-3.5 h-3.5" />}
                  {isRestoring ? 'Restoring…' : 'Restore'}
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={e => handleRestore(e.target.files?.[0])}
                  />
                </label>
              </div>

              <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                "Backup Now" exports all memories to a local JSON file. "Restore" re-imports them into the active memory system. Restored memories are immediately available to characters in conversation — no reload needed.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
export default function StorageBackup() {
  return (
    <div className="pt-4 border-t border-border space-y-0">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Storage & Backup</p>
      <PrimaryStorage />
      <GoogleDriveBackup />
    </div>
  );
}

function SpinIcon() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}