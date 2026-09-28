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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEMBER_LOOKUP_TIMEOUT_MS);

  try {
    const { data, error } = await supabase
      .from('app_members')
      .select('user_id,role,active')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .abortSignal(controller.signal);

    if (error) throw error;
    return data as AppMember | null;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('MakLom access check timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
