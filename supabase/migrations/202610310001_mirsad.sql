-- Mirsad: single-workspace production schema. All public writes go through authorized RPCs.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null check (char_length(full_name) between 1 and 60),
 department text not null default '', employee_id text not null default '', specialty text not null default '',
 role text not null default 'user' check(role in ('user','technician','admin')),
 requested_role text not null default 'user' check(requested_role in ('user','technician')),
 technician_status text not null default 'not_requested' check(technician_status in ('not_requested','pending','approved','rejected')),
 created_at timestamptz not null default now()
);
create table public.ticket_counter (singleton boolean primary key default true check(singleton), next_number bigint not null default 1);
insert into public.ticket_counter(singleton) values(true);
create table public.tickets (
 id bigint primary key,
 requester_id uuid not null references public.profiles(id), owner_id uuid references public.profiles(id),
 title text not null check(char_length(title) between 1 and 100),
 category text not null check(category in ('hardware','networks','software','accounts')),
 location text not null check(char_length(location) between 1 and 90),
 description text not null check(char_length(description) between 1 and 2500),
 status text not null default 'new' check(status in ('new','in_progress','pending_handover','completed')),
 priority text check(priority in ('high','medium','low')), priority_state text not null default 'pending' check(priority_state in ('pending','processing','ready','failed')),
 priority_reason text, ai_summary text, ai_error text,
 ai_job uuid, ai_started_at timestamptz, ai_attempts integer not null default 0,
 client_request_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(requester_id,client_request_id)
);
create table public.ticket_tasks (
 id uuid primary key default gen_random_uuid(), ticket_id bigint not null references public.tickets(id) on delete cascade,
 text text not null check(char_length(text) between 1 and 180), done boolean not null default false, created_at timestamptz not null default now()
);
create table public.ticket_events (
 id uuid primary key default gen_random_uuid(), ticket_id bigint not null references public.tickets(id) on delete cascade,
 actor_id uuid references public.profiles(id), actor_name text not null, kind text not null, message text not null,
 created_at timestamptz not null default now()
);
create table public.handovers (
 id uuid primary key default gen_random_uuid(), ticket_id bigint not null references public.tickets(id),
 sender_id uuid not null references public.profiles(id), recipient_id uuid not null references public.profiles(id),
 reason text not null check(reason in ('shift_end','specialization','workload')),
 summary text not null check(char_length(summary) between 1 and 4000), notes text not null default '' check(char_length(notes)<=2500),
 state text not null default 'pending' check(state in ('pending','accepted','declined')),
 decline_reason text, created_at timestamptz not null default now(), decided_at timestamptz,
 check(sender_id<>recipient_id)
);
create unique index one_pending_handover on public.handovers(ticket_id) where state='pending';
create table public.handover_drafts (
 ticket_id bigint not null references public.tickets(id), sender_id uuid not null references public.profiles(id),
 recipient_id uuid references public.profiles(id), reason text not null default 'shift_end',
 summary text not null default '' check(char_length(summary)<=4000), notes text not null default '' check(char_length(notes)<=2500),
 updated_at timestamptz not null default now(), primary key(ticket_id,sender_id)
);
create table public.request_limits (actor_id uuid not null references public.profiles(id), category text not null, window_start timestamptz not null, hits integer not null default 1, primary key(actor_id,category,window_start));
create index tickets_requester_idx on public.tickets(requester_id,id desc);
create index tickets_owner_idx on public.tickets(owner_id,id desc);
create index events_ticket_idx on public.ticket_events(ticket_id,created_at desc);
create index tasks_ticket_idx on public.ticket_tasks(ticket_id);

create function public.is_technician() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and (role='admin' or (role='technician' and technician_status='approved')))
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin')
$$;
create function public.can_read_ticket(p_ticket bigint) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.tickets where id=p_ticket and (requester_id=auth.uid() or public.is_technician()))
$$;
create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,full_name,department,employee_id,specialty,requested_role,technician_status)
 values(new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),'مستخدم'),60),left(coalesce(new.raw_user_meta_data->>'department',''),90),left(coalesce(new.raw_user_meta_data->>'employee_id',''),35),left(coalesce(new.raw_user_meta_data->>'specialty',''),80),case when new.raw_user_meta_data->>'requested_role'='technician' then 'technician' else 'user' end,case when new.raw_user_meta_data->>'requested_role'='technician' then 'pending' else 'not_requested' end);
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.create_profile();

alter table public.profiles enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_tasks enable row level security;
alter table public.ticket_events enable row level security;
alter table public.handovers enable row level security;
alter table public.handover_drafts enable row level security;
alter table public.ticket_counter enable row level security;
alter table public.request_limits enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy tickets_read on public.tickets for select to authenticated using(requester_id=auth.uid() or public.is_technician());
create policy tasks_read on public.ticket_tasks for select to authenticated using(public.can_read_ticket(ticket_id));
create policy events_read on public.ticket_events for select to authenticated using(public.can_read_ticket(ticket_id));
create policy handovers_read on public.handovers for select to authenticated using(public.is_technician() or exists(select 1 from public.tickets where id=ticket_id and requester_id=auth.uid()));
create policy drafts_read on public.handover_drafts for select to authenticated using(sender_id=auth.uid() and public.is_technician());
revoke all on public.profiles,public.tickets,public.ticket_tasks,public.ticket_events,public.handovers,public.handover_drafts,public.ticket_counter,public.request_limits from anon,authenticated;
grant select on public.profiles,public.tickets,public.ticket_tasks,public.ticket_events,public.handovers,public.handover_drafts to authenticated;
grant all on public.profiles,public.tickets,public.ticket_tasks,public.ticket_events,public.handovers,public.handover_drafts,public.ticket_counter,public.request_limits to service_role;

create function public.staff_directory() returns table(id uuid,full_name text,specialty text) language sql stable security definer set search_path='' as $$
 select p.id,p.full_name,p.specialty from public.profiles p where auth.uid() is not null and (p.role='admin' or (p.role='technician' and p.technician_status='approved')) order by p.full_name
$$;
create function public.limit_action(p_category text,p_max integer,p_seconds integer) returns void language plpgsql security definer set search_path='' as $$
declare v_start timestamptz;v_hits integer;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 v_start:=to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds);
 insert into public.request_limits(actor_id,category,window_start) values(auth.uid(),p_category,v_start)
 on conflict(actor_id,category,window_start) do update set hits=public.request_limits.hits+1 returning hits into v_hits;
 if v_hits>p_max then raise exception 'RATE_LIMIT' using errcode='P0001';end if;
end $$;
create function public.create_ticket(p_title text,p_category text,p_location text,p_description text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id bigint;v_name text;v_owner uuid;
begin
 select full_name into v_name from public.profiles where id=auth.uid();
 if v_name is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if p_request is null or p_title is null or p_location is null or p_description is null or p_category is null then raise exception 'INVALID_INPUT';end if;
 if char_length(btrim(p_title)) not between 1 and 100 or char_length(btrim(p_location)) not between 1 and 90 or char_length(btrim(p_description)) not between 1 and 2500 or p_category not in ('hardware','networks','software','accounts') then raise exception 'INVALID_INPUT';end if;
 -- Serialize number allocation and recheck the idempotency key after acquiring the lock.
 perform 1 from public.ticket_counter where singleton=true for update;
 select id into v_id from public.tickets where requester_id=auth.uid() and client_request_id=p_request;
 if v_id is not null then return jsonb_build_object('id',v_id,'created',false);end if;
 perform public.limit_action('create_ticket',10,600);
 update public.ticket_counter set next_number=next_number+1 where singleton=true returning next_number-1 into v_id;
 v_owner:=case when public.is_technician() then auth.uid() else null end;
 insert into public.tickets(id,requester_id,owner_id,title,category,location,description,status,client_request_id)
 values(v_id,auth.uid(),v_owner,btrim(p_title),p_category,btrim(p_location),btrim(p_description),case when v_owner is null then 'new' else 'in_progress' end,p_request);
 insert into public.ticket_tasks(ticket_id,text) values(v_id,'فحص المشكلة وتوثيق الإجراء الأولي');
 insert into public.ticket_events(ticket_id,actor_id,actor_name,kind,message) values(v_id,auth.uid(),v_name,'created','تم إنشاء البلاغ. الأولوية بانتظار تحليل الذكاء الاصطناعي.');
 return jsonb_build_object('id',v_id,'created',true);
end $$;

create function public.ticket_action(p_action text,p_ticket bigint,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tickets;h public.handovers;v_name text;v_text text;v_id uuid;v_recipient uuid;v_bool boolean;v_reason text;v_job uuid;v_summary text;v_notes text;
begin
 select full_name into v_name from public.profiles where id=auth.uid();
 if v_name is null or not public.can_read_ticket(p_ticket) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 select * into t from public.tickets where id=p_ticket for update;
 if p_action='note' then
  v_text:=btrim(p_data->>'text');if v_text is null or char_length(v_text) not between 1 and 2000 then raise exception 'INVALID_INPUT';end if;
  perform public.limit_action('note',30,600);
  insert into public.ticket_events(ticket_id,actor_id,actor_name,kind,message) values(t.id,auth.uid(),v_name,'note',v_text);
  return jsonb_build_object('ok',true);
 end if;
 if p_action='classify' then
  if t.priority_state='ready' then return jsonb_build_object('ready',true);end if;
  if t.ai_started_at>now()-interval '60 seconds' then raise exception 'AI_BUSY';end if;
  if t.ai_attempts>=3 and t.ai_started_at>now()-interval '10 minutes' then raise exception 'RATE_LIMIT';end if;
  perform public.limit_action('ai',20,3600);
  v_job:=gen_random_uuid();
  update public.tickets set ai_job=v_job,ai_started_at=now(),ai_attempts=case when t.ai_started_at<now()-interval '10 minutes' then 1 else ai_attempts+1 end,priority_state='processing',ai_error=null where id=t.id;
  return jsonb_build_object('job',v_job,'title',t.title,'description',t.description,'category',t.category);
 end if;
 if not public.is_technician() then raise exception 'TECH_REQUIRED' using errcode='42501';end if;
 if p_action='claim' then
  if t.owner_id=auth.uid() then return jsonb_build_object('ok',true);end if;
  if t.owner_id is not null or t.status='completed' then raise exception 'CONFLICT';end if;
  update public.tickets set owner_id=auth.uid(),status='in_progress',updated_at=now() where id=t.id;
  v_text:='استلم الفني معالجة البلاغ.';
 elsif p_action in ('accept','decline') then
  select * into h from public.handovers where id=(p_data->>'handover_id')::uuid and ticket_id=t.id for update;
  if h.id is null or h.recipient_id<>auth.uid() then raise exception 'NOT_RECIPIENT' using errcode='42501';end if;
  if h.state<>'pending' or t.status<>'pending_handover' or t.owner_id<>h.sender_id then raise exception 'CONFLICT';end if;
  if p_action='accept' then
   if coalesce((p_data->>'acknowledged')::boolean,false) is not true then raise exception 'REVIEW_REQUIRED';end if;
   update public.handovers set state='accepted',decided_at=now() where id=h.id;
   update public.tickets set owner_id=auth.uid(),status='in_progress',updated_at=now() where id=t.id;
   v_text:='تم قبول الاستلام وتحديث الفني المسؤول.';
  else
   v_reason:=btrim(p_data->>'reason');if v_reason is null or char_length(v_reason) not between 1 and 2000 then raise exception 'REASON_REQUIRED';end if;
   update public.handovers set state='declined',decline_reason=v_reason,decided_at=now() where id=h.id;
   update public.tickets set status='in_progress',updated_at=now() where id=t.id;
   v_text:='رفض الاستلام. السبب: '||v_reason||'. يبقى الفني السابق مسؤولًا.';
  end if;
 else
  if t.owner_id is distinct from auth.uid() then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
  if p_action='add_task' then
   v_text:=btrim(p_data->>'text');if v_text is null or char_length(v_text) not between 1 and 180 then raise exception 'INVALID_INPUT';end if;
   if t.status='pending_handover' then raise exception 'HANDOVER_PENDING';end if;
   insert into public.ticket_tasks(ticket_id,text) values(t.id,v_text);
   update public.tickets set status='in_progress',updated_at=now() where id=t.id;
   v_text:='أضيفت خطوة: '||v_text;
  elsif p_action='set_task' then
   if t.status='pending_handover' then raise exception 'HANDOVER_PENDING';end if;
   v_id:=(p_data->>'task_id')::uuid;v_bool:=(p_data->>'done')::boolean;
   if v_bool is null then raise exception 'INVALID_INPUT';end if;
   update public.ticket_tasks set done=v_bool where id=v_id and ticket_id=t.id returning text into v_text;
   if not found then raise exception 'NOT_FOUND';end if;
   update public.tickets set status=case when not v_bool then 'in_progress' else status end,updated_at=now() where id=t.id;
   v_text:=case when v_bool then 'اكتملت خطوة: ' else 'أعيد فتح خطوة: ' end||v_text;
  elsif p_action='close' then
   if t.status='completed' then return jsonb_build_object('ok',true);end if;
   if exists(select 1 from public.handovers where ticket_id=t.id and state='pending') then raise exception 'HANDOVER_PENDING';end if;
   if exists(select 1 from public.ticket_tasks where ticket_id=t.id and not done) then raise exception 'TASKS_REMAIN';end if;
   update public.tickets set status='completed',updated_at=now() where id=t.id;
   v_text:='تم إغلاق البلاغ بعد إكمال جميع الخطوات.';
  elsif p_action in ('draft','send') then
   if t.status='completed' then raise exception 'TICKET_CLOSED';end if;
   v_recipient:=nullif(p_data->>'recipient_id','')::uuid;v_reason:=coalesce(p_data->>'reason','shift_end');
   v_summary:=btrim(coalesce(p_data->>'summary',''));v_notes:=coalesce(p_data->>'notes','');
   if v_reason not in ('shift_end','specialization','workload') or char_length(v_summary)>4000 or char_length(v_notes)>2500 then raise exception 'INVALID_INPUT';end if;
   if v_recipient=auth.uid() then raise exception 'INVALID_RECIPIENT';end if;
   if v_recipient is not null and not exists(select 1 from public.profiles where id=v_recipient and (role='admin' or(role='technician' and technician_status='approved'))) then raise exception 'INVALID_RECIPIENT';end if;
   if exists(select 1 from public.handovers where ticket_id=t.id and state='pending') then raise exception 'HANDOVER_PENDING';end if;
   if p_action='draft' then
    insert into public.handover_drafts(ticket_id,sender_id,recipient_id,reason,summary,notes) values(t.id,auth.uid(),v_recipient,v_reason,v_summary,v_notes)
    on conflict(ticket_id,sender_id) do update set recipient_id=excluded.recipient_id,reason=excluded.reason,summary=excluded.summary,notes=excluded.notes,updated_at=now();
    return jsonb_build_object('ok',true);
   end if;
   if v_recipient is null or char_length(v_summary)=0 then raise exception 'INVALID_INPUT';end if;
   insert into public.handovers(ticket_id,sender_id,recipient_id,reason,summary,notes) values(t.id,auth.uid(),v_recipient,v_reason,v_summary,v_notes);
   update public.tickets set status='pending_handover',updated_at=now() where id=t.id;
   delete from public.handover_drafts where ticket_id=t.id and sender_id=auth.uid();
   v_text:='أرسل طلب تسليم إلى '||(select full_name from public.profiles where id=v_recipient)||'. المسؤولية لا تنتقل قبل القبول.';
  else raise exception 'INVALID_ACTION';end if;
 end if;
 insert into public.ticket_events(ticket_id,actor_id,actor_name,kind,message) values(t.id,auth.uid(),v_name,p_action,v_text);
 return jsonb_build_object('ok',true);
end $$;

create function public.complete_classification(p_ticket bigint,p_job uuid,p_priority text,p_reason text,p_summary text,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_error is null and (p_priority is null or p_priority not in ('high','medium','low') or p_reason is null or char_length(p_reason) not between 1 and 800 or p_summary is null or char_length(p_summary) not between 1 and 1200) then raise exception 'INVALID_AI_RESULT';end if;
 update public.tickets set priority=case when p_error is null then p_priority else priority end,priority_reason=case when p_error is null then p_reason else priority_reason end,ai_summary=case when p_error is null then p_summary else ai_summary end,priority_state=case when p_error is null then 'ready' else 'failed' end,ai_error=case when p_error is null then null else 'CLASSIFICATION_UNAVAILABLE' end,updated_at=now() where id=p_ticket and ai_job=p_job and priority_state='processing';
 if not found then return false;end if;
 insert into public.ticket_events(ticket_id,actor_name,kind,message) values(p_ticket,'مرصاد AI','classified',case when p_error is null then 'تم تحليل المشكلة وتحديد الأولوية بالذكاء الاصطناعي.' else 'تعذّر تصنيف الأولوية. البلاغ محفوظ ويمكن إعادة المحاولة.' end);
 return true;
end $$;
create function public.review_technician(p_profile uuid,p_approve boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED' using errcode='42501';end if;
 update public.profiles set role=case when p_approve then 'technician' else 'user' end,technician_status=case when p_approve then 'approved' else 'rejected' end where id=p_profile and requested_role='technician' and role<>'admin';
 if not found then raise exception 'NOT_FOUND';end if;
end $$;
-- Explicit function privileges: clients cannot allocate numbers, bypass limits, or submit AI results.
revoke execute on function public.create_profile(),public.limit_action(text,integer,integer),public.complete_classification(bigint,uuid,text,text,text,text),public.is_technician(),public.is_admin(),public.can_read_ticket(bigint),public.staff_directory(),public.create_ticket(text,text,text,text,uuid),public.ticket_action(text,bigint,jsonb),public.review_technician(uuid,boolean) from public,anon,authenticated;
grant execute on function public.is_technician(),public.is_admin(),public.can_read_ticket(bigint),public.staff_directory(),public.create_ticket(text,text,text,text,uuid),public.ticket_action(text,bigint,jsonb),public.review_technician(uuid,boolean) to authenticated;
grant execute on function public.complete_classification(bigint,uuid,text,text,text,text) to service_role;
