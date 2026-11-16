create or replace function public.get_flamexbot_daily_task_progress()
returns table(task_code text,current_progress integer,target_progress integer,completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_start timestamptz;
  v_end timestamptz;
  v_sent integer := 0;
  v_received integer := 0;
  v_chats integer := 0;
  v_streaks integer := 0;
  v_friends integer := 0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  v_start := v_today::timestamp at time zone 'UTC';
  v_end := (v_today+1)::timestamp at time zone 'UTC';

  select count(*)::integer into v_sent
  from public.flamexbot_business_messages m
  join public.flamexbot_business_chats c on c.id=m.business_chat_id
  where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;

  select count(*)::integer into v_received
  from public.flamexbot_business_messages m
  join public.flamexbot_business_chats c on c.id=m.business_chat_id
  where c.profile_id=v_uid and m.direction='inbound' and m.created_at>=v_start and m.created_at<v_end;

  select count(distinct m.business_chat_id)::integer into v_chats
  from public.flamexbot_business_messages m
  join public.flamexbot_business_chats c on c.id=m.business_chat_id
  where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;

  select count(*)::integer into v_streaks
  from public.streaks s
  where (s.user_low=v_uid or s.user_high=v_uid) and s.last_activity_date=v_today;

  select count(*)::integer into v_friends
  from public.friendships f
  where (f.user_low=v_uid or f.user_high=v_uid) and f.created_at>=v_start and f.created_at<v_end;

  return query
  select
    c.task_code,
    case c.task_code
      when 'send_message' then v_sent
      when 'receive_message' then v_received
      when 'keep_streak' then v_streaks
      when 'add_friend' then v_friends
      when 'send_three_messages' then v_sent
      when 'message_two_chats' then v_chats
      when 'receive_three_messages' then v_received
      when 'send_five_messages' then v_sent
      when 'keep_two_streaks' then v_streaks
      when 'message_three_chats' then v_chats
      else 0
    end,
    case c.task_code
      when 'send_message' then 1
      when 'receive_message' then 1
      when 'keep_streak' then 1
      when 'add_friend' then 1
      when 'send_three_messages' then 3
      when 'message_two_chats' then 2
      when 'receive_three_messages' then 3
      when 'send_five_messages' then 5
      when 'keep_two_streaks' then 2
      when 'message_three_chats' then 3
      else 1
    end,
    case c.task_code
      when 'send_message' then v_sent>=1
      when 'receive_message' then v_received>=1
      when 'keep_streak' then v_streaks>=1
      when 'add_friend' then v_friends>=1
      when 'send_three_messages' then v_sent>=3
      when 'message_two_chats' then v_chats>=2
      when 'receive_three_messages' then v_received>=3
      when 'send_five_messages' then v_sent>=5
      when 'keep_two_streaks' then v_streaks>=2
      when 'message_three_chats' then v_chats>=3
      else false
    end
  from private.get_flamexbot_daily_task_catalog() c
  where c.task_code=any(private.get_flamexbot_daily_task_codes())
  order by c.task_order;
end;
$$;

revoke all on function public.get_flamexbot_daily_task_progress() from public,anon;
grant execute on function public.get_flamexbot_daily_task_progress() to authenticated;

create or replace function private.mark_flamexbot_notification_read_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_at := coalesce(new.read_at,now());
  return new;
end;
$$;

drop trigger if exists flamexbot_auto_read_notifications on public.notifications;
create trigger flamexbot_auto_read_notifications
before insert on public.notifications
for each row execute function private.mark_flamexbot_notification_read_on_insert();

update public.notifications set read_at=now() where read_at is null;
