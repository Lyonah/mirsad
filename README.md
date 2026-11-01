# Mirsad — live service integration

Arabic RTL IT-support workspace. This source replaces the previous browser-only prototype with Supabase-managed authentication, Postgres RLS and transactional operations, and server-side Groq classification.

## Current connection status

The application intentionally fails closed until external services are configured. It never creates local substitute accounts or uses keyword priority as if it were AI. Deployment alone does not mean authentication, database migrations or the Groq call have been verified against real accounts.

## Configuration

Configure the following runtime variables through the hosting environment, not client files:

- `SUPABASE_URL`: HTTPS project URL.
- `SUPABASE_ANON_KEY`: project's public anon/publishable key. This is returned to the browser to initialize the official Supabase client.

AI runs in `supabase/functions/mirsad-triage`. Set `GROQ_API_KEY` in the selected Supabase project's Edge Function Secrets dashboard; `GROQ_MODEL` is optional (default `openai/gpt-oss-120b`). Supabase injects its own server-side service-role key. Neither secret needs to be copied to Sites.

Deploy all five function files (including `body.ts`) with `verify_jwt=false`: the handler explicitly verifies every classification caller using Auth `/user`, then invokes the authorization/rate-limit RPC under that user's JWT. This also permits a public `/health` endpoint that reports readiness only. Health uses a cached, read-only Groq model access check; it never makes a paid generation request and does not prove billing quota. No CORS policy enables browser access; the Site calls the function from its server.

No real credentials belong in Git, logs, prompts, browser source or `.openai/hosting.json`. `.env.example` contains names only.

## Database setup

Apply `supabase/migrations/202610310001_mirsad.sql` once to a new, selected Supabase project using Supabase migrations. It creates the profiles, ticket counter, tickets, tasks, activity events, handovers, drafts and request limits. Do not run this migration on an unrelated existing project without reviewing table/function names.

Enable email confirmation in Supabase Auth. Configure Site URL and redirect allowlist to the actual hosted origin; password recovery and confirmation return to `/`. Configure a production email delivery provider when the project is used by real staff.

Account types are application profiles, not user-editable metadata permissions. All new users receive the `user` role. Technician signup sets `requested_role=technician` and a pending review. An admin must approve it.

### First administrator

After the project owner registers and verifies the intended account, an authorized project administrator promotes that exact auth user in the database. Resolve the real user ID and email first. No browser control, default password, automatic first-user promotion, or public API grants admin rights.

Example (replace the placeholder with the verified account UUID only):

```sql
update public.profiles set role='admin' where id='<verified-owner-auth-user-uuid>';
```

The admin's dashboard contains technician approval controls. Technician applicants cannot approve themselves. This application models a single support workspace; deploy separate projects or add validated tenant membership before using multiple independent organizations.

## Runtime flow

1. Supabase Auth verifies registration, confirmation, sign-in and password recovery. The official browser SDK refreshes its managed session.
2. The browser supplies its access token to same-origin API routes. Server routes verify identity using Supabase Auth, validate inputs and invoke only a fixed set of database RPCs under that visitor's JWT.
3. RLS limits users to their tickets and gives approved technicians the shared workspace. Raw table insert/update/delete access is revoked for visitors.
4. `create_ticket` allocates a centralized counter while holding its row lock and checks a per-user idempotency UUID. Transaction rollback restores the counter. Closing a ticket never resets numbers.
5. The Site forwards only the ticket ID and user JWT to the Edge Function. Classification reserves a bounded job, sends only issue title, description and category to Groq Chat Completions with a strict JSON schema, validates the returned JSON, then commits it through a service-only RPC.
6. If AI is missing/unavailable, the ticket remains saved with pending/failed classification. No user priority selector or keyword fallback exists. AI is never allowed to approve technicians or execute support actions.
7. Only the current owner can update technical steps, close, or send a handover. The owner remains unchanged while pending. Only the recipient may accept or decline; acceptance needs acknowledgment, decline needs a nonblank reason. Changes and their event records are committed in the same database transaction.

AI handling uses 15-second Groq request timeouts and one bounded retry for a short transient rate limit, explicit failure states, no prompt/body logging, bounded output validation, per-user hourly limits and per-ticket retry controls. AI output is advisory and must be evaluated on realistic Arabic tickets before operational rollout.

## Running and checking

Use Node 22.13+ and the pinned package manager. For the Sites hosting environment use the supplied lifecycle helpers and the managed preview daemon; preserve `sites()` Vite integration and the existing host sign-in helpers. The owner requested an independent public application: the hosting audience is public, while all ticket/account data remains protected by Supabase authentication and RLS. Visitors do not need a ChatGPT account.

Checks:

```text
node tests/database.mjs
node tests/contracts.mjs
node tests/triage.mjs
node tests/request-body.mjs
node node_modules/typescript/bin/tsc --noEmit
node --check public/mirsad.js
```

Database tests run the real migration in embedded Postgres with Supabase auth-role fixtures. They verify privilege boundaries, RLS, number allocation/idempotency, role approval, task/closing rules, handover decisions and isolation of AI-result writes. Fixtures are test-only, never deployed to production.

## End-to-end verification after connection

Request bodies are read with an incremental byte limit (16,000 bytes for the Site API and 256 bytes for triage) and a 10-second read deadline. Oversized streams are cancelled before they can be buffered in full.

Enable leaked-password protection in Supabase Auth when the organization has Pro or above. The connected Free organization cannot enable this feature; the application must not claim that it is active. This setting is enforced by Supabase Auth rather than browser validation.

- Register/verify the owner's account; confirm sign-in and recovery.
- Promote the verified owner to admin and approve two separately registered technicians.
- Create two tickets from a user account; verify `#01`, `#02` and actual Groq classifications in shared Postgres records.
- Verify a different user cannot read or mutate either ticket, including by direct API requests.
- Claim the ticket, complete a task, send handover, then use the recipient's separate session to reject and later accept another request.
- Confirm sender-only ownership while pending, recipient-only decisions, persisted events and updated ownership from another device.
- Test AI timeout/outage and duplicate ticket submission.

## Scope and current limits

- Not a finished multi-tenant enterprise deployment.
- Incoming/outgoing handover view is shared among approved technicians; task edits are owner-only.
- Lists are bounded to the newest 200 tickets and 2,000 child records per selected collection; full pagination is a next step.
- Periodic refresh (30 seconds) is used instead of claiming live push notifications.
- Attachments, organization SSO and email notification delivery are not implemented.
- No production data is seeded and no backend claim is made solely on the basis of fixtures/build success.

## AI triage and technician fallback

The expanded triage schema records scope, disruption, risk and workaround as reported facts or unknown values. The prompt covers Arabic dialects, Arabizi, mixed technical English, spelling variation and negation. An unclear, contradictory or insufficient description produces `needs_review` with no priority and up to three clarification questions. Recent follow-up notes are considered on retry. A provider outage, quota failure, invalid output or missing key also routes the saved ticket to review.

Only approved technicians/admins can call `set_review_priority`, and only while review is needed (or a processing job has expired). A reason is mandatory. The transaction stores `priority_source=technician`, actor and reason in the audit trail, cancels the AI job, and prevents a delayed AI response or competing technician from replacing the committed decision. Users and pending technician applicants cannot assign priority even by direct RPC.

The `tests/dialect-cases.json` evaluation set contains dialect, ambiguity, negation and prompt-injection cases. These are pending live-model evaluation; passing schema/security fixtures does not prove dialect accuracy. The current OpenAI account returned `credit_balance_exhausted` / `insufficient_quota`, so generation evaluation is blocked until API credits are available. Do not claim perfect dialect coverage or production readiness before live acceptance testing.

## Free trial provider

The active adapter uses Groq only (`https://api.groq.com/openai/v1/chat/completions`) with the production, strict-JSON-capable `openai/gpt-oss-120b` model. Its `openai/` model namespace is a model publisher identifier; requests go to Groq, never the OpenAI API. The existing OpenAI secret is unused. Set `GROQ_API_KEY` in Supabase Edge Function Secrets and keep the Groq account on the Free plan; this implementation does not add billing or enable a paid fallback. Free-plan quotas still apply. No live Groq generation is claimed until the key is saved and tested.
