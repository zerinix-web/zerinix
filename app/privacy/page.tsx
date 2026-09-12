import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

// Public, no-login-required legal page (required for App Store Connect
// review). Deliberately a plain, static server component -- no auth
// check, no client-side JS, no i18n dictionary dependency -- so it
// always renders the same way for any visitor, signed in or not, and
// carries zero hydration risk. Content below is written directly from
// this codebase's own verified data practices (see the accompanying
// task report for the file-by-file trace); it does not claim anything
// -- a compliance framework, an encryption guarantee, a "never
// collected" absolute -- that was not actually confirmed in the code.
export const metadata: Metadata = {
  title: "Privacy Policy | ZERINIX",
  description:
    "How ZERINIX collects, uses, and protects information for the AI business planning and decision intelligence platform.",
  alternates: {
    canonical: "/privacy",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const LAST_UPDATED = "September 12, 2026";
const CONTACT_EMAIL = "zerinix@zerinix.com";

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

export default function PrivacyPolicyPage() {
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
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-zinc-500">Last Updated: {LAST_UPDATED}</p>

        <p className="mt-6 text-[15px] leading-7 text-zinc-400">
          This Privacy Policy explains how ZERINIX (&ldquo;ZERINIX,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
          &ldquo;our&rdquo;) collects, uses, discloses, and protects information in
          connection with the ZERINIX website, web application, and mobile
          application (together, the &ldquo;Service&rdquo;). It is written to reflect
          how the Service actually operates today. If any part of this
          policy is unclear or you have questions before using the Service,
          please contact us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-teal-200 underline decoration-teal-200/40 underline-offset-2 hover:text-teal-100"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <div className="mt-10 divide-y divide-white/10">
          <Section id="who-we-are" title="Who We Are">
            <p>
              ZERINIX is an AI-assisted business planning and decision
              intelligence platform for founders and business professionals.
              The Service helps users validate business ideas, research
              markets, and generate strategic reports and analyses based on
              information they provide.
            </p>
            <p>
              Access to the Service is currently limited to an invite-only
              private beta. This policy applies to anyone who creates an
              account, signs in, or otherwise uses the Service.
            </p>
          </Section>

          <Section id="information-we-collect" title="Information We Collect">
            <p>We collect the following categories of information:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="text-zinc-300">Account information.</span>{" "}
                Your email address and authentication identity, provided
                when you sign in with a password or through Google or Apple
                sign-in.
              </li>
              <li>
                <span className="text-zinc-300">Content you provide.</span>{" "}
                Business ideas, prompts, questions, chat messages, and any
                files or documents you choose to upload or attach.
              </li>
              <li>
                <span className="text-zinc-300">Generated content.</span>{" "}
                Reports, analyses, and other output the Service generates in
                response to your input, which we store as part of your
                account so you can revisit it.
              </li>
              <li>
                <span className="text-zinc-300">Assistant memory.</span>{" "}
                Where you use the conversational assistant, it may retain
                short factual notes about you or your business (for example,
                your company name or stated preferences) to make later
                responses more relevant.
              </li>
              <li>
                <span className="text-zinc-300">Billing information.</span>{" "}
                If you subscribe to a paid plan, your plan tier and
                subscription status. Payment card details are collected and
                processed directly by our payment processor, Stripe -- see
                &ldquo;Payments&rdquo; below.
              </li>
              <li>
                <span className="text-zinc-300">Usage information.</span>{" "}
                Technical records tied to your account, such as which
                features you used, response times, and token/cost metrics
                associated with AI requests, used to operate and maintain the
                Service.
              </li>
              <li>
                <span className="text-zinc-300">Communications.</span> Any
                information you send us directly, such as support requests.
              </li>
            </ul>
          </Section>

          <Section id="how-we-use-information" title="How We Use Information">
            <p>We use the information described above to:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Provide, operate, and maintain the Service, including generating reports and analyses and maintaining your conversation history;</li>
              <li>Authenticate you and secure your account;</li>
              <li>Process payments and manage subscriptions;</li>
              <li>Detect, prevent, and respond to abuse, fraud, or security issues, including rate-limiting automated misuse;</li>
              <li>Respond to support requests and communicate with you about your account; and</li>
              <li>Maintain and improve the reliability of the Service.</li>
            </ul>
          </Section>

          <Section id="ai-processing" title="AI Processing">
            <p>
              The Service uses OpenAI&rsquo;s API to process the prompts, chat
              messages, report requests, and any file content you submit, in
              order to generate the analyses and responses you see. For
              certain market and competitive research features, the Service
              may also send search queries derived from your business
              context to Tavily, a third-party web search provider, to
              retrieve relevant public information used as supporting
              evidence in a report.
            </p>
            <p>
              These providers process this content on our behalf to generate
              output for you. Their handling of that content, including any
              retention on their side, is governed by their own terms and
              policies, which are outside of ZERINIX&rsquo;s direct control. We do
              not control, and this policy does not describe, how those
              third parties independently use or retain data beyond
              providing their service to us.
            </p>
          </Section>

          <Section id="file-uploads" title="File Uploads / User Content">
            <p>
              When you attach a file to a message or report request, it is
              read in your browser and either its extracted text or an
              encoded copy is included directly in the request sent to
              generate a response -- it is not uploaded to a separate file
              storage system as part of that request. The Service enforces
              file size, count, and type limits at the time of upload.
            </p>
            <p>
              If a message with an attachment is saved to your conversation
              history, we currently store the attachment&rsquo;s file name, size,
              and any extracted text alongside that message, so you can
              refer back to it later. We do not persist the raw binary
              contents of an uploaded file (for example, the original image
              or document bytes) to our database as part of that history.
            </p>
          </Section>

          <Section id="authentication" title="Authentication">
            <p>
              Sign-in is handled by Supabase Auth. You can sign in with an
              email and password or through Google or Apple sign-in. During
              the private beta, access is additionally restricted to
              approved accounts; if your account is not on the approved
              list, you will not be able to sign in.
            </p>
          </Section>

          <Section id="payments" title="Payments">
            <p>
              Paid plans are billed and processed through Stripe. Stripe
              collects and stores your payment card details directly --
              ZERINIX does not receive or store your full card number. We
              retain only the billing identifiers Stripe provides us (such
              as your customer and subscription IDs, plan tier, and
              subscription status) in order to manage your subscription.
            </p>
          </Section>

          <Section id="cookies-local-storage" title="Cookies / Local Storage / Session Data">
            <p>
              The Service uses an essential session cookie, set by Supabase
              Auth, to keep you signed in. This cookie is required for the
              Service to function and is not used for advertising or
              cross-site tracking.
            </p>
            <p>
              In the ZERINIX mobile app, a copy of your session is also kept
              in the device&rsquo;s local storage, so that you remain signed in
              reliably inside the app&rsquo;s embedded browser view. We do not use
              third-party advertising cookies, tracking pixels, or
              analytics/tracking scripts of any kind on the Service.
            </p>
          </Section>

          <Section id="data-sharing" title="Data Sharing / Service Providers">
            <p>
              We do not sell your personal information, and we do not share
              it with third parties for advertising purposes. We share
              information only with the service providers that help us
              operate the Service, specifically:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li><span className="text-zinc-300">Supabase</span> -- database, authentication, and hosting infrastructure;</li>
              <li><span className="text-zinc-300">OpenAI</span> -- AI processing of prompts, messages, and generated content;</li>
              <li><span className="text-zinc-300">Tavily</span> -- web search results used as research evidence, for certain features;</li>
              <li><span className="text-zinc-300">Stripe</span> -- payment processing and subscription billing; and</li>
              <li><span className="text-zinc-300">Resend</span> -- delivery of transactional emails (for example, account or billing notices).</li>
            </ul>
            <p>
              We may also disclose information if required to do so by law,
              or in connection with a merger, acquisition, or sale of
              assets, subject to standard confidentiality expectations.
            </p>
          </Section>

          <Section id="data-retention" title="Data Retention">
            <p>
              We retain your account information, reports, and conversation
              history for as long as your account remains active, so that
              you can continue to access your own content. Certain AI
              responses may be cached temporarily (for a limited number of
              days) to avoid reprocessing an identical request. Usage and
              billing records are retained as needed to operate the Service
              and to meet our accounting and legal obligations.
            </p>
          </Section>

          <Section id="data-security" title="Data Security">
            <p>
              We apply reasonable technical and organizational measures to
              protect your information. Data in transit is encrypted using
              HTTPS. Database-level access controls restrict report,
              workspace, and conversation data so that it is only accessible
              to its owning account. No method of transmission or storage is
              completely secure, and we cannot guarantee absolute security.
            </p>
          </Section>

          <Section id="international-transfers" title="International Data Transfers">
            <p>
              ZERINIX and the service providers listed above may process and
              store information in countries other than the one in which you
              are located, including the United States. By using the
              Service, you understand that your information may be
              transferred to, and processed in, such countries.
            </p>
          </Section>

          <Section id="your-rights" title="User Rights / Choices">
            <p>
              Depending on where you are located, applicable data protection
              law may give you rights over your personal information, such
              as the right to request access to, correction of, or deletion
              of the information we hold about you. You can exercise these
              choices by contacting us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-teal-200 underline decoration-teal-200/40 underline-offset-2 hover:text-teal-100"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section id="account-deletion" title="Account Deletion / Data Requests">
            <p>
              You can request deletion of your account and associated data,
              or a copy of your personal data, by contacting us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-teal-200 underline decoration-teal-200/40 underline-offset-2 hover:text-teal-100"
              >
                {CONTACT_EMAIL}
              </a>
              . These requests currently go through a manual review process
              rather than an automated, self-service flow, so please allow
              us time to verify your request and process it securely.
            </p>
          </Section>

          <Section id="childrens-privacy" title="Children's Privacy">
            <p>
              The Service is intended for business and professional use by
              adults and is not directed to children. We do not knowingly
              collect personal information from children under 13 (or the
              relevant minimum age in your jurisdiction). If you believe a
              child has provided us with personal information, please
              contact us and we will take steps to delete it.
            </p>
          </Section>

          <Section id="changes" title="Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time as the
              Service evolves. When we do, we will revise the &ldquo;Last Updated&rdquo;
              date at the top of this page. Continued use of the Service
              after an update constitutes your acknowledgment of the revised
              policy.
            </p>
          </Section>

          <Section id="contact" title="Contact Information">
            <p>
              If you have questions about this Privacy Policy or how your
              information is handled, contact us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-teal-200 underline decoration-teal-200/40 underline-offset-2 hover:text-teal-100"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </article>

      <footer className="border-t border-white/10 px-5 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start justify-between gap-3 text-xs text-zinc-500 sm:flex-row sm:items-center">
          <p>&copy; {new Date(LAST_UPDATED).getFullYear()} ZERINIX. All rights reserved.</p>
          <Link href="/" className="font-medium text-zinc-400 transition hover:text-white">
            zerinix.com
          </Link>
        </div>
      </footer>
    </main>
  );
}
