-- ═══════════════════════════════════════════════════════════
--  Web Push — خشتەی ئەندامبوونەکان (push subscriptions)
--  دوای supabase_social.sql جێبەجێ بکە
-- ═══════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
create index if not exists push_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- هەرکەس تەنها ئەندامبوونی خۆی بەڕێوەدەبات
drop policy if exists "push read own" on public.push_subscriptions;
create policy "push read own" on public.push_subscriptions for select using (auth.uid() = user_id);
drop policy if exists "push insert own" on public.push_subscriptions;
create policy "push insert own" on public.push_subscriptions for insert with check (auth.uid() = user_id);
drop policy if exists "push delete own" on public.push_subscriptions;
create policy "push delete own" on public.push_subscriptions for delete using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
--  Trigger: کاتێک نامەیەکی تایبەت/داواکارییەک دروست دەبێت، Edge Function بانگ بکە
--  (فەنکشن بە --no-verify-jwt نێردراوە، بۆیە پێویست بە Authorization نییە)
-- ═══════════════════════════════════════════════════════════
create extension if not exists pg_net;

create or replace function public.notify_push()
returns trigger as $$
begin
  perform net.http_post(
    url := 'https://lrqlrbnuukijigrkporv.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('table', TG_TABLE_NAME, 'record', row_to_json(NEW))
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists dm_push_trigger on public.direct_messages;
create trigger dm_push_trigger after insert on public.direct_messages
  for each row execute function public.notify_push();

drop trigger if exists friend_push_trigger on public.friendships;
create trigger friend_push_trigger after insert on public.friendships
  for each row execute function public.notify_push();
