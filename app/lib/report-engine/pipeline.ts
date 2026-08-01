export type ReportPipelineStage =
  | "request_validation"
  | "authentication"
  | "asset_extraction"
  | "entity_extraction"
  | "research"
  | "decision_engine"
  | "report_builder"
  | "pdf_preparation"
  | "memory"
  | "quota"
  | "cache_read"
  | "ai_call_budget"
  | "provider_call"
  | "response_status"
  | "response_extraction"
  | "json_parse"
  | "report_normalization"
  | "cache_write"
  | "usage_write"
  | "stream_response";

export function isPartialReportResult<TField extends string>(
  missingFields: readonly TField[],
  invalidFields: readonly TField[]
) {
  return Boolean(missingFields.length || invalidFields.length);
}

export function getCompletedReportFields<TField extends string>(
  fields: readonly TField[],
  missingFields: readonly TField[],
  invalidFields: readonly TField[]
) {
  return fields.filter(
    (fieldName) =>
      !missingFields.includes(fieldName) && !invalidFields.includes(fieldName)
  );
}
