import { createContext, useContext, type ReactNode } from "react";

const ShadowFeatures = createContext({ customShadows: true });
export function ShadowFeaturesProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <ShadowFeatures.Provider value={{ customShadows: enabled }}>
      {children}
    </ShadowFeatures.Provider>
  );
}
export const useShadowFeatures = () => useContext(ShadowFeatures);
