import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function VoiceDiagnosticsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  
  useEffect(() => {
    // Capture console.log calls for voice-related diagnostics
    const originalLog = console.log;
    
    const captureLog = (...args) => {
      const message = args.join(' ');
      if (message.includes('[Voice') || message.includes('[Chat]') || message.includes('[MessageBubble]') || message.includes('[VOICE-') || message.includes('[PLAYBACK-')) {
        setLogs(prev => {
          const newLogs = [...prev, {
            timestamp: new Date().toLocaleTimeString(),
            message,
            isError: false
          }];
          return newLogs.slice(-50); // Keep last 50 logs
        });
      }
      originalLog(...args);
    };
    
    const originalError = console.error;
    const captureError = (...args) => {
      const message = args.join(' ');
      if (message.includes('[Voice') || message.includes('[Chat]') || message.includes('[MessageBubble]') || message.includes('[VOICE-') || message.includes('[PLAYBACK-')) {
        setLogs(prev => {
          const newLogs = [...prev, {
            timestamp: new Date().toLocaleTimeString(),
            message,
            isError: true
          }];
          return newLogs.slice(-50);
        });
      }
      originalError(...args);
    };
    
    console.log = captureLog;
    console.error = captureError;
    
    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
  }, []);
  
  return (
    <div className="fixed bottom-20 right-4 z-40 max-w-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>🔊 Voice Diagnostics</span>
        {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      
      {isOpen && (
        <div className="mt-2 bg-card border border-border rounded-lg p-3 max-h-64 overflow-y-auto space-y-1 font-mono text-[10px]">
          {logs.length === 0 ? (
            <div className="text-muted-foreground">Waiting for voice activity...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={log.isError ? 'text-red-400' : 'text-cyan-400'}>
                <span className="text-muted-foreground">{log.timestamp}</span> {log.message}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}