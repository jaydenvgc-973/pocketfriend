import React, { useState, useRef } from "react";
import { Send, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export default function ChatInput({ onSend }) {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
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
      <div className="flex items-end gap-2 bg-secondary rounded-2xl p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Say something..."
          rows={1}
          className="flex-1 bg-transparent text-foreground text-sm resize-none outline-none px-3 py-2 max-h-32 placeholder:text-muted-foreground"
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
              disabled={!text.trim()}
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