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
