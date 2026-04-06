import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, Check, AlertCircle, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function RealLocationModal({ isOpen, onClose, onConfirm }) {
  const [locationName, setLocationName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [validationResult, setValidationResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState(null);

  const handleValidate = async () => {
    if (!locationName.trim() || !city.trim()) {
      setError('Location name and city required');
      return;
    }

    setIsValidating(true);
    setError(null);
    setValidationResult(null);

    try {
      const res = await base44.functions.invoke('validateRealLocation', {
        locationName: locationName.trim(),
        city: city.trim(),
        state: state.trim() || null,
      });

      if (!res.data.exists) {
        setError(res.data.message || 'Location not found');
        return;
      }

      if (!res.data.isOpen) {
        setError(res.data.message);
        setValidationResult(res.data);
        return;
      }

      // Location valid and open
      setValidationResult(res.data);
    } catch (err) {
      setError(err.message || 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleConfirm = () => {
    if (validationResult?.isOpen) {
      onConfirm({
        name: validationResult.name,
        address: validationResult.address,
        phone: validationResult.phone,
        website: validationResult.website,
      });
      resetForm();
    }
  };

  const resetForm = () => {
    setLocationName('');
    setCity('');
    setState('');
    setValidationResult(null);
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={resetForm}
        >
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4" /> Visit a Real Location
              </h3>
              <p className="text-xs text-muted-foreground">
                Enter the real business name and location. We'll verify it exists and is open now.
              </p>
            </div>

            {!validationResult ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Business Name</label>
                  <Input
                    placeholder="e.g., Ronnie's Bar"
                    value={locationName}
                    onChange={e => setLocationName(e.target.value)}
                    disabled={isValidating}
                    className="rounded-lg"
                    onKeyDown={e => e.key === 'Enter' && handleValidate()}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">City</label>
                    <Input
                      placeholder="Paterson"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      disabled={isValidating}
                      className="rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">State</label>
                    <Input
                      placeholder="NJ"
                      value={state}
                      onChange={e => setState(e.target.value)}
                      disabled={isValidating}
                      className="rounded-lg"
                      maxLength="2"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                )}

                <Button
                  onClick={handleValidate}
                  disabled={isValidating || !locationName.trim() || !city.trim()}
                  className="w-full rounded-lg gap-2"
                >
                  {isValidating ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Verify Location
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {validationResult.isOpen ? (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-400" />
                      <p className="text-sm font-semibold text-green-400">{validationResult.name}</p>
                    </div>
                    <p className="text-xs text-green-400/80">{validationResult.address}</p>
                    {validationResult.phone && (
                      <p className="text-xs text-green-400/70">{validationResult.phone}</p>
                    )}
                    <p className="text-xs text-green-400/60 font-medium">✓ Open now</p>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                      <p className="text-sm font-semibold text-amber-400">Can't visit right now</p>
                    </div>
                    <p className="text-xs text-amber-400">{validationResult.message}</p>
                    {validationResult.hours && (
                      <p className="text-xs text-amber-400/70">{validationResult.hours}</p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setValidationResult(null);
                      setError(null);
                    }}
                    variant="outline"
                    className="flex-1 rounded-lg"
                  >
                    Try Another
                  </Button>
                  {validationResult.isOpen && (
                    <Button
                      onClick={handleConfirm}
                      className="flex-1 rounded-lg gap-2"
                    >
                      <Check className="w-4 h-4" />
                      Go There
                    </Button>
                  )}
                </div>
              </div>
            )}

            <Button
              onClick={resetForm}
              variant="ghost"
              size="sm"
              className="w-full rounded-lg text-muted-foreground"
            >
              Cancel
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}