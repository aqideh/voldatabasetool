import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppMember } from './types';

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function loadMember(session: Session): Promise<AppMember | null> {
  const { data, error } = await supabase
    .from('app_members')
    .select('user_id,role,active')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) throw error;
  return data as AppMember | null;
}
