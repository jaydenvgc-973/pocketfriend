import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import { motion } from "framer-motion";
import BottomNav from "@/components/BottomNav";

export default function Groups() {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold">Groups</h2>
      </div>
      <div className="max-w-lg mx-auto px-6 py-6">
        <Link to="/group-chat">
          <motion.div
            whileTap={{ scale: 0.98 }}
            className="border border-border rounded-2xl p-6 flex items-center gap-4 cursor-pointer hover:border-primary/30 transition-colors bg-card"
          >
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">New Group Chat</p>
              <p className="text-xs text-muted-foreground mt-0.5">Get multiple characters talking</p>
            </div>
          </motion.div>
        </Link>
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}