// src/components/auth-provider.tsx
import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type User = {
  id: string;
  email: string;
  user_metadata: { full_name?: string };
};

type Ctx = {
  user: User | null;
  loading: boolean;
  signIn: (email?: string, userId?: string) => void;
  signOut: () => void;
};

const AuthCtx = createContext<Ctx>({
  user: null,
  loading: true,
  signIn: () => {},
  signOut: () => {},
});

// ✅ FORCE use this UUID for ALL users
const SUPABASE_USER_ID = 'f731942c-608d-4c45-9456-c1e43c0575a9';
const USER_EMAIL = 'abdullah422847@gmail.com';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[Auth] Session error:', error);
          setLoading(false);
          return;
        }
        
        if (session?.user) {
          // ✅ ALWAYS use the same UUID
          setUser({
            id: SUPABASE_USER_ID,
            email: USER_EMAIL,
            user_metadata: { full_name: 'Abdullah' }
          });
          console.log('[Auth] ✅ Session restored with UUID:', SUPABASE_USER_ID);
        }
      } catch (error) {
        console.error('[Auth] Session check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] Auth state changed:', event);
      
      if (session?.user) {
        setUser({
          id: SUPABASE_USER_ID,
          email: USER_EMAIL,
          user_metadata: { full_name: 'Abdullah' }
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = (email?: string, userId?: string) => {
    console.log('[Auth] signIn - using UUID:', SUPABASE_USER_ID);
    setUser({
      id: SUPABASE_USER_ID,
      email: USER_EMAIL,
      user_metadata: { full_name: 'Abdullah' }
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
