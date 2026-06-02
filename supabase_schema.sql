-- Run these queries in the Supabase REST/SQL Editor to set up the DB

CREATE TABLE IF NOT EXISTS public.users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  display_name TEXT NOT NULL,
  bankroll INT NOT NULL DEFAULT 1000,
  photo_url TEXT,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  games_played INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rooms (
  room_id VARCHAR(6) PRIMARY KEY,
  host_id BIGINT REFERENCES public.users(telegram_id),
  status VARCHAR(20) NOT NULL CHECK (status IN ('waiting', 'playing', 'finished')),
  players JSONB NOT NULL DEFAULT '[]'::JSONB,
  game_state JSONB
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for development (adjust for production)
CREATE POLICY "Allow anonymous select on users" ON public.users FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anonymous insert on users" ON public.users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anonymous update on users" ON public.users FOR UPDATE TO anon USING (true);

CREATE POLICY "Allow anonymous select on rooms" ON public.rooms FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anonymous insert on rooms" ON public.rooms FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anonymous update on rooms" ON public.rooms FOR UPDATE TO anon USING (true);
