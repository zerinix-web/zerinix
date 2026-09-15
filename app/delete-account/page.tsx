import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Sparkles } from "lucide-react";

// Public, no-login-required account deletion page (used as the "Account
// deletion URL" in the Google Play Data Safety form). Mirrors the
// structure of app/privacy/page.tsx on purpose: a plain, static server
// component -- no auth check, no client-side JS, no i18n dictionary
// dependency -- so any visitor sees the same page whether or not they are
// signed in.
//
// Keep every statement in sync with the implementation:
//   - In-app deletion: deleteAccount in app/dashboard/settings/actions.ts,
//     which runs app/lib/account/account-deletion.ts (Stripe cancellation
//     first, then the table lists in ACCOUNT_DELETION_TABLE_STEPS and
//     ACCOUNT_DELETION_DETACH_STEPS, then the Supabase Auth user).
//   - Email requests are handled manually, with no fixed turnaround.
export const metadata: Metadata = {
  title: "Delete Your ZERINIX Account | ZERINIX",
  description:
    "How to delete your ZERINIX account in the app or by email, what is deleted, and which billing and security records are kept.",
  alternates: {
    canonical: "/delete-account",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const LAST_UPDATED = "September 15, 2026";
const CONTACT_EMAIL = "zerinix@zerinix.com";
const EMAIL_SUBJECT = "Delete My ZERINIX Account";
const DELETION_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(EMAIL_SUBJECT)}`;

const linkClassName =
  "font-medium text-teal-200 underline decoration-teal-200/40 underline-offset-2 hover:text-teal-100";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="pt-10 first:pt-0">
      <h2 className="text-xl font-semibold tracking-tight text-white sm:text-[1.375rem]">
        {title}
      </h2>
      <div className="mt-3 space-y-4 text-[15px] leading-7 text-zinc-400">
        {children}
      </div>
    </section>
  );
}

function ContactEmailLink() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className={linkClassName}>
      {CONTACT_EMAIL}
    </a>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-zinc-300">{children}</span>;
}

export default function DeleteAccountPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06]">
              <Sparkles className="h-3.5 w-3.5 text-teal-200" />
            </span>
            <span className="text-sm font-semibold tracking-[0.28em] text-white">
              ZERINIX
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-400 transition hover:text-white"
          >
            Back to ZERINIX
          </Link>
        </nav>
      </header>

      <article className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
          Legal
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Delete Your ZERINIX Account
        </h1>
        <p className="mt-3 text-sm text-zinc-500">Last Updated: {LAST_UPDATED}</p>

        <p className="mt-6 text-[15px] leading-7 text-zinc-400">
          This page explains how to delete your ZERINIX account and the data
          associated with it. ZERINIX (&ldquo;ZERINIX,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is an AI-assisted business
          planning and decision intelligence platform, available through the
          ZERINIX website, web application, and mobile application. These
          instructions apply to all ZERINIX accounts, including accounts that
          sign in with Google or Apple.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-teal-200/20 bg-teal-200/[0.04] p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
              In the app
            </p>
            <p className="mt-3 text-[15px] leading-7 text-zinc-300">
              Sign in, open <span className="font-medium text-white">Account</span>,
              type DELETE under{" "}
              <span className="font-medium text-white">Delete account</span>,
              and confirm. Your account is deleted right away.
            </p>
            <a href="#delete-in-app" className={`mt-4 inline-block text-sm ${linkClassName}`}>
              Step-by-step instructions
            </a>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
              By email
            </p>
            <dl className="mt-3 space-y-3 text-[15px] leading-6">
              <div>
                <dt className="text-zinc-500">Send to</dt>
                <dd className="break-words font-medium text-white">{CONTACT_EMAIL}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Subject</dt>
                <dd className="font-medium text-white">&ldquo;{EMAIL_SUBJECT}&rdquo;</dd>
              </div>
              <div>
                <dt className="text-zinc-500">From</dt>
                <dd className="text-zinc-300">Your ZERINIX account email address</dd>
              </div>
            </dl>
            <a
              href={DELETION_MAILTO}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-200 px-5 py-3 text-sm font-semibold text-black transition hover:bg-teal-100 sm:w-auto"
            >
              <Mail className="h-4 w-4" />
              Email a deletion request
            </a>
          </div>
        </div>

        <div className="mt-12 divide-y divide-white/10">
          <Section id="delete-in-app" title="Delete Your Account in the App">
            <p>
              If you can sign in, you can delete your account yourself on the
              ZERINIX website or in the ZERINIX mobile app:
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Sign in to ZERINIX.</li>
              <li>
                Open <Label>Account</Label>. On a computer, scroll to the{" "}
                <Label>Danger Zone</Label> section. In the mobile app, open the{" "}
                <Label>Account</Label> tab and scroll to{" "}
                <Label>Account deletion</Label>.
              </li>
              <li>
                Under <Label>Delete account</Label>, type{" "}
                <Label>DELETE</Label> in the confirmation field.
              </li>
              <li>
                Select <Label>Permanently delete account</Label>.
              </li>
            </ol>
            <p>
              Deletion starts as soon as you confirm. When it finishes, you are
              signed out and shown a page confirming that your account has been
              deleted. If deletion cannot be completed, you stay signed in and
              the Account page shows an error message; you can try again or
              contact us.
            </p>
          </Section>

          <Section id="delete-by-email" title="Request Deletion by Email">
            <p>
              If you cannot sign in, you can request account deletion by email:
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Use the email address associated with your ZERINIX account.
                This is the email address you use to sign in, or the email
                address linked to the Google or Apple account you use to sign
                in.
              </li>
              <li>
                Send an email to <ContactEmailLink /> with the subject line{" "}
                <Label>&ldquo;{EMAIL_SUBJECT}&rdquo;</Label>.
              </li>
              <li>
                In the message, state that you want your ZERINIX account and
                its associated data deleted.
              </li>
            </ol>
            <p>
              If you no longer have access to that email address, or you signed
              in with Apple using a private relay (&ldquo;Hide My Email&rdquo;)
              address, email us from another address and include the email
              address associated with your ZERINIX account.
            </p>
            <p>
              Email requests are handled manually by the ZERINIX team and are
              processed within a reasonable period after we receive them.
            </p>
          </Section>

          <Section id="subscriptions" title="Paid Subscriptions">
            <p>
              When you delete your account in the app, any active paid
              subscription is canceled in Stripe, our payment processor,
              before any of your data is deleted. Cancellation takes effect
              immediately, and remaining time in the current billing period is
              not automatically refunded. If your subscription cannot be
              canceled, your account is not deleted and the Account page shows
              an error message.
            </p>
          </Section>

          <Section id="what-is-deleted" title="What Is Deleted">
            <p>When your account is deleted, the following data is deleted:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <Label>Your account:</Label> your sign-in account, including
                your email address, linked Google or Apple sign-in, and profile
                and preference settings.
              </li>
              <li>
                <Label>Your content:</Label> advisory sessions and chat
                messages, including text extracted from files you attached.
              </li>
              <li>
                <Label>Reports and workspaces:</Label> your generated reports
                and analyses, your workspaces, and report generation jobs.
              </li>
              <li>
                <Label>Assistant data:</Label> your AI profile and the
                assistant&rsquo;s saved memory about you or your business.
              </li>
              <li>
                <Label>Account activity:</Label> usage and quota records,
                cached AI responses, rate-limit and abuse-prevention records,
                in-app notifications, account status, and records of emails
                ZERINIX sent to your address.
              </li>
              <li>
                <Label>Billing data stored by ZERINIX:</Label> your plan and
                subscription status, your Stripe customer and subscription IDs,
                and ZERINIX&rsquo;s copies of your invoices.
              </li>
              <li>
                <Label>Stored files:</Label> any files kept in ZERINIX file
                storage for your account.
              </li>
            </ul>
          </Section>

          <Section id="what-is-kept" title="Records That Are Kept">
            <p>
              A small set of billing, accounting, and security records is kept
              after your account is deleted. These records are separate from
              your content: none of them contains your reports, conversations,
              or assistant memory.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <Label>Payment records held by Stripe.</Label> Stripe keeps its
                own records of your payments, invoices, and customer details,
                including to meet accounting, tax, and legal requirements.
                Deleting your ZERINIX account does not delete these records
                from Stripe.
              </li>
              <li>
                <Label>AI cost accounting records.</Label> Records of AI
                processing costs, such as token counts, model names, and
                estimated costs, are kept for ZERINIX&rsquo;s accounting. Your
                account ID is removed from them, and they do not contain the
                text of your prompts, messages, or reports.
              </li>
              <li>
                <Label>Administrative audit records.</Label> If ZERINIX staff
                took an administrative action on your account, such as
                changing its plan or status, the record of that action is kept
                for security, with your account ID removed.
              </li>
            </ul>
            <p>
              Information that was already processed by our other service
              providers, as described in our{" "}
              <Link href="/privacy" className={linkClassName}>
                Privacy Policy
              </Link>
              , is governed by those providers&rsquo; own terms and retention
              policies.
            </p>
          </Section>

          <Section id="deleting-specific-data" title="Deleting Specific Data">
            <p>
              You do not need to delete your entire account to remove some of
              your data. While signed in, you can delete individual advisory
              sessions, clear your AI profile, and delete workspaces that do
              not contain any reports.
            </p>
            <p>
              To request deletion of other specific data, such as particular
              reports or the assistant&rsquo;s saved memory, while keeping your
              account, email <ContactEmailLink /> from the email address
              associated with your account and describe the data you want
              deleted. These requests are handled manually and processed within
              a reasonable period.
            </p>
          </Section>

          <Section id="contact" title="Contact">
            <p>
              For account deletion requests or questions about deleting your
              data, contact ZERINIX at <ContactEmailLink />. For more detail on
              the information ZERINIX collects and how it is used, see our{" "}
              <Link href="/privacy" className={linkClassName}>
                Privacy Policy
              </Link>
              .
            </p>
          </Section>
        </div>
      </article>

      <footer className="border-t border-white/10 px-5 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start justify-between gap-3 text-xs text-zinc-500 sm:flex-row sm:items-center">
          <p>&copy; {new Date(LAST_UPDATED).getFullYear()} ZERINIX. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="font-medium text-zinc-400 transition hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/" className="font-medium text-zinc-400 transition hover:text-white">
              zerinix.com
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
