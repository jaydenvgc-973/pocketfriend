import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Trash2,
  Wind,
  Droplets,
  UtensilsCrossed,
  Hammer,
  Package,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const HOME_ACTIONS = {
  empty: [
    { id: 'inspect', label: 'Inspect damage', icon: Hammer, color: 'text-orange-400' },
    { id: 'clean', label: 'Clean up', icon: Sparkles, color: 'text-blue-400' },
    { id: 'air_out', label: 'Air out rooms', icon: Wind, color: 'text-cyan-400' },
    { id: 'throw_out', label: 'Remove trash', icon: Trash2, color: 'text-red-400' },
    { id: 'discuss', label: 'Discuss the place', icon: 'MessageCircle', color: 'text-purple-400' },
  ],
  occupied_owned: [
    { id: 'clean', label: 'Clean up', icon: Sparkles, color: 'text-blue-400' },
    { id: 'organize', label: 'Organize', icon: Package, color: 'text-amber-400' },
    { id: 'cook', label: 'Cook', icon: UtensilsCrossed, color: 'text-orange-400' },
    { id: 'decorate', label: 'Decorate', icon: Palette, color: 'text-pink-400' },
    { id: 'unpack', label: 'Unpack', icon: Package, color: 'text-cyan-400' },
  ],
  occupied_visiting: [
    { id: 'help_clean', label: 'Help clean', icon: Sparkles, color: 'text-blue-400' },
    { id: 'relax', label: 'Relax', icon: Wind, color: 'text-cyan-400' },
    { id: 'use_fridge', label: 'Check fridge', icon: Droplets, color: 'text-blue-300' },
  ],
};

export default function HomeActionOptions({
  location,
  isOwned = false,
  isOccupied = false,
  onActionSelect,
  isLoading = false,
}) {
  const actionType = !isOccupied ? 'empty' : (isOwned ? 'occupied_owned' : 'occupied_visiting');
  const actions = HOME_ACTIONS[actionType] || [];

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        What would you like to do?
      </p>
      <div className="grid grid-cols-2 gap-2">
        {actions.map(action => {
          const Icon = action.icon;
          return (
            <motion.button
              key={action.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onActionSelect(action.id)}
              disabled={isLoading}
              className="p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary hover:border-primary/40 transition-all disabled:opacity-50"
            >
              <Icon className={`w-4 h-4 ${action.color} mx-auto mb-1.5`} />
              <p className="text-xs font-medium text-foreground text-center">{action.label}</p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}