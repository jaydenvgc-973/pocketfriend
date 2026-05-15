import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { X, ChevronRight } from 'lucide-react';
import { Loader2 } from 'lucide-react';

export default function NewPersonDetectedModal({ people, characterId, characterName, onDone }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAction, setSelectedAction] = useState(null);
  const [customName, setCustomName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!people || people.length === 0) return null;

  const currentPerson = people[currentIndex];

  const handleSkip = () => {
    if (currentIndex < people.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setSelectedAction(null);
      setCustomName('');
    } else {
      onDone();
    }
  };

  const handleIgnoreAlways = async () => {
    setIsProcessing(true);
    try {
      // Optionally store in session storage or trigger backend ignore logic
      const ignoreList = JSON.parse(sessionStorage.getItem('ignoredMentions') || '[]');
      ignoreList.push(currentPerson.text.toLowerCase());
      sessionStorage.setItem('ignoredMentions', JSON.stringify(ignoreList));
    } catch (err) {
      console.warn('Failed to store ignore list:', err);
    } finally {
      setIsProcessing(false);
      handleSkip();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
      <Card className="w-full max-w-md rounded-t-2xl p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">New Person Detected</h3>
          <button onClick={onDone} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {characterName} mentioned <span className="font-semibold text-foreground">"{currentPerson.text}"</span>
          </p>
          <p className="text-xs text-muted-foreground">
            ({currentIndex + 1} of {people.length})
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => setSelectedAction('this_is_me')}
            className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <div className="font-semibold text-sm">This is me</div>
            <div className="text-xs text-muted-foreground">That's how people refer to you</div>
          </button>

          <button
            onClick={() => setSelectedAction('existing_character')}
            className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <div className="font-semibold text-sm">Link to existing character</div>
            <div className="text-xs text-muted-foreground">Pick from your character list</div>
          </button>

          <button
            onClick={() => setSelectedAction('new_person')}
            className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <div className="font-semibold text-sm">Add as new person</div>
            <div className="text-xs text-muted-foreground">Create a new NPC record</div>
          </button>

          <button
            onClick={() => setSelectedAction('just_alias')}
            className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <div className="font-semibold text-sm">Just an alias</div>
            <div className="text-xs text-muted-foreground">Alternative name for someone known</div>
          </button>

          <button
            onClick={handleIgnoreAlways}
            disabled={isProcessing}
            className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <div className="font-semibold text-sm">Always ignore this phrase</div>
            <div className="text-xs text-muted-foreground">Stop asking about it</div>
          </button>

          <button
            onClick={handleSkip}
            className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <div className="font-semibold text-sm">Skip once</div>
            <div className="text-xs text-muted-foreground">Decide later</div>
          </button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone} className="flex-1">
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
}