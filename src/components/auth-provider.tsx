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

// ✅ Map Firebase UID to Supabase UUID
const USER_ID_MAP: Record<string, string> = {
  'tByYdsQj5Oer1HQYqFlb2B8tW3v1': 'f731942c-608d-4c45-9456-c1e43c0575a9',
  'rjVOLVbvDiblsMc1bOC9iwjV1NK2': 'f731942c-608d-4c45-9456-c1e43c0575a9',
};

function getSupabaseUserId(firebaseUid: string): string {
  return USER_ID_MAP[firebaseUid] || firebaseUid;
}

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
          // ✅ Use the UUID from the map if available
          const userId = getSupabaseUserId(session.user.id);
          
          setUser({
            id: userId,
            email: session.user.email || '',
            user_metadata: { 
              full_name: session.user.user_metadata?.full_name || 
                         session.user.email?.split('@')[0] || 
                         'User' 
            }
          });
          console.log('[Auth] ✅ Session restored for:', session.user.email, 'ID:', userId);
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
        const userId = getSupabaseUserId(session.user.id);
        setUser({
          id: userId,
          email: session.user.email || '',
          user_metadata: { 
            full_name: session.user.user_metadata?.full_name || 
                       session.user.email?.split('@')[0] || 
                       'User' 
          }
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = (email?: string, userId?: string) => {
    if (userId) {
      // ✅ Map Firebase UID to Supabase UUID
      const supabaseId = getSupabaseUserId(userId);
      console.log('[Auth] signIn - Firebase UID:', userId, '-> Supabase ID:', supabaseId);
      
      setUser({
        id: supabaseId,
        email: email || 'user@example.com',
        user_metadata: { full_name: email?.split('@')[0] || 'User' }
      });
    }
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
