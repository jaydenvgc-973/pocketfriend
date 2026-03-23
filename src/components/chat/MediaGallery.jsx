import { useState } from "react";
import { createPortal } from "react-dom";
import { Images, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function MediaGallery({ messages }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  const images = messages
    .filter(msg => msg.image_url)
    .map(msg => ({
      url: msg.image_url,
      senderType: msg.sender_type,
      senderName: msg.character_name || "You",
      timestamp: msg.timestamp,
    }));

  if (images.length === 0) return null;

  return (
    <>
      {/* Media button in header */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="View media"
      >
        <Images className="w-4 h-4" />
        {images.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
            {images.length}
          </span>
        )}
      </button>

      {/* Media modal */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
              onClick={() => setIsOpen(false)}
            >
              <div
                className="bg-card rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground">Media ({images.length})</h3>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-secondary rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {images.map((img, idx) => (
                      <motion.button
                        key={idx}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        onClick={() => setSelectedImage(img)}
                        className="group relative overflow-hidden rounded-xl aspect-square"
                      >
                        <img
                          src={img.url}
                          alt={`${img.senderName}'s photo`}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                            View
                          </span>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Full image viewer */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-4"
            onClick={() => setSelectedImage(null)}
          >
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {selectedImage.senderName} • {selectedImage.senderType === "user" ? "You" : "Them"}
              </p>
              <button
                onClick={() => setSelectedImage(null)}
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-foreground" />
              </button>
            </div>
            <img
              src={selectedImage.url}
              alt="Full view"
              className="max-w-full max-h-[90vh] object-contain rounded-xl"
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}