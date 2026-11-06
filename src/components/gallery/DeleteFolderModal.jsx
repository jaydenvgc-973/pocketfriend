import React from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";

/**
 * DeleteFolderModal — mandatory confirmation before a Media Gallery folder
 * (and the images it contains) is deleted. Nothing is deleted until the user
 * presses "Delete Folder". Cancel leaves the folder and its images untouched.
 */
export default function DeleteFolderModal({ folder, onCancel, onConfirm, isDeleting, error }) {
  if (!folder) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={isDeleting ? undefined : onCancel}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-xl max-w-md w-full p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-destructive/10">
            <Trash2 className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Delete {folder.name}'s Folder?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Are you sure you want to delete {folder.name}'s Media Gallery folder? All images
              contained in this folder will also be deleted. This action cannot be undone.
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2">
          {folder.imageCount} {folder.imageCount === 1 ? 'image' : 'images'} in this folder. Your
          character, conversations, and Story Events are not affected.
        </p>

        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isDeleting ? 'Deleting...' : 'Delete Folder'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}