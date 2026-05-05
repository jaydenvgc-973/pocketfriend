import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { X, Play, MessageCircle, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

const SUPPORTED_TYPES = ['active_created_character', 'npc_fictitious', 'npc_family_member', 'npc_regular'];

const TYPE_LABELS = {
  active_created_character: 'Active Characters',
  npc_fictitious: 'NPC Fictitious',
  npc_family_member: 'Family NPCs',
  npc_regular: 'Regular NPCs',
};

export default function CharacterInteractionSimulator({ characters, currentUser }) {
  const alpha = (a, b) => (a.display_name || a.name || '').toLowerCase().localeCompare((b.display_name || b.name || '').toLowerCase());

  const eligibleByType = SUPPORTED_TYPES.reduce((acc, type) => {
    const group = characters
      .filter(c => c.character_type === type && c.status !== 'deleted' && c.status !== 'soft_deleted')
      .sort(alpha);
    if (group.length > 0) acc[type] = group;
    return acc;
  }, {});

  const [selected, setSelected] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [isApprovalMode, setIsApprovalMode] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [simulationError, setSimulationError] = useState(null);

  // MongoDB ObjectId = 24 hex chars exactly.
  // Any id that isn't exactly 24 chars is not a real Character entity id.
  const OBJECT_ID_LENGTH = 24;

  const toggleSelect = (id, char) => {
    // ID integrity guard — block selection of corrupted/transformed objects
    if (!id || id.length !== OBJECT_ID_LENGTH) {
      console.error('[SimulateInteraction] BLOCKED: invalid character id', {
        id,
        idLength: id?.length,
        expectedLength: OBJECT_ID_LENGTH,
        name: char?.name,
        type: char?.character_type,
        owner_email: char?.owner_email,
      });
      return;
    }
    console.log('[SimulateInteraction] Selecting character', {
      id,
      name: char?.name,
      type: char?.character_type,
      owner_email: char?.owner_email,
    });
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id));
    } else if (selected.length < 4) {
      setSelected([...selected, id]);
    }
  };

  const parseError = (err, res) => {
    // When Axios throws on non-2xx, the response body is in err.response.data — NOT res.data.
    // res may be undefined or contain only the last successful partial response.
    // Always check err.response.data first to surface the real backend stage/error.
    const errBody = err?.response?.data || {};
    const resBody = res?.data || {};
    const data = (errBody.stage || errBody.error) ? errBody : resBody;

    const stage = data.stage ? `[${data.stage}] ` : '';
    if (data.error) return `${stage}${data.error}`;
    if (err?.message) return err.message;
    return 'Unknown error occurred.';
  };

  const handleSimulate = async () => {
    if (selected.length < 2) return;
    setIsRunning(true);
    setIsApprovalMode(false);
    setSimulationError(null);

    const selectedChars = characters.filter(c => selected.includes(c.id));

    // Pre-submit ID integrity audit — every submitted id must be a real 24-char ObjectId
    const invalidChars = selectedChars.filter(c => !c.id || c.id.length !== OBJECT_ID_LENGTH);
    if (invalidChars.length > 0) {
      const details = invalidChars.map(c => `"${c.name}" (id="${c.id}", len=${c.id?.length})`).join(', ');
      console.error('[SimulateInteraction] BLOCKED: invalid ids in selection', invalidChars);
      setSimulationError(`Cannot simulate: the following characters have invalid IDs: ${details}. Please reload the page and try again.`);
      setIsRunning(false);
      return;
    }

    console.log('[SimulateInteraction] Starting simulation — all IDs verified', {
      currentUser: currentUser?.email,
      characters: selectedChars.map(c => ({
        id: c.id,
        idLength: c.id.length,
        name: c.name,
        type: c.character_type,
        owner_email: c.owner_email,
      })),
    });

    let res;
    try {
      res = await base44.functions.invoke('simulateCharacterInteraction', {
        character_ids: selected,
        userPrompt: userPrompt || undefined,
      });

      if (res?.data?.success) {
        setResult(res.data.interaction);
        setShowModal(true);
        setIsApprovalMode(true);
      } else {
        const errMsg = parseError(null, res);
        console.error('[SimulateInteraction] Backend returned failure:', res?.data);
        setSimulationError(`Simulation failed: ${errMsg}`);
      }
    } catch (err) {
      const errMsg = parseError(err, res);
      console.error('[SimulateInteraction] Exception:', err);
      setSimulationError(`Simulation failed: ${errMsg}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRegenerate = async () => {
    if (!result) return;
    setIsRegenerating(true);
    setSimulationError(null);
    let res;
    try {
      res = await base44.functions.invoke('simulateCharacterInteraction', {
        character_ids: selected,
        userPrompt: userPrompt || undefined,
      });

      if (res?.data?.success) {
        setResult(res.data.interaction);
        setIsApprovalMode(true);
      } else {
        setSimulationError(`Regeneration failed: ${parseError(null, res)}`);
      }
    } catch (err) {
      setSimulationError(`Regeneration failed: ${parseError(err, res)}`);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleApprove = async () => {
    setIsApprovalMode(false);
    setShowModal(false);

    if (result && selected.length > 0) {
      for (const characterId of selected) {
        const char = characters.find(c => c.id === characterId);
        if (!char) continue;

        try {
          const convos = await base44.entities.Conversation.filter(
            { type: 'direct', character_ids: [characterId] },
            '-updated_date',
            1
          );

          let convoId = convos[0]?.id;
          if (!convoId) {
            const convo = await base44.entities.Conversation.create({
              title: `Direct with ${char.name}`,
              type: 'direct',
              character_ids: [characterId],
              owner_email: currentUser?.email,
            });
            convoId = convo.id;
          }

          const narrativeContent = `${result.scene_summary}\n\n${(result.dialogue || []).map(d => `**${d.speaker}:** "${d.text}"`).join('\n\n')}\n\n${result.outcome}`;

          await base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: 'character',
            character_id: characterId,
            character_name: char.name,
            content: narrativeContent,
            is_narrative: true,
            timestamp: new Date().toISOString(),
          });

          await base44.entities.Conversation.update(convoId, {
            last_message_preview: result.scene_summary.substring(0, 100),
            last_message_date: new Date().toISOString(),
          });
        } catch (err) {
          console.error(`[SimulateInteraction] Failed to save narrative for ${char.name}:`, err);
        }
      }
    }

    setUserPrompt('');
  };

  return (
    <>
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Simulate Interaction</p>
        </div>

        <p className="text-xs text-muted-foreground">Select 2-4 characters to simulate a dynamic interaction.</p>

        <Textarea
          placeholder="Optional: Describe what you'd like to happen in this interaction..."
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          className="min-h-20 text-xs rounded-xl"
        />

        {/* Character selection grid — all supported types */}
        <div className="overflow-y-auto" style={{ maxHeight: '11rem' }}>
          {SUPPORTED_TYPES.filter(type => eligibleByType[type]).map(type => (
            <div key={type} className="mb-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{TYPE_LABELS[type]}</p>
              <div className="grid grid-cols-2 gap-2">
                {eligibleByType[type].map(char => (
                  <button
                    key={char.id}
                    onClick={() => toggleSelect(char.id, char)}
                    className={`p-2 rounded-xl border transition-colors text-left text-xs ${
                      selected.includes(char.id)
                        ? 'bg-primary/10 border-primary'
                        : 'bg-secondary border-border hover:border-primary/40'
                    }`}
                  >
                    <div className="font-medium text-foreground truncate">{char.name}</div>
                    <div className="text-muted-foreground text-[10px] truncate">{char.archetype || char.character_type}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {selected.length > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-xs text-primary font-medium">{selected.length} selected</span>
          </div>
        )}

        {/* In-panel error display — replaces alert() */}
        {simulationError && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-destructive/10 border border-destructive/30">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive leading-relaxed">{simulationError}</p>
          </div>
        )}

        <Button
          onClick={handleSimulate}
          disabled={selected.length < 2 || isRunning}
          className="w-full h-10 rounded-xl"
        >
          <Play className="w-4 h-4 mr-2" />
          {isRunning ? 'Simulating...' : 'Simulate Interaction'}
        </Button>
      </div>

      {createPortal(
        <AnimatePresence>
          {showModal && result && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
              onClick={() => setShowModal(false)}
            >
              <motion.div
                initial={{ y: 80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 80, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-card border border-border rounded-t-2xl max-h-[80vh] overflow-y-auto"
              >
                <div className="sticky top-0 bg-card/80 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    {result.characters.join(' & ')}
                  </h3>
                  <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Scene</p>
                    <p className="text-sm text-foreground leading-relaxed">{result.scene_summary}</p>
                  </div>

                  {result.dialogue && result.dialogue.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Dialogue</p>
                      <div className="space-y-2 bg-secondary/50 rounded-xl p-3">
                        {result.dialogue.map((line, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="font-medium text-primary">{line.speaker}:</span>
                            <span className="text-foreground ml-2">"{line.text}"</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.outcome && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">What Happened</p>
                      <p className="text-sm text-foreground leading-relaxed">{result.outcome}</p>
                    </div>
                  )}

                  {simulationError && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-destructive/10 border border-destructive/30">
                      <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive leading-relaxed">{simulationError}</p>
                    </div>
                  )}

                  {isApprovalMode && (
                    <div className="flex gap-3 pt-4 border-t border-border">
                      <Button onClick={handleRegenerate} disabled={isRegenerating} variant="outline" className="flex-1 rounded-xl gap-2">
                        <RefreshCw className="w-4 h-4" />
                        {isRegenerating ? 'Regenerating...' : 'Regenerate'}
                      </Button>
                      <Button onClick={handleApprove} className="flex-1 rounded-xl gap-2">
                        <Check className="w-4 h-4" />
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}