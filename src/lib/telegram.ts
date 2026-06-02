import { SupabaseClient } from '@supabase/supabase-js';

export interface TelegramProfile {
  id: number | string;
  telegram_id: number | string; // Supabase column
  username?: string;
  display_name: string;
  first_name: string;
  photo_url?: string;
  bankroll: number;
  wins: number;
  losses: number;
  games_played: number;
}

export async function initTelegramProfile(supabase: SupabaseClient): Promise<TelegramProfile | null> {
  try {
    let extractedUser: { id: number | string; first_name: string; username?: string; photo_url?: string } | null = null;
    
    // Check if running inside Telegram WebApp
    if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
      extractedUser = window.Telegram.WebApp.initDataUnsafe.user;
      try { window.Telegram.WebApp.ready(); } catch(e){}
    } else {
      // Stable Dev Mock Fallback
      extractedUser = { 
        id: 100000001, 
        first_name: 'Dev_Player',
        username: 'dev_hero'
      };
    }

    if (!extractedUser) return null;

    // Supabase Upsert logic: Ensure user exists and get their latest profile data
    const displayName = extractedUser.first_name || 'Player';
    
    // We try to insert if not exists, but on conflict we just read the data
    const { data: upsertData, error: upsertError } = await supabase
      .from('users')
      .upsert({
        telegram_id: extractedUser.id,
        username: extractedUser.username,
        display_name: displayName,
        photo_url: extractedUser.photo_url
        // bankroll, wins, losses, games_played use DB DEFAULTs on insert, preserved on update
      }, { onConflict: 'telegram_id', ignoreDuplicates: true })
      .select()
      .single();

    // If upsert with ignoreDuplicates works, we might not get data back if it already existed and was ignored.
    // So we fetch the fresh record explicitly.
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', extractedUser.id)
      .single();

    if (fetchError || !existingUser) {
      console.error("Failed to fetch user profile", fetchError);
      return null;
    }

    return {
      id: existingUser.telegram_id,
      telegram_id: existingUser.telegram_id,
      username: existingUser.username,
      display_name: existingUser.display_name,
      first_name: existingUser.display_name,
      photo_url: existingUser.photo_url,
      bankroll: existingUser.bankroll,
      wins: existingUser.wins,
      losses: existingUser.losses,
      games_played: existingUser.games_played
    };

  } catch (err) {
    console.error("Auth init error", err);
    return null;
  }
}
