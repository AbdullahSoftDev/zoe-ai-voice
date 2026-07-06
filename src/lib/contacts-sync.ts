// Device contacts sync to Supabase
import { supabase } from '@/integrations/supabase/client';

export interface Contact {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
}

// Check if running in Capacitor/Cordova mobile environment
const isMobileApp = (): boolean => {
  return typeof (window as any).Capacitor !== 'undefined' || 
         typeof (window as any).cordova !== 'undefined';
};

/** Get all contacts from Supabase for the current user */
export async function getAllContacts(): Promise<Contact[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.log('[Contacts] No user found, returning empty array');
    return [];
  }
  
  console.log('[Contacts] Fetching contacts for user:', user.id);
  
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, email')
    .eq('user_id', user.id)
    .order('name', { ascending: true });
  
  if (error) {
    console.error('[Contacts] Get all failed:', error);
    return [];
  }
  
  console.log('[Contacts] Fetched', data?.length || 0, 'contacts');
  return data || [];
}

/** Request device contacts permission and sync to Supabase */
export async function syncDeviceContacts(): Promise<{ success: boolean; count: number; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.id) {
    return { success: false, count: 0, error: 'Not logged in' };
  }
  
  // For web demo - return existing contacts from database
  if (!isMobileApp()) {
    console.log('[Contacts] Web mode - using database contacts');
    const contacts = await getAllContacts();
    return { success: true, count: contacts.length };
  }
  
  // For real mobile app - dynamically import Capacitor plugin
  try {
    const { Contacts } = await import('@capacitor-community/contacts');
    const permission = await Contacts.requestPermissions();
    
    if (permission.contacts !== 'granted') {
      return { success: false, count: 0, error: 'Contacts permission denied' };
    }
    
    const result = await Contacts.getContacts({
      projection: {
        name: true,
        phones: true,
        emails: true,
      },
    });
    
    const contacts: Contact[] = result.contacts.map((c: any) => ({
      name: c.name?.display || c.name?.given || 'Unknown',
      phone: c.phones?.[0]?.number,
      email: c.emails?.[0]?.address,
    }));
    
    let syncedCount = 0;
    for (const contact of contacts) {
      if (!contact.phone && !contact.email) continue;
      
      // ✅ Use insert instead of upsert to avoid conflict issues
      const { error } = await supabase
        .from('contacts')
        .insert({
          user_id: user.id,
          name: contact.name,
          phone: contact.phone || null,
          email: contact.email || null,
          synced_from_device: true,
          created_at: new Date().toISOString(),
        });
      
      if (error) {
        // If duplicate, ignore and continue
        if (error.code === '23505') { // unique violation
          console.log('[Contacts] Duplicate contact skipped:', contact.name);
          continue;
        }
        console.error('[Contacts] Insert error:', error);
      } else {
        syncedCount++;
      }
    }
    
    await supabase
      .from('users')
      .update({ contacts_synced: true })
      .eq('id', user.id);
    
    return { success: true, count: syncedCount };
    
  } catch (error) {
    console.error('[Contacts] Sync failed:', error);
    // Return existing contacts from database
    const contacts = await getAllContacts();
    return { success: true, count: contacts.length };
  }
}

/** Search contacts by name or phone number */
export async function searchContacts(query: string): Promise<Contact[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, email')
    .eq('user_id', user.id)
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`)
    .limit(20);
  
  if (error) {
    console.error('[Contacts] Search failed:', error);
    return [];
  }
  
  return data || [];
}

/** Add a single contact manually */
export async function addContact(name: string, phone?: string, email?: string): Promise<Contact | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      user_id: user.id,
      name,
      phone: phone || null,
      email: email || null,
      synced_from_device: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  if (error) {
    console.error('[Contacts] Add failed:', error);
    return null;
  }
  
  return data;
}

/** Get contacts with pagination */
export async function getContactsPaginated(page: number = 0, limit: number = 50): Promise<Contact[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  
  const from = page * limit;
  const to = from + limit - 1;
  
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, email')
    .eq('user_id', user.id)
    .order('name', { ascending: true })
    .range(from, to);
  
  if (error) {
    console.error('[Contacts] Get paginated failed:', error);
    return [];
  }
  
  return data || [];
}