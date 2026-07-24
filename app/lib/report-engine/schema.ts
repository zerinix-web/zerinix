import type { ReportMetadata } from "@/app/lib/report-investment-score";

export type ResponseLanguage = "English" | "Turkish";

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
  done?: boolean;
  reportMetadata?: ReportMetadata;
  warning?: string;
  missingFields?: TField[];
  invalidFields?: TField[];
  partial?: boolean;
};

export function createFullReportJsonSchema(name: string, fields: readonly string[]) {
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
          {
            type: "string",
          },
        ])
      ),
      required: [...fields],
    },
  };
}
