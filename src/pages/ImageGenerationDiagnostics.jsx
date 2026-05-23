import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, RefreshCw, Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ImageAuditDisplay from '@/components/chat/ImageAuditDisplay';

/**
 * Image Generation Diagnostics
 *
 * PROOF-BASED ROOT CAUSE FINDER
 *
 * Shows side-by-side audit logs from different image generation paths
 * to identify where behavior diverges.
 *
 * Purpose:
 * Instead of guessing "it's a bedroom issue" or "it's an iPhone issue",
 * this tool shows the actual:
 * - source path used
 * - identity resolution
 * - prompt handling
 * - outfit injection
 * - location/zone resolution
 * - provider response
 * - whether identity collapsed
 *
 * Process:
 * 1. User selects a message with a generated image
 * 2. Tool shows its audit log
 * 3. User can manually trigger generation through different paths
 * 4. Tool shows side-by-side comparison of audits
 * 5. Differences in the audit logs = root cause
 */
export default function ImageGenerationDiagnostics() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [comparingWith, setComparingWith] = useState(null);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        // Load recent messages that have image_generation_audit
        const allMessages = await base44.entities.Message.filter(
          { image_url: { $exists: true } },
          '-created_date',
          50
        ).catch(() => []);

        // Filter to only messages with audit logs
        const auditedMessages = allMessages.filter(m => m.generation_context?.image_generation_audit);
        setMessages(auditedMessages);
      } catch (e) {
        setError(e?.message || 'Failed to load messages');
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, []);

  useEffect(() => {
    if (selectedMessageId && messages.length > 0) {
      const msg = messages.find(m => m.id === selectedMessageId);
      setSelectedMessage(msg);
    }
  }, [selectedMessageId, messages]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-3xl font-bold text-foreground">Image Generation Diagnostics</h1>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive">
            {error}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No messages with audit logs found yet.</p>
            <p className="text-sm mt-2">Generate images to start collecting diagnostics.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* MESSAGE LIST */}
            <div className="lg:col-span-1 space-y-2 max-h-96 overflow-y-auto">
              <h2 className="text-lg font-semibold text-foreground mb-3">Messages with Audit Logs</h2>
              {messages.map(msg => {
                const isSelected = msg.id === selectedMessageId;
                const audit = msg.generation_context?.image_generation_audit;
                const hasWarnings = audit?.warnings?.identity_collapse_detected || audit?.warnings?.fallback_caucasian_used;
                return (
                  <button
                    key={msg.id}
                    onClick={() => setSelectedMessageId(msg.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <div className="text-xs text-muted-foreground">
                      {new Date(msg.created_date).toLocaleString()}
                    </div>
                    <div className="text-sm font-mono text-foreground mt-1 truncate">
                      {audit?.source_path || 'unknown'}
                    </div>
                    <div className="text-xs text-foreground/60 mt-1 truncate">
                      {msg.character_name || 'System'}
                    </div>
                    {hasWarnings && (
                      <div className="text-xs text-amber-400 mt-1 font-bold">⚠️ Warnings</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* MAIN AUDIT DISPLAY */}
            <div className="lg:col-span-2">
              {selectedMessage ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground">Audit Details</h2>
                    <button
                      onClick={() => setSelectedMessage(null)}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>

                  {/* IMAGE PREVIEW */}
                  {selectedMessage.image_url && (
                    <div className="rounded-lg overflow-hidden border border-border bg-secondary/20">
                      <img
                        src={selectedMessage.image_url}
                        alt="Generated image"
                        className="w-full h-auto max-h-64 object-cover"
                        onError={e => {
                          e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23333%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23666%22 font-size=%2214%22%3EImage not loaded%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                  )}

                  {/* AUDIT DISPLAY */}
                  <ImageAuditDisplay audit={selectedMessage.generation_context?.image_generation_audit} />

                  {/* FULL JSON (copyable) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-mono text-muted-foreground">Full Audit JSON</h3>
                      <button
                        onClick={() => {
                          const json = JSON.stringify(selectedMessage.generation_context?.image_generation_audit, null, 2);
                          navigator.clipboard.writeText(json);
                        }}
                        className="p-1 hover:bg-secondary rounded transition-colors"
                      >
                        <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                    <pre className="p-3 bg-secondary/40 rounded-lg border border-border text-xs text-foreground/80 overflow-x-auto max-h-64 overflow-y-auto">
                      {JSON.stringify(selectedMessage.generation_context?.image_generation_audit, null, 2)}
                    </pre>
                  </div>

                  {/* COMPARISON OPTION */}
                  {comparingWith && comparingWith.id !== selectedMessage.id && (
                    <div className="border-t border-border pt-4 space-y-2">
                      <h3 className="text-sm font-semibold text-foreground">Comparing With</h3>
                      <div className="p-3 bg-secondary/20 rounded-lg border border-border">
                        <div className="text-xs text-muted-foreground mb-1">Source Path</div>
                        <div className="text-sm font-mono text-foreground">
                          {comparingWith.generation_context?.image_generation_audit?.source_path || 'unknown'}
                        </div>
                        <div className="mt-2 text-xs space-y-1 text-foreground/60">
                          <div>
                            <strong>Current:</strong> {selectedMessage.generation_context?.image_generation_audit?.resolved_identity?.character_name}
                          </div>
                          <div>
                            <strong>Comparing:</strong> {comparingWith.generation_context?.image_generation_audit?.resolved_identity?.character_name}
                          </div>
                          <div>
                            <strong>Identity match:</strong>{' '}
                            {selectedMessage.generation_context?.image_generation_audit?.resolved_identity?.effective_character_id ===
                            comparingWith.generation_context?.image_generation_audit?.resolved_identity?.effective_character_id
                              ? '✓'
                              : '✗'}
                          </div>
                          <div>
                            <strong>Outfit source match:</strong>{' '}
                            {selectedMessage.generation_context?.image_generation_audit?.outfit_context?.source ===
                            comparingWith.generation_context?.image_generation_audit?.outfit_context?.source
                              ? '✓'
                              : '✗'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <p>Select a message to view its audit log</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* COMPARISON INSTRUCTIONS */}
        <div className="mt-12 p-4 rounded-lg border border-border bg-secondary/20 text-sm text-foreground/80">
          <h3 className="font-semibold mb-2">How to Use This Tool:</h3>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Select a message from the list to view its complete audit log</li>
            <li>The audit shows which source path was used (chat, media_grid, load_photo, etc.)</li>
            <li>Check if identity was correctly resolved and outfit was injected</li>
            <li>If an image failed, the audit shows the provider's rejection reason</li>
            <li>Generate the same image through a different path (e.g., Media Grid)</li>
            <li>Compare the two audits — differences in the logs = root cause</li>
            <li>Device type, file type, and bedroom are not root causes unless the logs prove it</li>
          </ol>
        </div>
      </div>
    </div>
  );
}