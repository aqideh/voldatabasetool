import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppMember } from './types';

const MEMBER_LOOKUP_TIMEOUT_MS = 12_000;

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function loadMember(session: Session): Promise<AppMember | null> {
  const lookup = supabase
    .from('app_members')
    .select('user_id,role,active')
    .eq('user_id', session.user.id)
    .maybeSingle();

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('MakLom access check timed out. Please try again.')), MEMBER_LOOKUP_TIMEOUT_MS);
  });

  const { data, error } = await Promise.race([lookup, timeout]);

  if (error) throw error;
  return data as AppMember | null;
}
