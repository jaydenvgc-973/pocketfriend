import React, { useEffect } from 'react';

/**
 * FittingRoomZoneSwitcher
 * 
 * Automatically switches user to the Fitting Room zone when "Try something on" is selected.
 * Must happen consistently - no failures.
 * 
 * Usage:
 * <FittingRoomZoneSwitcher 
 *   isActive={userSelectedTrySomethingOn}
 *   location={currentLocation}
 *   onZoneSwitch={(zone) => {}}
 * />
 */

export default function FittingRoomZoneSwitcher({ isActive, location, onZoneSwitch }) {
  useEffect(() => {
    if (!isActive || !location) return;

    // Guaranteed to find or create fitting room zone
    const fittingRoomZone = location.zones?.find(z => 
      z.zone_name.toLowerCase().includes('fitting') || z.zone_name.toLowerCase().includes('room')
    );

    if (fittingRoomZone) {
      // Switch zone immediately
      onZoneSwitch?.(fittingRoomZone);
      console.log('[FittingRoomZoneSwitcher] Switched to Fitting Room:', fittingRoomZone.zone_name);
    } else {
      // Fallback: if no fitting room exists, create it in UI context
      const defaultFittingRoom = {
        zone_name: 'Fitting Room',
        image_urls: [],
      };
      onZoneSwitch?.(defaultFittingRoom);
      console.log('[FittingRoomZoneSwitcher] Created default Fitting Room zone');
    }
  }, [isActive, location, onZoneSwitch]);

  return null; // This component has no visual output
}