import Link from "next/link";
import { Trash2 } from "lucide-react";
import { deleteAccount } from "@/app/dashboard/settings/actions";
import DeleteAccountSubmitButton from "./DeleteAccountSubmitButton";

// Shared by the desktop Danger Zone and the mobile Account screen so both
// run the same server action with the same confirmation and disclosures.
export default function DeleteAccountForm({ className = "" }: { className?: string }) {
  return (
    <form
      action={deleteAccount}
      className={`rounded-2xl border border-red-300/20 bg-red-950/20 p-4 ${className}`.trim()}
    >
      <input type="hidden" name="intent" value="delete_account" />
      <Trash2 className="h-5 w-5 text-red-100" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-white">Delete account</h3>
        <span className="rounded-full border border-red-300/20 bg-red-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-red-100/70">
          Permanent
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-red-100/75">
        Permanently deletes your ZERINIX account and its data, including
        reports, workspaces, advisory sessions, and assistant memory. You will
        be signed out, and this can&rsquo;t be undone.
      </p>
      <p className="mt-2 text-sm leading-6 text-red-100/75">
        Any active paid subscription is canceled in Stripe immediately.
        Remaining time in the current billing period is not automatically
        refunded.
      </p>
      <input
        name="confirmation"
        required
        pattern="DELETE"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="Type DELETE"
        aria-label="Type DELETE to permanently delete your account"
        className="mt-4 min-h-11 w-full rounded-2xl border border-red-300/20 bg-black/35 px-4 text-sm text-white outline-none placeholder:text-red-100/35 focus:border-red-300/40 focus:ring-2 focus:ring-red-200/10"
      />
      <DeleteAccountSubmitButton />
      <Link
        href="/delete-account"
        className="mt-3 block text-xs font-medium text-red-100/60 underline decoration-red-100/30 underline-offset-2 transition hover:text-red-100"
      >
        What is deleted and what is kept
      </Link>
    </form>
  );
}
