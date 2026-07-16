import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Fingerprint,
  Globe2,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Quote,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";
import WaitlistForm from "@/components/WaitlistForm";
import LanguageSelector from "@/components/LanguageSelector";
import { getRequestDictionary } from "@/app/lib/i18n/server";

export const metadata: Metadata = {
  title: "ZERINIX | AI Business Planning for Founders",
  description:
    "ZERINIX is a premium AI operating system for founders, combining business planning, market intelligence, strategic reports and secure execution workflows.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "ZERINIX | AI Business Planning for Founders",
    description:
      "AI business planning, market intelligence and strategic reports for founders.",
    type: "website",
  },
};

const featureIcons = [FileText, Globe2, Layers3, Zap];
const platformModuleIcons = [Workflow, Radar, MessageSquareText];
const trustSignalIcons = [Building2, ShieldCheck, CircleDollarSign];
const highlightedPricingIndex = 1;

export default async function Home() {
  const { locale, dictionary } = await getRequestDictionary();
  const pageWorkflowSteps = dictionary.landing.workflowSteps;
  const pageChatMessages = [
    {
      role: dictionary.landing.chatFounder,
      text: dictionary.landing.chatFounderText,
    },
    {
      role: "ZERINIX",
      text: dictionary.landing.chatZerinixText,
    },
  ];
  const pageFeatures = dictionary.landing.features.map((feature, index) => ({
    ...feature,
    icon: featureIcons[index] ?? FileText,
  }));
  const pageTrustSignals = dictionary.landing.trustSignals.map((signal, index) => ({
    title: signal[0],
    detail: signal[1],
    icon: trustSignalIcons[index] ?? ShieldCheck,
  }));
  const pagePlatformModules = dictionary.landing.platformModules.map((module, index) => ({
    eyebrow: module[0],
    title: module[1],
    description: module[2],
    icon: platformModuleIcons[index] ?? Workflow,
  }));
  const pagePricing = dictionary.landing.pricingPlans.map((plan, index) => ({
    name: plan[0],
    price: plan[1],
    description: plan[2],
    features: plan.slice(3),
    highlighted: index === highlightedPricingIndex,
  }));

  return (
    <main className="min-h-screen overflow-x-hidden bg-black text-white">
      <div className="fixed inset-0 -z-10 bg-black">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(45,212,191,0.18),transparent_32%),radial-gradient(circle_at_82%_8%,rgba(244,244,245,0.12),transparent_28%),radial-gradient(circle_at_50%_90%,rgba(20,184,166,0.12),transparent_36%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.2),#000_88%)]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/55 backdrop-blur-2xl">
        <nav
          className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8"
          aria-label={dictionary.landing.mainNavigation}
        >
          <Link href="/" className="group flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] shadow-lg shadow-black/30">
              <Sparkles className="h-4 w-4 text-teal-200" />
            </span>
            <span className="text-lg font-semibold tracking-[0.28em] text-white">
              ZERINIX
            </span>
          </Link>

          <div className="hidden items-center gap-7 text-sm font-medium text-zinc-400 md:flex">
            <a className="transition hover:text-white" href="#features">
              {dictionary.landing.platform}
            </a>
            <a className="transition hover:text-white" href="#pricing">
              {dictionary.landing.pricing}
            </a>
            <a className="transition hover:text-white" href="#faq">
              {dictionary.landing.faq}
            </a>
            <a className="transition hover:text-white" href="#security">
              {dictionary.landing.security}
            </a>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSelector locale={locale} labels={dictionary.language} compact />
            <Link
              href="/login?next=/plan"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-teal-200/40 hover:bg-white/[0.08]"
            >
              <LockKeyhole className="h-4 w-4 text-teal-200" />
              <span className="hidden sm:inline">{dictionary.landing.developerLogin}</span>
              <span className="sm:hidden">{dictionary.landing.login}</span>
            </Link>
          </div>
        </nav>
      </header>

      <section className="relative mx-auto grid min-h-[calc(100vh-80px)] w-full max-w-7xl grid-cols-1 items-center gap-12 overflow-hidden px-5 py-16 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:py-20">
        <div className="landing-fade-up landing-mobile-safe min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/10 px-4 py-2 text-sm font-medium text-teal-100 shadow-lg shadow-teal-950/20">
            <span className="h-2 w-2 rounded-full bg-teal-200 shadow-[0_0_18px_rgba(94,234,212,0.8)]" />
            {dictionary.landing.heroBadge}
          </div>

          <h1 className="mt-7 max-w-5xl text-4xl font-semibold leading-[1.04] tracking-tight text-white sm:text-6xl lg:text-7xl">
            {dictionary.landing.heroTitle}
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-300 sm:text-xl">
            {dictionary.landing.heroDescription}
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            <WaitlistForm labels={dictionary.landing} />
            <Link
              href="/login?next=/plan"
              prefetch={false}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.045] px-6 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/[0.08] sm:w-auto"
            >
              {dictionary.landing.developerLogin}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500">
            {dictionary.landing.helperText}
          </p>

          <div className="mt-10 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
            {dictionary.landing.stats.map(([value, label]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl"
              >
                <p className="text-2xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-fade-up landing-delay-1 landing-mobile-safe relative min-w-0">
          <div className="absolute -inset-6 rounded-[2rem] bg-teal-200/10 blur-3xl" />
          <div className="relative min-w-0 overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.06] shadow-2xl shadow-black/60 backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200">
                  {dictionary.landing.demoTitle}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  {dictionary.landing.demoSubtitle}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-300/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
              </div>
            </div>

            <div className="space-y-4 p-5">
              {pageChatMessages.map((message, index) => (
                <div
                  key={message.role}
                  className={
                    index === 0
                      ? "ml-auto max-w-[88%] rounded-2xl bg-white px-4 py-3 text-black"
                      : "max-w-[92%] rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-zinc-100"
                  }
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-60">
                    {message.role}
                  </p>
                  <p className="mt-2 break-words text-sm leading-6">{message.text}</p>
                </div>
              ))}

              <div className="rounded-2xl border border-teal-200/20 bg-teal-200/[0.06] p-4">
                <div className="flex flex-col gap-4 min-[460px]:flex-row min-[460px]:items-center min-[460px]:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-200 text-black">
                      <Bot className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {dictionary.landing.buildingReport}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {dictionary.landing.firstInsight}
                      </p>
                    </div>
                  </div>
                  <span className="w-fit rounded-full border border-teal-200/20 px-3 py-1 text-xs font-semibold text-teal-100">
                    {dictionary.landing.streaming}
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {pageWorkflowSteps.map((step, index) => (
                    <div
                      key={step}
                      className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/30 px-3 py-2 text-sm text-zinc-300"
                    >
                      <Check className="h-4 w-4 text-emerald-300" />
                      <span>{step}</span>
                      {index === pageWorkflowSteps.length - 1 ? (
                        <span className="ml-auto flex items-center gap-1 text-xs text-teal-200">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-200" />
                          {dictionary.landing.writing}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 pb-12 sm:px-8">
        <div className="grid gap-3 rounded-[2rem] border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl md:grid-cols-3">
          {pageTrustSignals.map((signal) => {
            const Icon = signal.icon;

            return (
              <article
                key={signal.title}
                className="rounded-3xl border border-white/10 bg-black/25 p-5"
              >
                <Icon className="h-5 w-5 text-teal-200" />
                <h2 className="mt-4 text-base font-semibold text-white">
                  {signal.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {signal.detail}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
        <div className="landing-fade-up flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-200">
              {dictionary.landing.platform}
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {dictionary.landing.platformHeading}
            </h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-zinc-500">
            {dictionary.landing.platformDescription}
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {pagePlatformModules.map((module, index) => {
            const Icon = module.icon;

            return (
              <article
                key={module.title}
                className="landing-card-hover rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-7 shadow-2xl shadow-black/20 backdrop-blur-xl"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                    <Icon className="h-5 w-5 text-teal-200" />
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                    {module.eyebrow}
                  </span>
                </div>
                <h3 className="mt-7 text-2xl font-semibold tracking-tight text-white">
                  {module.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-zinc-400">
                  {module.description}
                </p>
              </article>
            );
          })}
        </div>

        <div className="landing-fade-up mt-20 max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-200">
            {dictionary.landing.founderInfrastructure}
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            {dictionary.landing.founderInfrastructureTitle}
          </h2>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pageFeatures.map((feature, index) => {
            const Icon = feature.icon;

            return (
              <article
                key={feature.title}
                className="landing-card-hover rounded-3xl border border-white/10 bg-white/[0.045] p-6 backdrop-blur-xl"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                  <Icon className="h-5 w-5 text-teal-200" />
                </div>
                <h3 className="mt-6 text-xl font-semibold tracking-tight text-white">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-8 backdrop-blur-xl">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-200">
            {dictionary.landing.intelligenceLayer}
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            {dictionary.landing.intelligenceTitle}
          </h2>
          <p className="mt-5 text-sm leading-7 text-zinc-400">
            {dictionary.landing.intelligenceDescription}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[
            [Target, ...dictionary.landing.intelligenceCards[0]],
            [Radar, ...dictionary.landing.intelligenceCards[1]],
            [TrendingUp, ...dictionary.landing.intelligenceCards[2]],
            [Clock3, ...dictionary.landing.intelligenceCards[3]],
          ].map(([Icon, title, description]) => {
            const TypedIcon = Icon as typeof Target;

            return (
              <div
                key={title as string}
                className="rounded-3xl border border-white/10 bg-black/35 p-6 backdrop-blur-xl"
              >
                <TypedIcon className="h-6 w-6 text-teal-200" />
                <h3 className="mt-5 text-lg font-semibold text-white">{title as string}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {description as string}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="grid gap-0 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="border-b border-white/10 p-8 lg:border-b-0 lg:border-r lg:p-10">
              <Quote className="h-8 w-8 text-teal-200" />
              <p className="mt-7 text-2xl font-medium leading-10 tracking-tight text-white sm:text-3xl">
                {dictionary.landing.quote}
              </p>
              <p className="mt-6 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-500">
                {dictionary.landing.productPrinciple}
              </p>
            </div>
            <div className="grid gap-0 sm:grid-cols-3">
              {dictionary.landing.principleCards.map(([title, copy]) => (
                <div
                  key={title}
                  className="border-b border-white/10 p-7 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
                >
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                    {title}
                  </p>
                  <p className="mt-4 text-sm leading-7 text-zinc-400">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-200">
              {dictionary.landing.pricingPreview}
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {dictionary.landing.pricingTitle}
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-zinc-500">
            {dictionary.landing.pricingDescription}
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {pagePricing.map((plan) => (
            <article
              key={plan.name}
              className={
                plan.highlighted
                  ? "rounded-3xl border border-teal-200/35 bg-teal-200/[0.08] p-6 shadow-2xl shadow-teal-950/30 backdrop-blur-xl"
                  : "rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl"
              }
            >
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-2xl font-semibold text-white">{plan.name}</h3>
                {plan.highlighted ? (
                  <span className="rounded-full bg-teal-200 px-3 py-1 text-xs font-semibold text-black">
                    {dictionary.landing.recommended}
                  </span>
                ) : null}
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-tight text-white">
                {plan.price}
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                {plan.description}
              </p>
              <div className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-center gap-3 text-sm text-zinc-300">
                    <Check className="h-4 w-4 text-emerald-300" />
                    {feature}
                  </div>
                ))}
              </div>
              <div className="mt-7">
                <a
                  href="#waitlist"
                  className={
                    plan.highlighted
                      ? "inline-flex w-full items-center justify-center gap-2 rounded-full bg-teal-300 px-5 py-3 text-sm font-semibold text-black transition hover:bg-teal-200"
                      : "inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.08]"
                  }
                >
                  {dictionary.landing.requestAccess}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="faq" className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-200">
              {dictionary.landing.faq}
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              {dictionary.landing.faqTitle}
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-zinc-500">
              {dictionary.landing.faqDescription}
            </p>
          </div>

          <div className="grid gap-3">
            {dictionary.landing.faqs.map(([question, answer]) => (
              <article
                key={question}
                className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl"
              >
                <h3 className="text-lg font-semibold tracking-tight text-white">
                  {question}
                </h3>
                <p className="mt-3 text-sm leading-7 text-zinc-400">
                  {answer}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-teal-300/20 bg-teal-300/[0.06] p-8 shadow-2xl shadow-teal-950/20 backdrop-blur-2xl sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-100/80">
                {dictionary.landing.privateBeta}
              </p>
              <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                {dictionary.landing.betaCtaTitle}
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <WaitlistForm labels={dictionary.landing} />
              <Link
                href="/login?next=/plan"
                prefetch={false}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.055] px-6 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/[0.1]"
              >
                {dictionary.landing.developerLogin}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] backdrop-blur-2xl">
          <div className="grid gap-8 p-8 lg:grid-cols-[0.92fr_1.08fr] lg:p-10">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-200/25 bg-teal-200/10">
                <ShieldCheck className="h-7 w-7 text-teal-200" />
              </div>
              <h2 className="mt-6 text-4xl font-semibold tracking-tight text-white">
                {dictionary.landing.securityTitle}
              </h2>
              <p className="mt-5 text-sm leading-7 text-zinc-400">
                {dictionary.landing.securityDescription}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {dictionary.landing.securityItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4"
                >
                  <Fingerprint className="mt-0.5 h-5 w-5 text-teal-200" />
                  <p className="text-sm leading-6 text-zinc-300">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-5 py-10 sm:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-start">
          <div className="max-w-md">
            <p className="text-lg font-semibold tracking-[0.28em] text-white">ZERINIX</p>
            <p className="mt-2 text-sm text-zinc-500">
              {dictionary.landing.footerDescription}
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                {dictionary.landing.product}
              </p>
              <div className="mt-4 grid gap-3 text-sm text-zinc-400">
                <a href="#features" className="transition hover:text-white">
                  {dictionary.landing.platform}
                </a>
                <a href="#pricing" className="transition hover:text-white">
                  {dictionary.landing.pricing}
                </a>
                <a href="#faq" className="transition hover:text-white">
                  {dictionary.landing.faq}
                </a>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                {dictionary.landing.access}
              </p>
              <div className="mt-4 grid gap-3 text-sm text-zinc-400">
                <a href="#waitlist" className="transition hover:text-white">
                  {dictionary.landing.requestEarlyAccess}
                </a>
                <a href="#security" className="transition hover:text-white">
                  {dictionary.landing.security}
                </a>
                <Link
                  href="/login?next=/plan"
                  prefetch={false}
                  className="transition hover:text-white"
                >
                  {dictionary.landing.developerLogin}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
