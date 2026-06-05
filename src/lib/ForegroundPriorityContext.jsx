import React, { createContext, useContext } from 'react';

const ForegroundPriorityContext = createContext({ foregroundPriority: false });

export function ForegroundPriorityProvider({ children }) {
  return (
    <ForegroundPriorityContext.Provider value={{ foregroundPriority: false }}>
      {children}
    </ForegroundPriorityContext.Provider>
  );
}

export function useForegroundPriority() {
  return useContext(ForegroundPriorityContext);
}