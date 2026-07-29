# ZERINIX

ZERINIX is a production-oriented SaaS workspace for AI-assisted business decision intelligence. It helps founders and teams ask strategic questions, generate structured market and business-plan reports, save reports to workspaces, export investor-style PDFs, and monitor platform operations from an admin dashboard.

## Architecture

- **Frontend:** Next.js App Router, React, Tailwind CSS, lucide-react.
- **Auth and data:** Supabase Auth, Postgres tables, row-level security, and server-side Supabase clients.
- **AI:** OpenAI Responses API through server routes only, with usage governance, caching, token accounting, and report-quality intelligence layers.
- **Billing:** Stripe Checkout, Billing Portal, signed webhooks, subscription sync tables, and entitlement-aware usage limits.
- **Admin:** Server-authorized admin pages and APIs backed by service-role access that remains server-only.
- **PDF:** jsPDF export paths for live Planner reports and saved dashboard reports.

## Tech Stack

- Next.js `16`
- React `19`
- TypeScript
- Supabase SSR and Supabase JS
- OpenAI SDK
- Stripe server integration
- Node test runner

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Required for core app:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` server-side only
- `OPENAI_API_KEY_DEV` for development AI calls
- `OPENAI_API_KEY_PROD` for production AI calls

Optional or feature-specific:

- `AI_TEST_MODE`
- `AI_DEV_DAILY_REQUEST_LIMIT`
- `AI_DEV_MONTHLY_REQUEST_LIMIT`
- `DEVELOPMENT_MODE`
- `PRODUCTION_MODE`
- `FOUNDER_EMAILS`
- `PRIVATE_BETA_ALLOWED_EMAILS` for comma-separated private-beta test accounts
- `ZERINIX_VERBOSE_LOGS`
- `SUPABASE_STORAGE_AVATAR_BUCKET`
- `SUPABASE_STORAGE_USER_FILES_BUCKET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_REPLY_TO_EMAIL`
- `RESEND_MAX_RETRIES`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_TEAM`
- `STRIPE_PRICE_BUSINESS`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Never expose service-role, OpenAI, Stripe secret, or webhook secret values to client components.

## Database Migrations

Supabase migrations live in `supabase/migrations`.

Apply migrations through the project’s normal Supabase deployment workflow before production releases. Core tables use RLS and ownership policies for reports, workspaces, AI conversations, user memories, usage events, billing profiles, invoices, and admin foundations.

## Security Model

- Protected dashboard data is loaded with authenticated server Supabase clients and scoped by `user_id`.
- Admin data uses `createServiceRoleClient()` only in server-only modules after admin authorization.
- API routes validate request origin/body size before parsing JSON.
- AI endpoints include IP/user rate-limit preparation plus usage quota checks.
- Billing actions are server actions with authentication, rate limiting, server-owned plan configuration, and Stripe-created redirect URLs.
- Stripe webhooks verify signatures and use stored webhook event IDs for idempotency.
- Security headers are configured in `next.config.ts`.

## Testing Commands

```bash
npx tsc --noEmit
npm run lint
npm test
```

The test suite currently uses Node’s built-in test runner with static production-readiness checks for auth guards, admin authorization, billing sync, security headers, API validation, and report quality regressions.

## Deployment

1. Configure production environment variables.
2. Apply Supabase migrations.
3. Configure Stripe products/prices and webhook endpoint.
4. Configure Resend if email delivery is enabled.
5. Run validation:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```

6. Deploy through the hosting provider.

## Known Limitations

- Rate limiting is currently process-local and should be backed by durable storage for multi-instance production.
- Some tests are static source assertions rather than full end-to-end browser tests.
- Stripe requires a real payment/webhook test before enabling paid production traffic.
- PDF visual QA should be checked with representative English and Turkish reports before major releases.
- Source intelligence depends on available source metadata and should never be treated as independent verification.
