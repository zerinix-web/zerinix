import { AdminShell } from "../AdminShell";
import { AiCeoConsole } from "./AiCeoConsole";

export default async function AdminAiCeoPage() {
  return (
    <AdminShell
      eyebrow="Admin / AI CEO"
      title="AI CEO"
      subtitle="Ask operational questions about ZERINIX using approved internal admin aggregates. The assistant cannot execute SQL or browse private data beyond predefined server-side summaries."
    >
      <AiCeoConsole />
    </AdminShell>
  );
}
