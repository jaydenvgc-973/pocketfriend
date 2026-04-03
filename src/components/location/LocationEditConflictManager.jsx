import React, { createContext, useState, useContext } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AlertCircle } from 'lucide-react';

const LocationEditContext = createContext();

export function LocationEditProvider({ children }) {
  const [editingLocationId, setEditingLocationId] = useState(null);
  const [editingLocationName, setEditingLocationName] = useState(null);
  const [conflictDialog, setConflictDialog] = useState(null);
  const [pendingEditCallback, setPendingEditCallback] = useState(null);

  const canEdit = (locationId, locationName) => {
    if (!editingLocationId) {
      setEditingLocationId(locationId);
      setEditingLocationName(locationName);
      return true;
    }

    if (editingLocationId === locationId) {
      return true;
    }

    // Conflict: another location is being edited
    setConflictDialog({
      currentLocation: editingLocationName,
      attemptedLocation: locationName,
    });

    setPendingEditCallback(() => () => {
      // User will decide to save/cancel first location
    });

    return false;
  };

  const finishEdit = (locationId) => {
    if (editingLocationId === locationId) {
      setEditingLocationId(null);
      setEditingLocationName(null);
    }
  };

  const handleConflictResolve = (action) => {
    // User must save or cancel current edit before starting a new one
    setConflictDialog(null);
    if (action === 'current') {
      // Stay with current edit - don't start new one
    } else if (action === 'cancel') {
      // Cancel current edit and allow new one
      finishEdit(editingLocationId);
    }
  };

  return (
    <LocationEditContext.Provider value={{ editingLocationId, canEdit, finishEdit }}>
      {children}

      {conflictDialog && (
        <AlertDialog open={!!conflictDialog} onOpenChange={(open) => !open && setConflictDialog(null)}>
          <AlertDialogContent>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              Location Already Being Edited
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                "{conflictDialog.currentLocation}" is currently being edited. You cannot edit multiple locations at the same time.
              </p>
              <p className="font-medium">
                You're trying to edit: "{conflictDialog.attemptedLocation}"
              </p>
              <p className="text-sm text-muted-foreground">
                Please save or cancel the current edit first.
              </p>
            </AlertDialogDescription>
            <div className="flex gap-2 justify-end">
              <AlertDialogCancel>Stay with Current Edit</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleConflictResolve('cancel')}
                className="bg-amber-600 hover:bg-amber-700"
              >
                Cancel Current Edit
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </LocationEditContext.Provider>
  );
}

export function useLocationEditConflict() {
  const context = useContext(LocationEditContext);
  if (!context) {
    throw new Error('useLocationEditConflict must be used within LocationEditProvider');
  }
  return context;
}