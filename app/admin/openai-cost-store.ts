import "server-only";

import { createServiceRoleClient } from "@/app/lib/supabase/admin";

export async function insertOpenAiCostEvent(row: Record<string, unknown>) {
  const supabase = createServiceRoleClient();
  return supabase.from("openai_cost_events").insert(row);
}

export async function selectOpenAiCostEvents(requestId: string) {
  const supabase = createServiceRoleClient();
  return supabase
    .from("openai_cost_events")
    .select(
      "call_id,operation_name,model,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,web_search_calls,estimated_input_cost_usd,estimated_output_cost_usd,estimated_tool_cost_usd,estimated_total_cost_usd,duration_ms,retry_count,cache_status,cache_savings_usd,duplicate_fingerprint"
    )
    .eq("request_id", requestId);
}

export async function upsertOpenAiCostSummary(row: Record<string, unknown>) {
  const supabase = createServiceRoleClient();
  return supabase
    .from("openai_cost_summaries")
    .upsert(row, { onConflict: "request_id" });
}
