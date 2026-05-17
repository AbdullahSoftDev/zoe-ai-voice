import { createContext, useContext, useState } from "react";

/**
 * UI-only auth stub. The user will wire real auth (Supabase / Firebase)
 * later. Pages can keep importing { useAuth } unchanged.
 */
type DemoUser = {
  email: string;
  user_metadata: { full_name?: string };
};

type Ctx = {
  user: DemoUser | null;
  loading: boolean;
  signIn: (email?: string) => void;
  signOut: () => void;
};

const AuthCtx = createContext<Ctx>({
  user: null,
  loading: false,
  signIn: () => {},
  signOut: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // UI-only auth stub: start signed-out so Sign in button shows correctly.
  const [user, setUser] = useState<DemoUser | null>(null);

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading: false,
        signIn: (email = "demo@zoe.app") =>
          setUser({ email, user_metadata: { full_name: email.split("@")[0] } }),
        signOut: () => setUser(null),
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
