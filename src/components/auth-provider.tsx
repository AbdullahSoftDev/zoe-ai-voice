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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        // ✅ Get session from Supabase
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[Auth] Session error:', error);
          setLoading(false);
          return;
        }
        
        console.log('[Auth] Session check:', session?.user?.email);
        console.log('[Auth] Session user ID:', session?.user?.id);
        
        if (session?.user) {
          // ✅ Use the REAL user ID from Supabase
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            user_metadata: { 
              full_name: session.user.user_metadata?.full_name || 
                         session.user.email?.split('@')[0] || 
                         'User' 
            }
          });
          console.log('[Auth] ✅ Session restored for:', session.user.email, 'ID:', session.user.id);
        } else {
          console.log('[Auth] No session found');
        }
      } catch (error) {
        console.error('[Auth] Session check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] Auth state changed:', event);
      
      if (session?.user) {
        setUser({
          id: session.user.id,
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
    console.log('[Auth] signIn called with ID:', userId);
    if (userId) {
      setUser({
        id: userId,
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
