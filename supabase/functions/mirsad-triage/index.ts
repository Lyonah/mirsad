import { createHandler } from './handler.ts';

// These are runtime secrets managed by Supabase, never returned to the browser.
Deno.serve(createHandler({
 url:(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,''),
 anon:Deno.env.get('SUPABASE_ANON_KEY')||'',
 service:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
 key:Deno.env.get('GROQ_API_KEY')||'',
 model:Deno.env.get('GROQ_MODEL')||'openai/gpt-oss-120b',
}));
