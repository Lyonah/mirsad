alter table public.tickets drop constraint tickets_priority_state_check;
alter table public.tickets add constraint tickets_priority_state_check check(priority_state in ('pending','processing','ready','failed','needs_review'));
alter table public.tickets add column priority_source text check(priority_source in ('ai','technician'));
alter table public.tickets add column priority_review_reason text;
alter table public.tickets add column triage_assessment jsonb;
alter table public.tickets add column clarifying_questions jsonb not null default '[]'::jsonb check(jsonb_typeof(clarifying_questions)='array');
update public.tickets set priority_source='ai' where priority_state='ready';
update public.tickets set priority_state='needs_review',priority=null,priority_review_reason='service_unavailable',priority_reason='تعذّر التحليل التلقائي. الأولوية بانتظار مراجعة فني معتمد.' where priority_state='failed';

-- Called only by the Edge Function after it has reserved an authorized job.
create function public.complete_triage(p_ticket bigint,p_job uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_review boolean;v_priority text;v_reason text;v_summary text;v_questions jsonb;v_review_reason text;
begin
 if p_result is null or jsonb_typeof(p_result)<>'object' or coalesce(p_result->>'decision','') not in ('classified','needs_review') then raise exception 'INVALID_AI_RESULT';end if;
 v_review:=p_result->>'decision'='needs_review';v_priority:=p_result->>'priority';
 v_reason:=btrim(p_result->>'reason');v_summary:=btrim(p_result->>'summary');
 v_questions:=coalesce(p_result->'questions','[]'::jsonb);v_review_reason:=p_result->>'review_reason';
 if v_reason is null or char_length(v_reason) not between 1 and 800 or v_summary is null or char_length(v_summary) not between 1 and 1200 then raise exception 'INVALID_AI_RESULT';end if;
 if jsonb_typeof(v_questions)<>'array' or jsonb_array_length(v_questions)>3 then raise exception 'INVALID_AI_RESULT';end if;
 if exists(select 1 from jsonb_array_elements(v_questions) q where jsonb_typeof(q)<>'string' or char_length(q#>>'{}') not between 1 and 250) then raise exception 'INVALID_AI_RESULT';end if;
 if v_review then
  if v_priority is not null or coalesce(v_review_reason,'') not in ('ambiguous','unintelligible','conflicting','service_unavailable','quota','rate_limited','auth','invalid_response','not_configured','timeout') then raise exception 'INVALID_AI_RESULT';end if;
 else
  if v_priority is null or v_priority not in ('high','medium','low') or v_review_reason is not null then raise exception 'INVALID_AI_RESULT';end if;
 end if;
 update public.tickets set priority=v_priority,priority_state=case when v_review then 'needs_review' else 'ready' end,
 priority_source=case when v_review then null else 'ai' end,priority_reason=v_reason,ai_summary=v_summary,
 priority_review_reason=v_review_reason,triage_assessment=p_result->'impact',clarifying_questions=v_questions,
 ai_error=case when v_review then v_review_reason else null end,updated_at=clock_timestamp()
 where id=p_ticket and ai_job=p_job and priority_state='processing' and priority_source is distinct from 'technician';
 if not found then return false;end if;
 insert into public.ticket_events(ticket_id,actor_name,kind,message) values(p_ticket,'مرصاد AI',case when v_review then 'priority_review' else 'classified' end,case when v_review then 'أحيلت الأولوية لمراجعة الفنيين: '||v_reason else 'حدد الذكاء الاصطناعي الأولوية. السبب: '||v_reason end);
 return true;
end $$;

-- An outage must not leave a saved ticket waiting indefinitely for the provider.
create function public.mark_triage_review(p_ticket bigint,p_reason text default 'service_unavailable') returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_read_ticket(p_ticket) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if p_reason is null or p_reason not in ('service_unavailable','not_configured','timeout') then raise exception 'INVALID_INPUT';end if;
 update public.tickets set priority=null,priority_state='needs_review',priority_source=null,
 priority_reason='تعذّر التحليل التلقائي. الأولوية بانتظار مراجعة فني معتمد.',priority_review_reason=p_reason,ai_error=p_reason,
 ai_job=null,updated_at=clock_timestamp()
 where id=p_ticket and (priority_state in ('pending','failed') or (priority_state='processing' and ai_started_at<now()-interval '60 seconds'));
 if not found then return false;end if;
 insert into public.ticket_events(ticket_id,actor_name,kind,message) values(p_ticket,'مرصاد','priority_review','أحيلت الأولوية لمراجعة فني معتمد بسبب عدم توفر التحليل التلقائي.');
 return true;
end $$;

-- Any approved technician may resolve the fallback; applicants and users cannot.
create function public.set_review_priority(p_ticket bigint,p_priority text,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.tickets;v_name text;
begin
 if not public.is_technician() then raise exception 'TECH_REQUIRED' using errcode='42501';end if;
 if p_priority is null or p_priority not in ('high','medium','low') or p_reason is null or char_length(btrim(p_reason)) not between 5 and 800 then raise exception 'INVALID_INPUT';end if;
 select * into t from public.tickets where id=p_ticket for update;
 if t.id is null then raise exception 'NOT_FOUND';end if;
 if t.priority_state not in ('needs_review','failed') and not(t.priority_state='processing' and t.ai_started_at<now()-interval '60 seconds') then raise exception 'PRIORITY_REVIEW_REQUIRED' using errcode='42501';end if;
 select full_name into v_name from public.profiles where id=auth.uid();
 update public.tickets set priority=p_priority,priority_state='ready',priority_source='technician',priority_reason=btrim(p_reason),
 ai_job=null,ai_error=null,clarifying_questions='[]'::jsonb,updated_at=clock_timestamp() where id=p_ticket;
 insert into public.ticket_events(ticket_id,actor_id,actor_name,kind,message) values(p_ticket,auth.uid(),v_name,'manual_priority','حدد الفني الأولوية: '||case p_priority when 'high' then 'عالية' when 'medium' then 'متوسطة' else 'منخفضة' end||'. السبب: '||btrim(p_reason));
 return true;
end $$;

revoke execute on function public.complete_triage(bigint,uuid,jsonb),public.mark_triage_review(bigint,text),public.set_review_priority(bigint,text,text) from public,anon,authenticated;
grant execute on function public.complete_triage(bigint,uuid,jsonb) to service_role;
grant execute on function public.mark_triage_review(bigint,text),public.set_review_priority(bigint,text,text) to authenticated;
