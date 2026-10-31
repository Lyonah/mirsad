alter table public.tickets add column contact_details jsonb;
alter table public.tickets add constraint ticket_contact_object check(contact_details is null or jsonb_typeof(contact_details)='object');
-- Atomic extension of existing authorized/idempotent ticket creation.
create function public.create_ticket_with_contact(p_title text,p_category text,p_location text,p_description text,p_request uuid,p_contact jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; k text; maxlen integer;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_contact is null or jsonb_typeof(p_contact)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if (select count(*) from jsonb_object_keys(p_contact))<>5 or not (p_contact ?& array['building','department','floor','office','phone']) then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['building','department','floor','office','phone'] loop
  maxlen:=case when k in ('building','department') then 60 when k='phone' then 20 else 30 end;
  if jsonb_typeof(p_contact->k)<>'string' or char_length(btrim(p_contact->>k)) not between 1 and maxlen then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if (p_contact->>'phone') !~ '^(05[0-9]{8}|\+9665[0-9]{8}|009665[0-9]{8}|\+[1-9][0-9]{7,14})$' then raise exception 'INVALID_INPUT';end if;
 result:=public.create_ticket(p_title,p_category,p_location,p_description,p_request);
 if (result->>'created')::boolean then
  update public.tickets set contact_details=p_contact where id=(result->>'id')::bigint and requester_id=auth.uid();
 end if;
 return result;
end $$;
revoke all on function public.create_ticket_with_contact(text,text,text,text,uuid,jsonb) from public,anon;
grant execute on function public.create_ticket_with_contact(text,text,text,text,uuid,jsonb) to authenticated;
