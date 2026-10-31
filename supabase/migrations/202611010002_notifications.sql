create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 ticket_id bigint not null references public.tickets(id) on delete cascade,
 kind text not null check(kind in ('new_ticket','handover')),
 title text not null, created_at timestamptz not null default now(), read_at timestamptz
);
create index notifications_recipient_recent on public.notifications(recipient_id,created_at desc);
create index notifications_recipient_unread on public.notifications(recipient_id) where read_at is null;
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated using(recipient_id=auth.uid() and public.is_technician());
create policy notifications_mark_read on public.notifications for update to authenticated using(recipient_id=auth.uid() and public.is_technician()) with check(recipient_id=auth.uid() and public.is_technician());
revoke all on public.notifications from public,anon,authenticated;
grant select,update(read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;
create function public.notify_ticket_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.notifications(recipient_id,ticket_id,kind,title)
 select id,new.id,'new_ticket',new.title from public.profiles
 where (role='admin' or (role='technician' and technician_status='approved')) and id<>new.requester_id;
 return new;
end $$;
create function public.notify_handover_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.notifications(recipient_id,ticket_id,kind,title)
 select new.recipient_id,new.ticket_id,'handover',t.title from public.tickets t where t.id=new.ticket_id;
 return new;
end $$;
revoke all on function public.notify_ticket_created(),public.notify_handover_created() from public,anon,authenticated;
create trigger ticket_created_notification after insert on public.tickets for each row execute function public.notify_ticket_created();
create trigger handover_created_notification after insert on public.handovers for each row execute function public.notify_handover_created();
create function public.notification_feed() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('unread_count',(select count(*) from public.notifications where recipient_id=auth.uid() and read_at is null),'items',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from (select id,ticket_id,kind,title,created_at,read_at from public.notifications where recipient_id=auth.uid() order by created_at desc,id desc limit 100) n),'[]'::jsonb))
$$;
create function public.read_notifications(p_id uuid default null) returns void language sql security invoker set search_path='' as $$
 update public.notifications set read_at=now() where recipient_id=auth.uid() and read_at is null and (p_id is null or id=p_id)
$$;
revoke all on function public.notification_feed(),public.read_notifications(uuid) from public,anon;
grant execute on function public.notification_feed(),public.read_notifications(uuid) to authenticated;
