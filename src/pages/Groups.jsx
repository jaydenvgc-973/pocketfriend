import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Users } from "lucide-react";
import { motion } from "framer-motion";

export default function Groups() {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold">Group Chats</h2>
      </div>
      <div className="max-w-lg mx-auto px-6 py-6">
        <Link to="/group-chat">
          <motion.div
            whileTap={{ scale: 0.98 }}
            className="border-2 border-dashed border-border rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/30 transition-colors"
          >
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Start a Group Chat</p>
            <p className="text-xs text-muted-foreground mt-1">Pick characters to chat together</p>
          </motion.div>
        </Link>
      </div>
    </div>
  );
}