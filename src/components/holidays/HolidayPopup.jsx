import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { getHolidayForDate, getHolidayEmotionalThemes } from '@/lib/holidayCalendar';
import { hasAcknowledgedHoliday, acknowledgeHoliday } from '@/lib/holidayState';

export default function HolidayPopup({ isEnabled = true, onClose }) {
  const [holiday, setHoliday] = useState(null);
  const [showPopup, setShowPopup] = useState(false);
  const [checked, setChecked] = useState(false); // Track if we've already checked today

  useEffect(() => {
    if (!isEnabled || checked) {
      setShowPopup(false);
      return;
    }

    // Mark that we've checked so we don't re-run on every render
    setChecked(true);

    const now = new Date();
    const currentHoliday = getHolidayForDate(now);
    const currentYear = now.getFullYear();

    if (currentHoliday && !hasAcknowledgedHoliday(currentHoliday.id, currentYear, localStorage)) {
      setHoliday(currentHoliday);
      setShowPopup(true);
    }
  }, [isEnabled, checked]);

  const handleDismiss = () => {
    if (holiday) {
      const year = new Date().getFullYear();
      acknowledgeHoliday(holiday.id, year, localStorage);
    }
    setShowPopup(false);
    if (onClose) onClose();
  };

  if (!showPopup || !holiday) return null;

  const themes = getHolidayEmotionalThemes(holiday);
  const themeText = themes.slice(0, 2).join(', ');

  return createPortal(
    <AnimatePresence>
      {showPopup && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-full max-w-md bg-card border border-border rounded-2xl p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-foreground">
                  {holiday.name}
                </h2>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {holiday.type === 'federal' ? 'Federal Holiday' : holiday.type === 'religious' ? 'Religious Observance' : 'Cultural Observance'}
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                The world is observing <strong>{holiday.name}</strong>. Schedules, gatherings, closures, and character behaviors may be affected.
              </p>

              {holiday.closures.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1">Closures:</p>
                  <p className="text-xs">
                    {holiday.closures.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')}
                    {' '}
                    may be closed or have modified hours.
                  </p>
                </div>
              )}

              {themeText && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1">Emotional Themes:</p>
                  <p className="text-xs capitalize">{themeText}</p>
                </div>
              )}

              <p className="text-xs italic">
                {holiday.id === 'easter'
                  ? "Some characters may attend church, gather with family, celebrate at home, or observe quietly—depending on faith, mood, and plans."
                  : "Some characters may celebrate, others may work, volunteer, grieve, or isolate. Participate authentically."}
              </p>
            </div>

            <Button
              onClick={handleDismiss}
              className="w-full rounded-xl"
            >
              Got it
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}