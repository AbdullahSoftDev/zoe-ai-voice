// src/lib/firebase-service.ts
import { supabase } from '@/integrations/supabase/client';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, Auth, signInWithRedirect, getRedirectResult } from 'firebase/auth';

let firebaseAuth: Auth | null = null;

/** Load Firebase credentials from Supabase and initialize */
async function initFirebase(): Promise<Auth | null> {
  const { data, error } = await supabase
    .from('firebase_config')
    .select('*')
    .limit(1)
    .single();
  
  if (error || !data) {
    console.error('[Firebase] No config found. Create "firebase_config" table with credentials.');
    return null;
  }
  
  // Clean up existing apps
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

/** Sign in with Google using Popup (more reliable for SPA) */
export async function signInWithGoogle(): Promise<{ user?: any; error?: string }> {
  const auth = await initFirebase();
  if (!auth) {
    return { error: 'Firebase not configured. Add credentials to "firebase_config" table.' };
  }
  
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  
  try {
    // ✅ Use popup instead of redirect - more reliable for SPAs
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    console.log('[Firebase] ✅ User signed in:', user.email);
    console.log('[Firebase] User ID:', user.uid);
    
    // Check if user exists in Supabase, if not create them
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('email', user.email)
      .maybeSingle();
    
    console.log('[Firebase] Existing user check:', existingUser);
    
    if (!existingUser && !checkError) {
      // Create user in Supabase
      console.log('[Firebase] Creating user in Supabase...');
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: user.email!,
        password: crypto.randomUUID() + '!@#' + Date.now(),
        options: {
          data: {
            full_name: user.displayName,
          },
        },
      });
      
      if (signUpError) {
        console.error('[Firebase] Sign up error:', signUpError);
        // If user already exists, try to sign in
        if (signUpError.message.includes('already registered')) {
          // Try to sign in with passwordless
          const { error: signInError } = await supabase.auth.signInWithOtp({
            email: user.email!,
          });
          if (signInError) {
            console.error('[Firebase] Sign in error:', signInError);
          }
        }
      } else {
        console.log('[Firebase] ✅ User created in Supabase:', signUpData);
      }
    }
    
    // ✅ Get the Supabase session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('[Firebase] Session error:', sessionError);
      return { user: { uid: user.uid, email: user.email, displayName: user.displayName } };
    }
    
    if (session?.user) {
      console.log('[Firebase] ✅ Supabase session active for:', session.user.email);
      return { user: { 
        uid: session.user.id, 
        email: session.user.email, 
        displayName: session.user.user_metadata?.full_name || user.displayName 
      }};
    } else {
      // Return the Firebase user info - login will handle the rest
      return { user: { uid: user.uid, email: user.email, displayName: user.displayName } };
    }
    
  } catch (error: any) {
    console.error('[Firebase] Sign in failed:', error);
    return { error: error.message || 'Failed to sign in with Google' };
  }
}

/** Sign out from Firebase */
export async function signOutFromGoogle(): Promise<void> {
  if (firebaseAuth) {
    await firebaseAuth.signOut();
  }
}
