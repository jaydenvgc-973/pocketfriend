import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { MessageCircle, Gamepad2, Camera, MapPin, CalendarDays, Images, Newspaper, X, Wifi, BatteryFull } from "lucide-react";
import PocketMessageApp from "@/components/scene/phone/PocketMessageApp";
import PhoneGamesApp from "@/components/scene/phone/PhoneGamesApp";
import PhoneMapApp from "@/components/scene/phone/PhoneMapApp";
import PhoneCalendarApp from "@/components/scene/phone/PhoneCalendarApp";
import PhoneMediaGalleryApp from "@/components/scene/phone/PhoneMediaGalleryApp";
import PhoneNewsApp from "@/components/scene/phone/PhoneNewsApp";

// Pocketfriend's existing loading-screen image — the same asset the app's readiness
// screen (Onboarding) uses as its background. Never a generated replacement.
const LOADING_SCREEN_IMAGE =
  "https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/162a4b6d0_file_00000000e46471fb9edd54ccd1916ae3.png";

/**
 * OpenPhoneModal — the scene's phone.
 *
 * A presentation layer only: Pocket Message opens the established World Phone messaging,
 * Games opens the app's existing games, and Scene Photo closes the phone and opens the
 * Scene page's own photo modal. Map shows the existing Travel map and Calendar the existing
 * Moments calendar, both inside the phone. Media Gallery asks first, because opening it
 * leaves Scenes. Opening or closing the phone changes nothing about the scene.
 */
export default function OpenPhoneModal({
  currentUser,
  worldName = "You",
  locations = [],
  characters = [],
  allCharacters = [],
  userSettings = null,
  onOpenScenePhoto,
  onOpenMediaGallery,
  onClose,
}) {
  const [screen, setScreen] = useState("home");

  const clock = new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });

  const APPS = [
    { id: "messages", label: "Pocket Message", Icon: MessageCircle, tint: "from-[#9b6af1] to-[#6d3fc0]" },
    { id: "games", label: "Games", Icon: Gamepad2, tint: "from-emerald-400 to-emerald-700" },
    { id: "photo", label: "Scene Photo", Icon: Camera, tint: "from-sky-400 to-indigo-600" },
    { id: "map", label: "Map", Icon: MapPin, tint: "from-amber-400 to-orange-700" },
    { id: "calendar", label: "Calendar", Icon: CalendarDays, tint: "from-rose-400 to-rose-700" },
    { id: "gallery", label: "Media Gallery", Icon: Images, tint: "from-fuchsia-400 to-purple-700" },
    // News reads the existing The Weekly edition inside the phone — the same publication the
    // Home page shows, never a second feed and never a new edition.
    { id: "news", label: "News", Icon: Newspaper, tint: "from-stone-300 to-stone-600" },
  ];

  const openApp = (id) => {
    if (id === "photo") {
      onOpenScenePhoto?.();
      return;
    }
    setScreen(id);
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm px-3 py-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[340px] h-[min(88dvh,660px)] rounded-[2rem] border-[6px] border-zinc-800 bg-zinc-900 overflow-hidden shadow-2xl"
      >
        {/* Wallpaper: the app's own loading-screen image */}
        <img src={LOADING_SCREEN_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/45" />

        {/* Status bar */}
        <div className="relative z-10 flex items-center justify-between px-4 pt-2 text-[10px] text-white/85">
          <span>{clock}</span>
          <div className="flex items-center gap-1">
            <Wifi className="w-3 h-3" />
            <BatteryFull className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          title="Put the phone away"
          className="absolute z-20 top-6 right-2 p-1.5 rounded-full bg-black/40 text-white/80 hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Screen content */}
        <div className="relative z-10 h-[calc(100%-28px)] flex flex-col">
          {screen === "home" && (
            <div className="flex-1 flex flex-col justify-center px-5 pb-6">
              <div className="grid grid-cols-3 gap-4">
                {APPS.map(({ id, label, Icon, tint }) => (
                  <button key={id} onClick={() => openApp(id)} className="flex flex-col items-center gap-1.5 group">
                    <span className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${tint} flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                      <Icon className="w-6 h-6 text-white" />
                    </span>
                    <span className="text-[9px] font-medium text-white leading-tight text-center">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {screen === "messages" && (
            <PocketMessageApp
              currentUser={currentUser}
              worldName={worldName}
              onBack={() => setScreen("home")}
            />
          )}

          {screen === "games" && (
            <PhoneGamesApp
              currentUser={currentUser}
              onBack={() => setScreen("home")}
            />
          )}

          {screen === "map" && (
            <PhoneMapApp
              locations={locations}
              characters={characters}
              allCharacters={allCharacters}
              ownerEmail={currentUser?.email}
              onBack={() => setScreen("home")}
            />
          )}

          {screen === "calendar" && (
            <PhoneCalendarApp
              characters={characters}
              currentUser={currentUser}
              userSettings={userSettings}
              onBack={() => setScreen("home")}
            />
          )}

          {screen === "gallery" && (
            <PhoneMediaGalleryApp
              onBack={() => setScreen("home")}
              onCancel={() => setScreen("home")}
              onOkay={() => onOpenMediaGallery?.()}
            />
          )}

          {screen === "news" && (
            <PhoneNewsApp onBack={() => setScreen("home")} />
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}