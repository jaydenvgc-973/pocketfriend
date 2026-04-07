import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, Check, AlertCircle, Loader, ChevronRight, Clock, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORY_EMOJI = {
  food_drink: '🍽️', gym: '🏋️', social: '🎭', outdoor: '🌳',
  medical: '🏥', grocery: '🛒', education: '🏫', business: '🏢',
  religion: '🛐', public: '🏛️', generic: '📍',
};

export default function RealLocationModal({ isOpen, onClose, onConfirm }) {
  const [locationName, setLocationName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [status, setStatus] = useState(null); // null | 'searching' | 'verified' | 'needs_confirmation' | 'not_found' | 'error'
  const [result, setResult] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);

  const reset = () => {
    setLocationName('');
    setCity('');
    setState('');
    setStatus(null);
    setResult(null);
    setCandidates([]);
    setErrorMsg(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSearch = async () => {
    if (!locationName.trim() || !city.trim()) {
      setErrorMsg('Location name and city are required.');
      return;
    }
    setStatus('searching');
    setErrorMsg(null);
    setResult(null);
    setCandidates([]);

    const res = await base44.functions.invoke('validateRealLocation', {
      locationName: locationName.trim(),
      city: city.trim(),
      state: state.trim() || null,
    });

    const data = res.data;

    if (data.error) {
      setStatus('error');
      setErrorMsg(data.error);
      return;
    }

    if (data.status === 'verified') {
      setResult(data.place);
      setStatus('verified');
    } else if (data.status === 'needs_confirmation') {
      setCandidates(data.candidates || []);
      setStatus('needs_confirmation');
    } else {
      setStatus('not_found');
      setErrorMsg(data.message || 'Location not found. Try adjusting the name or city.');
    }
  };

  const handleConfirmCandidate = async (candidate) => {
    setStatus('searching');
    setErrorMsg(null);

    const res = await base44.functions.invoke('validateRealLocation', {
      locationName: locationName.trim(),
      city: city.trim(),
      state: state.trim() || null,
      confirmOsmId: candidate.osm_id,
    });

    const data = res.data;
    if (data.status === 'verified') {
      setResult(data.place);
      setStatus('verified');
    } else {
      setStatus('error');
      setErrorMsg(data.error || 'Failed to confirm location.');
    }
  };

  const handleGoThere = () => {
    if (result) {
      onConfirm({
        name: result.name,
        address: result.address,
        latitude: result.latitude,
        longitude: result.longitude,
        category: result.category,
        hours: result.hours,
        verifiedLocationId: result.id,
      });
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
        onClick={handleClose}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" /> Visit a Real Location
            </h3>
            <p className="text-xs text-muted-foreground">
              Search for a real-world place using open map data.
            </p>
          </div>

          {/* Search form — always visible unless verified */}
          {status !== 'verified' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Business Name</label>
                <Input
                  placeholder="e.g. Ronny's Liquors & Bar"
                  value={locationName}
                  onChange={e => setLocationName(e.target.value)}
                  disabled={status === 'searching'}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-3">
                  <label className="text-xs text-muted-foreground block mb-1">City</label>
                  <Input
                    placeholder="Paterson"
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    disabled={status === 'searching'}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground block mb-1">State</label>
                  <Input
                    placeholder="NJ"
                    value={state}
                    onChange={e => setState(e.target.value)}
                    disabled={status === 'searching'}
                    maxLength={2}
                  />
                </div>
              </div>
              <Button
                onClick={handleSearch}
                disabled={status === 'searching' || !locationName.trim() || !city.trim()}
                className="w-full gap-2"
              >
                {status === 'searching' ? (
                  <><Loader className="w-4 h-4 animate-spin" /> Searching...</>
                ) : (
                  <><Search className="w-4 h-4" /> Search</>
                )}
              </Button>
            </div>
          )}

          {/* Error / not found */}
          {(status === 'not_found' || status === 'error') && errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{errorMsg}</p>
            </div>
          )}

          {/* Candidate picker */}
          {status === 'needs_confirmation' && candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                Multiple matches found — pick the right one:
              </p>
              {candidates.map(c => (
                <button
                  key={c.osm_id}
                  onClick={() => handleConfirmCandidate(c)}
                  className="w-full text-left p-3 rounded-xl bg-secondary border border-border hover:border-primary/40 transition-all space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <span>{CATEGORY_EMOJI[c.category] || '📍'}</span>
                      {c.name}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">{c.address}</p>
                  {c.osm_type && (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">
                      {c.osm_type.replace(/_/g, ' ')}
                    </span>
                  )}
                </button>
              ))}
              <p className="text-[10px] text-muted-foreground text-center pt-1">
                Not the right place? Try refining your search above.
              </p>
            </div>
          )}

          {/* Verified result */}
          {status === 'verified' && result && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30 space-y-2">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-400" />
                  <p className="text-sm font-semibold text-green-400">
                    {CATEGORY_EMOJI[result.category] || '📍'} {result.name}
                  </p>
                </div>
                <p className="text-xs text-green-400/80">{result.address}</p>
                {result.hours && (
                  <p className="text-xs text-green-400/70 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {result.hours}
                  </p>
                )}
                {!result.image_url && (
                  <p className="text-xs text-green-400/50 flex items-center gap-1">
                    <Image className="w-3 h-3" /> No photo yet — you can add one from the Locations tab
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setStatus(null); setResult(null); }}>
                  Try Another
                </Button>
                <Button className="flex-1 gap-2" onClick={handleGoThere}>
                  <Check className="w-4 h-4" /> Go There
                </Button>
              </div>
            </div>
          )}

          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleClose}>
            Cancel
          </Button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}