import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AdminShell } from "../../AdminShell";
import { loadAdminUserDetail } from "../../admin-data";

type UserDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function DetailCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function readRowString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

export default async function AdminUserDetailPage({ params }: UserDetailPageProps) {
  const { id } = await params;
  const detail = await loadAdminUserDetail(id);

  if (!detail) {
    notFound();
  }

  return (
    <AdminShell
      eyebrow="Admin / User detail"
      title={detail.user.email}
      subtitle="User operational data only. Passwords, sessions, refresh tokens, payment cards and secret values are never shown."
    >
      <Link
        href="/admin/users"
        className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 transition hover:border-teal-300/30 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to users
      </Link>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailCard label="Display name" value={detail.user.displayName || "Not provided"} />
        <DetailCard label="Plan" value={detail.user.plan} />
        <DetailCard label="Account status" value={detail.user.accountStatus} />
        <DetailCard label="Subscription" value={detail.user.subscriptionStatus} />
        <DetailCard label="Registered" value={formatDate(detail.user.registeredAt)} />
        <DetailCard label="Last sign-in" value={formatDate(detail.user.lastSignInAt)} />
        <DetailCard label="Reports" value={detail.user.reportCount} />
        <DetailCard label="Conversations" value={detail.user.conversationCount} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        {[
          { title: "Recent reports", rows: detail.reports },
          { title: "Recent conversations", rows: detail.conversations },
          { title: "Admin audit log", rows: detail.auditLog },
        ].map((section) => (
          <div
            key={section.title}
            className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl"
          >
            <h2 className="text-lg font-semibold text-white">{section.title}</h2>
            <div className="mt-4 space-y-3">
              {section.rows.length ? (
                section.rows.map((row) => {
                  const record = row as Record<string, unknown>;

                  return (
                  <div key={String(record.id)} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-sm font-medium text-white">
                      {readRowString(record, ["title", "action", "id"])}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatDate(record.created_at || record.updated_at)}
                    </p>
                  </div>
                );
                })
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                  No records yet.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
