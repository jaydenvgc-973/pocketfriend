import React, { useState, useRef } from "react";
import { Send, Mic, MicOff, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";

export default function ChatInput({ onSend, draftKey = "chat_draft_default" }) {
  const storageKey = `chat_draft_${draftKey}`;
  const [text, setText] = useState(() => localStorage.getItem(storageKey) || "");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleSend = () => {
    if (!text.trim() && !pendingImage) return;
    onSend(text.trim(), pendingImage);
    setText("");
    setPendingImage(null);
    localStorage.removeItem(storageKey);
  };

  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);
    if (val) {
      localStorage.setItem(storageKey, val);
    } else {
      localStorage.removeItem(storageKey);
    }
  };

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setPendingImage(file_url);
    setIsUploading(false);
    e.target.value = "";
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) return;
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      setText(prev => prev + event.results[0][0].transcript);
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  return (
    <div className="px-4 pb-4 pt-2">
      {pendingImage && (
        <div className="mb-2 ml-2 relative inline-block">
          <img src={pendingImage} alt="pending" className="h-16 w-16 rounded-xl object-cover border border-border" />
          <button
            onClick={() => setPendingImage(null)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-white text-[10px] flex items-center justify-center"
          >✕</button>
        </div>
      )}
      <div className="flex items-end gap-2 bg-secondary rounded-2xl p-2">
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageSelect} className="hidden" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          <ImagePlus className="w-4 h-4" />
        </Button>
        <textarea
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="Say something..."
          rows={1}
          className="flex-1 bg-transparent text-foreground text-sm resize-none outline-none px-1 py-2 max-h-32 placeholder:text-muted-foreground"
          style={{ minHeight: "40px" }}
        />
        <div className="flex items-center gap-1 pb-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleVoice}
            className={`h-9 w-9 rounded-full ${isRecording ? "text-destructive bg-destructive/10" : "text-muted-foreground hover:text-foreground"}`}
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>
          <motion.div whileTap={{ scale: 0.9 }}>
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!text.trim() && !pendingImage}
              className="h-9 w-9 rounded-full bg-primary hover:bg-primary/90"
            >
              <Send className="w-4 h-4" />
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}