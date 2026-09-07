import type { ReportMetadata } from "@/app/lib/report-investment-score";
export type { ResponseLanguage } from "@/app/lib/report-language";

export type ReportSectionPayload = {
  title: string;
  content: string;
};

export type ReportFieldDefinition<
  TField extends string = string,
  TIcon = unknown,
> = {
  field: TField;
  title: string;
  icon: TIcon;
};

export type ReportStreamEvent<
  TReport extends Record<string, string>,
  TField extends keyof TReport & string,
> = Partial<TReport> & {
  pipelineVersion?: string;
  pipelineStage?: string;
  pipelineRequestId?: string;
  done?: boolean;
  reportMetadata?: ReportMetadata;
  warning?: string;
  missingFields?: TField[];
  invalidFields?: TField[];
  partial?: boolean;
  error?: string;
  errorStage?: string;
  fatal?: boolean;
};

// TASK #69A-15A -- CRITICAL ARCHITECTURAL FIX: every field this function
// has ever produced a schema for was hardcoded to `{ type: "string" }`,
// with no way for any ONE report type to require a genuinely structured
// (non-string) field without changing this shared function's behavior
// for every OTHER report type that also calls it (real estate, generic
// domain analysis, acquisition). `fieldSchemaOverrides` is purely
// additive and backward-compatible: every existing call site that omits
// it (still every call site except Business Idea Validation's own,
// after this task) produces the exact same schema as before, byte for
// byte. Only the ONE call passing an override for a given field name
// gets a different property schema for that field -- every other field,
// and every other report type's schema entirely, is untouched.
export function createFullReportJsonSchema(
  name: string,
  fields: readonly string[],
  fieldSchemaOverrides?: Readonly<Record<string, Record<string, unknown>>>
) {
  return {
    type: "json_schema" as const,
    name,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        fields.map((field) => [
          field,
          fieldSchemaOverrides?.[field] ?? {
            type: "string",
          },
        ])
      ),
      required: [...fields],
    },
  };
}
