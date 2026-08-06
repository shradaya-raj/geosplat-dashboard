import { createClient } from "@supabase/supabase-js";
import { APP_CONFIG, isSupabaseAuthEnabled } from "./config.js";

let supabaseClient;

export function getSupabaseClient() {
  if (!isSupabaseAuthEnabled()) return null;

  if (!supabaseClient) {
    supabaseClient = createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  return supabaseClient;
}

export async function getAccessToken() {
  const supabase = getSupabaseClient();
  if (!supabase) return "";

  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

export async function getBrowserSession() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) return null;

  const user = data.session.user;
  return {
    authenticated: true,
    mode: "supabase-browser",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.user_metadata?.full_name || user.user_metadata?.name || user.email
    }
  };
}

export async function signInWithEmail(email) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Secure sign-in is not configured.");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href
    }
  });

  if (error) throw error;
}

export async function signInWithPassword(email, password) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Secure sign-in is not configured.");

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;
}

export async function signUpWithPassword(email, password) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Secure sign-in is not configured.");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.href
    }
  });

  if (error) throw error;
}

export async function signOut() {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
