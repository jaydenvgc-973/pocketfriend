import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { X, MapPin, User, Users, Link, Tag, Eye, EyeOff, AlertCircle, ChevronRight } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { addPermanentIgnore, addSessionIgnore, markResolved } from '@/lib/entityDetectionFilter';

// Action types
const ACTIONS = {
  THIS_IS_ME: 'this_is_me',
  MY_NICKNAME: 'my_nickname',
  LINK_CHARACTER: 'link_character',
  LINK_LOCATION: 'link_location',
  ADD_FAMILY: 'add_family',
  ADD_PERSON: 'add_person',
  ADD_LOCATION: 'add_location',
  JUST_ALIAS: 'just_alias',
  SKIP_ONCE: 'skip_once',
  ALWAYS_IGNORE: 'always_ignore',
  NO_ACTION: 'no_action',
};

export default function NewPersonDetectedModal({ people, characterId, characterName, onDone }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAction, setSelectedAction] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [locations, setLocations] = useState([]);
  const [user, setUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [familyRelationship, setFamilyRelationship] = useState('');
  const [customNickname, setCustomNickname] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const me = await base44.auth.me();
        setUser(me);
        const [chars, locs] = await Promise.all([
          base44.entities.Character.filter({ owner_email: me.email }, null, 200),
          base44.entities.LocationReference.filter({ owner_email: me.email }, null, 100),
        ]);
        setCharacters(chars.filter(c => !['deleted', 'soft_deleted', 'merged'].includes(c.status)));
        setLocations(locs);
      } catch (err) {
        console.warn('[NewPersonDetectedModal] load error:', err.message);
      }
    };
    load();
  }, []);

  if (!people || people.length === 0) return null;

  const currentPerson = people[currentIndex];
  const isLikelyLocation = currentPerson?.likely_type === 'location';
  const totalCount = people.length;

  const advance = () => {
    if (currentIndex < totalCount - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAction(null);
      setSearchQuery('');
      setFamilyRelationship('');
      setCustomNickname('');
      setErrorMsg('');
    } else {
      onDone();
    }
  };

  const handleIgnoreAlways = async () => {
    addPermanentIgnore(currentPerson.name);
    markResolved(currentPerson.name, 'ignored');
    advance();
  };

  const handleSkipOnce = () => {
    addSessionIgnore(currentPerson.name);
    advance();
  };

  const handleNoAction = () => {
    markResolved(currentPerson.name, 'no_action');
    advance();
  };

  const handleThisIsMe = async () => {
    setIsProcessing(true);
    try {
      if (!user) return;
      const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email }, null, 1);
      if (settingsList[0]) {
        const existingAliases = settingsList[0].user_aliases || [];
        if (!existingAliases.includes(currentPerson.name)) {
          await base44.entities.UserSettings.update(settingsList[0].id, {
            user_aliases: [...existingAliases, currentPerson.name],
          });
        }
      }
      markResolved(currentPerson.name, 'user');
    } catch (err) {
      setErrorMsg('Failed to save alias: ' + err.message);
    } finally {
      setIsProcessing(false);
      if (!errorMsg) advance();
    }
  };

  const handleMyNickname = async () => {
    if (!customNickname.trim()) return;
    setIsProcessing(true);
    try {
      if (!user) return;
      const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email }, null, 1);
      if (settingsList[0]) {
        const existingAliases = settingsList[0].user_aliases || [];
        const toAdd = customNickname.trim();
        if (!existingAliases.includes(toAdd)) {
          await base44.entities.UserSettings.update(settingsList[0].id, {
            user_aliases: [...existingAliases, toAdd],
          });
        }
      }
      markResolved(currentPerson.name, 'user');
      advance();
    } catch (err) {
      setErrorMsg('Failed: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLinkCharacter = async (char) => {
    setIsProcessing(true);
    try {
      // Save as alias on the target character
      const existingAliases = Array.isArray(char.aliases) ? char.aliases : [];
      const aliasExists = existingAliases.some(a => {
        const t = typeof a === 'string' ? a : (a?.text || a?.alias || '');
        return t.toLowerCase() === currentPerson.name.toLowerCase();
      });
      if (!aliasExists) {
        await base44.entities.Character.update(char.id, {
          aliases: [...existingAliases, { text: currentPerson.name, source: 'user_confirmed' }],
        });
      }
      markResolved(currentPerson.name, 'character');
      advance();
    } catch (err) {
      setErrorMsg('Failed to link: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLinkLocation = async (loc) => {
    setIsProcessing(true);
    try {
      // Save a location alias
      await base44.entities.LocationAlias.create({
        location_id: loc.id,
        location_name: loc.name,
        alias_text: currentPerson.name,
        source: 'user_confirmed',
        owner_email: user?.email,
      }).catch(() => {}); // LocationAlias may not exist on all deployments — fail silently
      markResolved(currentPerson.name, 'location');
      advance();
    } catch (err) {
      setErrorMsg('Failed to link location: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddFamily = async () => {
    if (!familyRelationship.trim()) return;
    setIsProcessing(true);
    try {
      await base44.functions.invoke('createFamilyNPCCharacter', {
        name: currentPerson.name,
        relationship: familyRelationship.trim(),
        relatedCharacterId: characterId,
        context: currentPerson.context || '',
      });
      markResolved(currentPerson.name, 'character');
      advance();
    } catch (err) {
      setErrorMsg('Failed: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddPerson = async () => {
    setIsProcessing(true);
    try {
      await base44.functions.invoke('createNPCCharacter', {
        name: currentPerson.name,
        relatedCharacterId: characterId,
        context: currentPerson.context || '',
      });
      markResolved(currentPerson.name, 'character');
      advance();
    } catch (err) {
      setErrorMsg('Failed: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJustAlias = async () => {
    // Save as alias on the speaking character — this mention is just a shorthand for a known relationship
    setIsProcessing(true);
    try {
      const chars = await base44.entities.Character.filter({ id: characterId }, null, 1);
      const char = chars[0];
      if (char) {
        const existingAliases = Array.isArray(char.aliases) ? char.aliases : [];
        await base44.entities.Character.update(char.id, {
          aliases: [...existingAliases, { text: currentPerson.name, source: 'context_alias' }],
        });
      }
      markResolved(currentPerson.name, 'alias');
      advance();
    } catch (err) {
      setErrorMsg('Failed: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Filter helpers
  const filteredChars = characters.filter(c =>
    !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredLocs = locations.filter(l =>
    !searchQuery || l.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderActionDetail = () => {
    if (!selectedAction) return null;

    switch (selectedAction) {
      case ACTIONS.THIS_IS_ME:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              "{currentPerson.name}" will be saved as one of your world aliases.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleThisIsMe} disabled={isProcessing} className="flex-1">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm — This is me'}
              </Button>
              <Button variant="outline" onClick={() => setSelectedAction(null)}>Back</Button>
            </div>
          </div>
        );

      case ACTIONS.MY_NICKNAME:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">What nickname should be saved for you?</p>
            <Input
              value={customNickname}
              onChange={e => setCustomNickname(e.target.value)}
              placeholder="Nickname..."
              autoFocus
            />
            <div className="flex gap-2">
              <Button onClick={handleMyNickname} disabled={isProcessing || !customNickname.trim()} className="flex-1">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Nickname'}
              </Button>
              <Button variant="outline" onClick={() => setSelectedAction(null)}>Back</Button>
            </div>
          </div>
        );

      case ACTIONS.LINK_CHARACTER:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Which character is "{currentPerson.name}"?</p>
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search characters..."
              autoFocus
            />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredChars.slice(0, 20).map(char => (
                <button
                  key={char.id}
                  onClick={() => handleLinkCharacter(char)}
                  disabled={isProcessing}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  <div className="font-medium text-sm">{char.name}</div>
                  {char.occupation && <div className="text-xs text-muted-foreground">{char.occupation}</div>}
                </button>
              ))}
              {filteredChars.length === 0 && (
                <p className="text-xs text-muted-foreground px-2">No characters found</p>
              )}
            </div>
            <Button variant="outline" onClick={() => { setSelectedAction(null); setSearchQuery(''); }} className="w-full">
              Back
            </Button>
          </div>
        );

      case ACTIONS.LINK_LOCATION:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Which location is "{currentPerson.name}"?</p>
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search locations..."
              autoFocus
            />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredLocs.slice(0, 20).map(loc => (
                <button
                  key={loc.id}
                  onClick={() => handleLinkLocation(loc)}
                  disabled={isProcessing}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  <div className="font-medium text-sm">{loc.name}</div>
                  {loc.category && <div className="text-xs text-muted-foreground">{loc.category}</div>}
                </button>
              ))}
              {filteredLocs.length === 0 && (
                <p className="text-xs text-muted-foreground px-2">No locations found</p>
              )}
            </div>
            <Button variant="outline" onClick={() => { setSelectedAction(null); setSearchQuery(''); }} className="w-full">
              Back
            </Button>
          </div>
        );

      case ACTIONS.ADD_FAMILY:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              What is {currentPerson.name}'s relationship to {characterName}?
            </p>
            <Input
              value={familyRelationship}
              onChange={e => setFamilyRelationship(e.target.value)}
              placeholder="e.g., mother, brother, cousin..."
              autoFocus
            />
            <div className="flex gap-2">
              <Button onClick={handleAddFamily} disabled={isProcessing || !familyRelationship.trim()} className="flex-1">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Family Member'}
              </Button>
              <Button variant="outline" onClick={() => setSelectedAction(null)}>Back</Button>
            </div>
          </div>
        );

      case ACTIONS.ADD_PERSON:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Create "{currentPerson.name}" as a new NPC in {characterName}'s world?
            </p>
            {currentPerson.context && (
              <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">{currentPerson.context}</p>
            )}
            <div className="flex gap-2">
              <Button onClick={handleAddPerson} disabled={isProcessing} className="flex-1">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create NPC'}
              </Button>
              <Button variant="outline" onClick={() => setSelectedAction(null)}>Back</Button>
            </div>
          </div>
        );

      case ACTIONS.JUST_ALIAS:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              "{currentPerson.name}" will be saved as a known alias/shorthand for {characterName}.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleJustAlias} disabled={isProcessing} className="flex-1">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save as Alias'}
              </Button>
              <Button variant="outline" onClick={() => setSelectedAction(null)}>Back</Button>
            </div>
          </div>
        );

      case ACTIONS.ALWAYS_IGNORE:
        return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              "{currentPerson.name}" will be permanently ignored — it will never trigger this prompt again.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleIgnoreAlways} disabled={isProcessing} className="flex-1">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Always Ignore'}
              </Button>
              <Button variant="outline" onClick={() => setSelectedAction(null)}>Back</Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const showingDetail = selectedAction && selectedAction !== ACTIONS.SKIP_ONCE && selectedAction !== ACTIONS.NO_ACTION;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50">
      <Card className="w-full max-w-md rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
          <div>
            <h3 className="font-bold text-base">
              {isLikelyLocation ? '📍 Place or Person?' : '👤 Someone New?'}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalCount > 1 ? `${currentIndex + 1} of ${totalCount}` : 'Review mention'}
            </p>
          </div>
          <button onClick={onDone} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Detected name */}
          <div className={`p-3 rounded-lg border ${isLikelyLocation ? 'bg-blue-500/10 border-blue-500/30' : 'bg-secondary/50 border-border'}`}>
            <p className="text-sm text-muted-foreground">
              {characterName} mentioned:
            </p>
            <p className="text-lg font-bold mt-0.5">"{currentPerson.name}"</p>
            {isLikelyLocation && (
              <div className="flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3 text-blue-400" />
                <span className="text-xs text-blue-400">Likely a place or location</span>
              </div>
            )}
            {currentPerson.context && (
              <p className="text-xs text-muted-foreground italic mt-1 border-t border-border pt-1">
                "{currentPerson.context}"
              </p>
            )}
          </div>

          {/* Error */}
          {errorMsg && (
            <div className="flex gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{errorMsg}</p>
            </div>
          )}

          {/* Action detail (sub-screen) */}
          {showingDetail ? (
            renderActionDetail()
          ) : (
            <div className="space-y-2">
              {/* Location actions shown first if likely location */}
              {isLikelyLocation && (
                <>
                  <ActionButton
                    icon={<MapPin className="w-4 h-4 text-blue-400" />}
                    label="Link to an existing location"
                    sublabel="Match to a known place in the world"
                    onClick={() => setSelectedAction(ACTIONS.LINK_LOCATION)}
                  />
                  <ActionButton
                    icon={<MapPin className="w-4 h-4 text-green-400" />}
                    label="Add as new location"
                    sublabel="Create a new place record"
                    onClick={() => setSelectedAction(ACTIONS.ADD_LOCATION)}
                  />
                  <div className="border-t border-border my-2" />
                </>
              )}

              <ActionButton
                icon={<User className="w-4 h-4 text-purple-400" />}
                label="This is me"
                sublabel="Save as your world alias"
                onClick={() => setSelectedAction(ACTIONS.THIS_IS_ME)}
              />
              <ActionButton
                icon={<Tag className="w-4 h-4 text-violet-400" />}
                label="My nickname here"
                sublabel="Characters call me by this name"
                onClick={() => setSelectedAction(ACTIONS.MY_NICKNAME)}
              />
              <ActionButton
                icon={<Link className="w-4 h-4 text-cyan-400" />}
                label="Link to existing character"
                sublabel="This is someone already in your world"
                onClick={() => setSelectedAction(ACTIONS.LINK_CHARACTER)}
              />
              {!isLikelyLocation && (
                <ActionButton
                  icon={<MapPin className="w-4 h-4 text-blue-400" />}
                  label="Link to existing location"
                  sublabel="This is actually a place"
                  onClick={() => setSelectedAction(ACTIONS.LINK_LOCATION)}
                />
              )}
              <ActionButton
                icon={<Users className="w-4 h-4 text-orange-400" />}
                label="Add as family member"
                sublabel={`${characterName}'s relative`}
                onClick={() => setSelectedAction(ACTIONS.ADD_FAMILY)}
              />
              <ActionButton
                icon={<User className="w-4 h-4 text-green-400" />}
                label="Add as new person"
                sublabel="Create a new NPC"
                onClick={() => setSelectedAction(ACTIONS.ADD_PERSON)}
              />
              <ActionButton
                icon={<Tag className="w-4 h-4 text-amber-400" />}
                label="Just an alias / shorthand"
                sublabel="Not a new person — just a known reference"
                onClick={() => setSelectedAction(ACTIONS.JUST_ALIAS)}
              />

              <div className="border-t border-border my-2" />

              <ActionButton
                icon={<Eye className="w-4 h-4 text-muted-foreground" />}
                label="Skip once"
                sublabel="Decide later"
                onClick={handleSkipOnce}
                muted
              />
              <ActionButton
                icon={<EyeOff className="w-4 h-4 text-muted-foreground" />}
                label="Always ignore this phrase"
                sublabel="Never ask about it again"
                onClick={() => setSelectedAction(ACTIONS.ALWAYS_IGNORE)}
                muted
              />
              <ActionButton
                icon={<X className="w-4 h-4 text-muted-foreground" />}
                label="No action needed"
                sublabel="Just a passing mention"
                onClick={handleNoAction}
                muted
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ActionButton({ icon, label, sublabel, onClick, muted = false }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors flex items-start gap-3 ${
        muted
          ? 'border-border hover:bg-secondary/50'
          : 'border-border hover:bg-secondary'
      }`}
    >
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className={`font-medium text-sm ${muted ? 'text-muted-foreground' : ''}`}>{label}</div>
        {sublabel && <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
    </button>
  );
}