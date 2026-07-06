// Firebase Google Sign-In - fetches credentials from Supabase
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

/** Sign in with Google Popup */
export async function signInWithGoogle(): Promise<{ user?: any; error?: string }> {
  const auth = await initFirebase();
  if (!auth) {
    return { error: 'Firebase not configured. Add credentials to "firebase_config" table.' };
  }
  
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    // Check if user exists in Supabase, if not create them
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', user.email)
      .single();
    
    if (!existingUser) {
      // Create user in Supabase
      await supabase.auth.signUp({
        email: user.email!,
        password: crypto.randomUUID(),
        options: {
          data: {
            full_name: user.displayName,
          },
        },
      });
    }
    
    return { user: { uid: user.uid, email: user.email, displayName: user.displayName } };
    
  } catch (error: any) {
    console.error('[Firebase] Sign in failed:', error);
    return { error: error.message };
  }
}

/** Sign out from Firebase */
export async function signOutFromGoogle(): Promise<void> {
  if (firebaseAuth) {
    await firebaseAuth.signOut();
  }
}