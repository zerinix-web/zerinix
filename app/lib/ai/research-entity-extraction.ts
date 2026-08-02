import type OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import type { ExtractedFact } from "@/app/lib/decision-intelligence";
import { withOpenAiCostOperation } from "./cost-instrumentation";
import {
  buildAnalysisProviderInput,
  type AnalysisAsset,
} from "./analysis-assets";
import {
  logAiModelRoutingDecision,
  resolveAiModelRoutingDecision,
} from "./model-router";

const researchEntityFields = [
  "asset_identification",
  "location",
  "province",
  "district",
  "neighborhood",
  "locality",
  "block",
  "parcel",
  "parcel_size",
  "property_type",
  "title_status",
  "coordinates",
  "currency",
  "organization",
  "person",
  "counterparty",
  "registration_number",
  "tax_identifier",
  "document_number",
  "contract_number",
  "invoice_number",
  "date",
  "effective_date",
  "expiry_date",
  "amount",
  "percentage",
  "product",
  "service",
  "industry",
  "website",
  "email",
  "phone",
  "address",
  "bank_account",
  "fiscal_period",
  "quantity",
  "unit",
  "legal_reference",
  "project",
  "other_identifier",
] as const;

function createEntityExtractionSchema() {
  return {
    type: "json_schema" as const,
    name: "zerinix_research_asset_entities",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              field: {
                type: "string",
                enum: [...researchEntityFields],
              },
              value: { type: "string" },
              source: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 100 },
            },
            required: ["field", "value", "source", "confidence"],
          },
        },
      },
      required: ["facts"],
    },
  };
}

export type ResearchEntityExtractionResult = {
  facts: ExtractedFact[];
  provider: "openai_asset_entity_extraction";
  providerConfigured: boolean;
  requestStartedAt: string;
  requestEndedAt: string;
  resultStatus: string;
  failureReason: string;
};

export async function extractResearchAssetEntities({
  client,
  model,
  prompt,
  assets,
  signal,
}: {
  client: OpenAI;
  model: string;
  prompt: string;
  assets: AnalysisAsset[];
  signal?: AbortSignal;
}): Promise<ResearchEntityExtractionResult> {
  const requestStartedAt = new Date().toISOString();
  const base = {
    provider: "openai_asset_entity_extraction" as const,
    providerConfigured: true,
    requestStartedAt,
  };
  const analyzableAssets = assets.filter(
    (asset) => asset.dataUrl || asset.textContent.trim()
  );

  if (analyzableAssets.length === 0) {
    return {
      ...base,
      facts: [],
      requestEndedAt: new Date().toISOString(),
      resultStatus: "skipped_with_reason",
      failureReason: "No asset content was available for entity extraction.",
    };
  }

  try {
    const routingDecision = resolveAiModelRoutingDecision({
      requestKind: "file_analysis",
      category: "extraction",
      previousModel: model,
    });
    logAiModelRoutingDecision(routingDecision, {
      endpoint: "research-entity-extraction",
      operation: "entity_extraction",
    });
    const response = await withOpenAiCostOperation(
      { operationName: "entity_extraction" },
      () => client.responses.create({
        model: routingDecision.routedModel,
        instructions: `Extract every useful named entity and identifier visibly present in every uploaded asset, while returning only facts actually present.
Never infer, geocode, correct, translate, or complete missing values.
Preserve Turkish names, identifiers, decimal separators, units, and document wording exactly.
For Turkish property records, capture province, district, neighborhood or village, locality, ada as block, parsel as parcel, tapu alanı with its unit as parcel_size, and nitelik as property_type.
For other domains, capture organizations, people, counterparties, registration and tax identifiers, document/contract/invoice numbers, dates, amounts, percentages, currency, products, services, industry, websites, contact details, addresses, accounts, fiscal periods, quantities, units, legal references, and projects whenever visibly present.
Inspect all pages, sheets, images, and text supplied; do not stop after the first entity or first asset.
Also emit location as the visible hierarchy joined from the extracted administrative place facts and asset_identification as the visible property/document identity.
Use the uploaded filename as source.`,
        input: buildAnalysisProviderInput(
          `Research entity extraction only.\nUser goal: ${prompt}`,
          analyzableAssets
        ) as ResponseInput,
        max_output_tokens: 1_500,
        reasoning: { effort: "minimal" },
        text: {
          verbosity: "low",
          format: createEntityExtractionSchema(),
        },
      }, signal ? { signal } : undefined)
    );

    if (response.status !== "completed" || !response.output_text.trim()) {
      return {
        ...base,
        facts: [],
        requestEndedAt: new Date().toISOString(),
        resultStatus: response.status || "unknown",
        failureReason: `Entity extraction returned no usable output; incomplete reason ${response.incomplete_details?.reason || "unknown"}.`,
      };
    }

    const parsed = JSON.parse(response.output_text) as {
      facts?: Array<{
        field?: unknown;
        value?: unknown;
        source?: unknown;
        confidence?: unknown;
      }>;
    };
    const assetNames = new Set(analyzableAssets.map((asset) => asset.name));
    const fallbackSource = analyzableAssets[0]?.name || "Uploaded asset";
    const facts = (Array.isArray(parsed.facts) ? parsed.facts : []).flatMap(
      (item): ExtractedFact[] => {
        const field = String(item.field || "");
        const value = String(item.value || "").trim().slice(0, 1_500);
        const suppliedSource = String(item.source || "").trim();
        const source = assetNames.has(suppliedSource)
          ? suppliedSource
          : fallbackSource;

        if (
          !researchEntityFields.includes(
            field as (typeof researchEntityFields)[number]
          ) ||
          !value
        ) {
          return [];
        }

        const rawConfidence =
          typeof item.confidence === "number" ? item.confidence : 0;
        const normalizedConfidence =
          rawConfidence > 0 && rawConfidence <= 1
            ? rawConfidence * 100
            : rawConfidence;

        return [
          {
            field,
            value,
            source,
            confidence: Math.max(
              0,
              Math.min(100, normalizedConfidence)
            ),
            category: "Verified Asset",
            verified: true,
            estimated: false,
            missing: false,
          },
        ];
      }
    );

    return {
      ...base,
      facts: facts.filter(
        (fact, index, items) =>
          items.findIndex(
            (candidate) =>
              candidate.field === fact.field &&
              candidate.value === fact.value &&
              candidate.source === fact.source
          ) === index
      ),
      requestEndedAt: new Date().toISOString(),
      resultStatus: response.status || "unknown",
      failureReason: facts.length
        ? ""
        : "Entity extraction completed but produced no visible normalized facts.",
    };
  } catch (error) {
    return {
      ...base,
      facts: [],
      requestEndedAt: new Date().toISOString(),
      resultStatus:
        error instanceof Error && /timeout|timed out|aborted/i.test(error.message)
          ? "timed_out"
          : "failed",
      failureReason:
        error instanceof Error ? error.message : "Entity extraction failed.",
    };
  }
}
