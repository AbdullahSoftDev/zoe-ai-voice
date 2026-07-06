// src/lib/firebase-service.ts
import { supabase } from '@/integrations/supabase/client';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, Auth } from 'firebase/auth';

let firebaseAuth: Auth | null = null;

/** Load Firebase credentials from Supabase and initialize */
async function initFirebase(): Promise<Auth | null> {
  const { data, error } = await supabase
    .from('firebase_config')
    .select('*')
    .limit(1)
    .single();
  
  if (error || !data) {
    console.error('[Firebase] No config found.');
    return null;
  }
  
  for (const app of getApps()) {
    await deleteApp(app);
  }
  
  const app = initializeApp({
    apiKey: data.api_key,
    authDomain: data.auth_domain,
    projectId: data.project_id,
    storageBucket: data.storage_bucket,
    messagingSenderId: data.messaging_sender_id,
    appId: data.app_id,
    measurementId: data.measurement_id,
  });
  
  firebaseAuth = getAuth(app);
  return firebaseAuth;
}

/** Sign in with Google */
export async function signInWithGoogle(): Promise<{ user?: any; error?: string }> {
  const auth = await initFirebase();
  if (!auth) {
    return { error: 'Firebase not configured.' };
  }
  
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  
  try {
    // Firebase sign-in
    const result = await signInWithPopup(auth, provider);
    const firebaseUser = result.user;
    
    console.log('[Firebase] ✅ User signed in:', firebaseUser.email);
    console.log('[Firebase] Firebase UID:', firebaseUser.uid);
    
    // ✅ STEP 1: Check if user exists in Supabase
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', firebaseUser.email)
      .maybeSingle();
    
    console.log('[Firebase] Existing user check:', existingUser);
    
    let supabaseUserId = existingUser?.id;
    
    // ✅ STEP 2: If user doesn't exist, create them in Supabase Auth
    if (!existingUser) {
      console.log('[Firebase] Creating user in Supabase Auth...');
      
      // Generate a random password for the user
      const randomPassword = Math.random().toString(36).slice(2) + '!@#' + Date.now();
      
      // Create user in Supabase Auth
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: firebaseUser.email!,
        password: randomPassword,
        options: {
          data: {
            full_name: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
          },
        },
      });
      
      if (signUpError) {
        console.error('[Firebase] Sign up error:', signUpError);
        
        // If user already exists, try to sign in
        if (signUpError.message.includes('already registered')) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithOtp({
            email: firebaseUser.email!,
          });
          
          if (signInError) {
            console.error('[Firebase] OTP sign-in error:', signInError);
          } else {
            console.log('[Firebase] ✅ OTP sent to:', firebaseUser.email);
            // Return user info and let login handle the rest
            return { user: { 
              uid: firebaseUser.uid, 
              email: firebaseUser.email, 
              displayName: firebaseUser.displayName,
              requiresOtp: true
            }};
          }
        }
        
        return { user: { 
          uid: firebaseUser.uid, 
          email: firebaseUser.email, 
          displayName: firebaseUser.displayName 
        }};
      }
      
      if (signUpData?.user) {
        supabaseUserId = signUpData.user.id;
        console.log('[Firebase] ✅ Supabase user created:', supabaseUserId);
      }
    }
    
    // ✅ STEP 3: Try to sign in the user to create a session
    if (supabaseUserId) {
      console.log('[Firebase] Attempting to create Supabase session...');
      
      // Try to sign in with password (we created one above)
      const password = Math.random().toString(36).slice(2) + '!@#' + Date.now();
      
      // Since we don't know the password, use OTP for passwordless sign-in
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: firebaseUser.email!,
      });
      
      if (otpError) {
        console.error('[Firebase] OTP error:', otpError);
        // Fallback: return user info without session
        return { user: { 
          uid: firebaseUser.uid, 
          email: firebaseUser.email, 
          displayName: firebaseUser.displayName 
        }};
      }
      
      console.log('[Firebase] ✅ OTP sent, user can sign in with email');
      
      // Wait a bit for the session to be established
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if session was created
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (session?.user) {
        console.log('[Firebase] ✅ Supabase session active for:', session.user.email);
        return { user: { 
          uid: session.user.id, 
          email: session.user.email, 
          displayName: session.user.user_metadata?.full_name || firebaseUser.displayName 
        }};
      } else {
        console.log('[Firebase] No session yet, user needs to verify OTP');
        return { user: { 
          uid: firebaseUser.uid, 
          email: firebaseUser.email, 
          displayName: firebaseUser.displayName,
          requiresOtp: true
        }};
      }
    }
    
    // ✅ STEP 4: Fallback - return Firebase user
    return { user: { 
      uid: firebaseUser.uid, 
      email: firebaseUser.email, 
      displayName: firebaseUser.displayName 
    }};
    
  } catch (error: any) {
    console.error('[Firebase] Sign in failed:', error);
    return { error: error.message || 'Failed to sign in with Google' };
  }
}

/** Sign out */
export async function signOutFromGoogle(): Promise<void> {
  if (firebaseAuth) {
    await firebaseAuth.signOut();
  }
}
