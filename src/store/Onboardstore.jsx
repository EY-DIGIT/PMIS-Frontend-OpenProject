// ============================================================
// OnboardStore.jsx  –  Temporary draft state for the 2-step
//                      onboarding flow (Form → Config → Save)
// ============================================================
import { createContext, useContext, useState } from "react";

const OnboardContext = createContext(null);

export function OnboardProvider({ children }) {
  const [draft, setDraft] = useState(null);   // partial project object

  const clearDraft = () => setDraft(null);

  return (
    <OnboardContext.Provider value={{ draft, setDraft, clearDraft }}>
      {children}
    </OnboardContext.Provider>
  );
}

export const useOnboard = () => {
  const ctx = useContext(OnboardContext);
  if (!ctx) throw new Error("useOnboard must be inside <OnboardProvider>");
  return ctx;
};