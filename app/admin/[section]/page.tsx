import { AdminComingSoon, AdminShell } from "../AdminShell";

const sectionLabels: Record<string, string> = {
  reports: "Reports",
  subscriptions: "Subscriptions",
  payments: "Payments",
  "ai-usage": "AI Usage",
  "usage-quotas": "Usage & Quotas",
  support: "Support",
  logs: "Logs",
  security: "Security",
  "api-management": "API Management",
  settings: "Settings",
};

type AdminSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

export default async function AdminSectionPage({ params }: AdminSectionPageProps) {
  const { section } = await params;
  const label = sectionLabels[section] || "Admin module";

  return (
    <AdminShell
      eyebrow="Admin"
      title={label}
      subtitle="This area is reserved for a future audited admin workflow."
    >
      <AdminComingSoon section={label} />
    </AdminShell>
  );
}
