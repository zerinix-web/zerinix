# ZERINIX Security Hardening Plan

## Layer 1: Application Baseline

- Add strict browser security headers and a production Content Security Policy.
- Rate-limit AI and auth-sensitive endpoints by IP and authenticated user/session.
- Keep server-only secrets out of client bundles; expose only `NEXT_PUBLIC_*` values.
- Return generic user-facing errors and log sanitized server-side diagnostics only.

## Layer 2: Durable Abuse Protection

- Move rate limiting to shared infrastructure such as Redis, Upstash, or Vercel KV.
- Add per-account quotas for AI report generation and market research.
- Add audit logs for authentication, report creation, and high-cost AI actions.

## Layer 3: Data And Access Controls

- Review Supabase Row Level Security policies after every schema migration.
- Add automated RLS smoke tests for reports, workspaces, conversations, and messages.
- Add stricter role-based access when the private beta expands beyond one user.

## Layer 4: Operational Security

- Add dependency vulnerability scanning in CI.
- Add security header checks and secret scanning to CI before deployment.
- Add production monitoring for 401, 403, 429, and 5xx spikes.

## Layer 5: Edge Protection

- Add Cloudflare, managed WAF rules, bot protection, and edge rate limits.
- Add geographic and ASN controls only after traffic patterns are understood.
