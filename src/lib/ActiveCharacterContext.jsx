import React, { createContext, useContext, useState } from "react";

const ActiveCharacterContext = createContext(null);

export function ActiveCharacterProvider({ children }) {
  const [activeCharacter, setActiveCharacter] = useState(null); // null = playing as user

  return (
    <ActiveCharacterContext.Provider value={{ activeCharacter, setActiveCharacter }}>
      {children}
    </ActiveCharacterContext.Provider>
  );
}

export function useActiveCharacter() {
  return useContext(ActiveCharacterContext);
}