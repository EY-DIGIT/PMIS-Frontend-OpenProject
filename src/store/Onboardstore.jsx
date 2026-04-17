// ============================================================
// OnboardStore.jsx  –  Temporary draft state for the 2-step
//                      onboarding flow (Form → Config → Save)
// ============================================================
import { createContext, useContext, useState } from "react";

const OnboardContext = createContext(null);

export function OnboardProvider({ children }) {
  const [draft,    setDraft   ] = useState(null);   // partial project object
  const [category, setCategory] = useState(null);   // "MSAP" | "MSIP" | "BSP" …

  const clearDraft = () => { setDraft(null); setCategory(null); };

  return (
    <OnboardContext.Provider value={{ draft, setDraft, category, setCategory, clearDraft }}>
      {children}
    </OnboardContext.Provider>
  );
}

export const useOnboard = () => {
  const ctx = useContext(OnboardContext);
  if (!ctx) throw new Error("useOnboard must be inside <OnboardProvider>");
  return ctx;
};