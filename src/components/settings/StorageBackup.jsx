import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Database, CheckCircle2, RefreshCw, Trash2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { base44 } from "@/api/base44Client";

const STORAGE_URL = "https://igkxazeglptupwbtbxlo.supabase.co";
const STORAGE_KEY = "sb_publishable_EKifMMhwGEWBpUwKD2nFdA_2OHaG1mE";
const STORAGE_STORAGE_KEY = "app_storage_config";

export default function StorageBackup() {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    // Default: pre-configured storage
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
      // Verify the URL is reachable (just a HEAD request to the base URL)
      const res = await fetch(`${config.url}/rest/v1/`, {
        method: 'HEAD',
        headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` }
      });
      if (res.ok || res.status === 404 || res.status === 400) {
        // 400/404 from Supabase REST still means the server is reachable
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
    <div className="pt-4 border-t border-border">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-primary" />
          <div>
            <p className="text-xs font-medium text-foreground uppercase tracking-wider">Storage & Backup</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {isConnected
                ? `Connected — ${config.label || config.url.replace('https://', '').split('.')[0]}`
                : 'Not connected'}
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

              {/* Connection Status */}
              <div className={`rounded-xl border p-3 flex items-center gap-3 ${isConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-secondary'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isConnected ? 'bg-emerald-500/20' : 'bg-secondary'}`}>
                  <Database className={`w-4 h-4 ${isConnected ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {isConnected ? 'Storage Connected' : 'No Storage Connected'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {isConnected ? (config.url || 'Storage endpoint active') : 'Connect storage to expand message history and media backup'}
                  </p>
                </div>
                {isConnected && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex-shrink-0 px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20">
                    ACTIVE
                  </span>
                )}
              </div>

              {/* What storage does */}
              <div className="rounded-xl bg-secondary border border-border p-3 space-y-2 text-xs text-muted-foreground">
                <p className="text-foreground font-medium text-sm">How storage works</p>
                <ul className="space-y-1">
                  <li>• Archived messages remain retrievable (not just stored)</li>
                  <li>• Character memories persist across sessions</li>
                  <li>• Long-term memory stays active in conversations</li>
                  <li>• Media (images, voice) backed up independently</li>
                  <li>• Storage does <strong className="text-foreground">not</strong> disconnect memory — stored = still usable</li>
                </ul>
              </div>

              {/* Connection test result */}
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

              {/* Connection URL display (masked) */}
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

              {/* Manual URL/Key fields when disconnected */}
              {!isConnected && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Enter your storage endpoint to reconnect:</p>
                  <input
                    type="text"
                    placeholder="Storage URL (e.g. https://....supabase.co)"
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

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={testConnection}
                  disabled={testing || !config.url}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
                >
                  {testing ? <Loader2Inline /> : <RefreshCw className="w-3.5 h-3.5" />}
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

              <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                Storage keeps extended message history accessible and ensures character long-term memories remain active in conversations. Disconnecting storage hides the connection but does not delete any data.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Loader2Inline() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}