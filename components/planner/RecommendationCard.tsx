"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { FileDetectionBadge, UrlDetectionBadge } from "./FileDetectionBadge";
import type { IntentRecommendation } from "./IntentDetector";
import {
  RecommendationActions,
  type RecommendationAction,
} from "./RecommendationActions";
import { RecommendationReason } from "./RecommendationReason";
import { UnderstandingCard } from "./UnderstandingCard";

const detectedPropertyFactDefinitions = [
  {
    key: "province",
    fields: ["province", "city", "il"],
    labels: { Turkish: "İl", English: "Province" },
  },
  {
    key: "district",
    fields: ["district", "county", "ilce", "ilçe"],
    labels: { Turkish: "İlçe", English: "District" },
  },
  {
    key: "neighborhood",
    fields: ["neighborhood", "village", "locality", "mahalle", "koy", "köy"],
    labels: { Turkish: "Mahalle", English: "Neighborhood" },
  },
  {
    key: "block",
    fields: ["block", "ada"],
    labels: { Turkish: "Ada", English: "Block" },
  },
  {
    key: "parcel",
    fields: ["parcel", "parsel"],
    labels: { Turkish: "Parsel", English: "Parcel" },
  },
  {
    key: "area",
    fields: ["parcel_size", "area", "surface_area", "yuzolcumu", "yüzölçümü"],
    labels: { Turkish: "Yüzölçümü", English: "Area" },
  },
  {
    key: "qualification",
    fields: ["property_type", "qualification", "land_type", "nitelik"],
    labels: { Turkish: "Nitelik", English: "Qualification" },
  },
] as const;

export function RecommendationCard({
  recommendation,
  isWorking,
  onAction,
}: {
  recommendation: IntentRecommendation;
  isWorking: boolean;
  onAction: (
    action: RecommendationAction,
    clarificationAnswers: Record<string, string>
  ) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = useMemo(
    () => recommendation.clarificationQuestions || [],
    [recommendation.clarificationQuestions]
  );
  const extractedFacts = useMemo(
    () => recommendation.understanding?.extractedAssetFacts || [],
    [recommendation.understanding]
  );
  const isTurkish =
    /[çğıöşüÇĞİÖŞÜ]/.test(recommendation.reason) ||
    /\b(?:gayrimenkul|belgesi|amacı)\b/i.test(recommendation.reason);

  const requiredQuestionsAnswered = useMemo(
    () =>
      questions.every(
        (question) =>
          !question.required || Boolean(answers[question.id]?.trim())
      ),
    [answers, questions]
  );
  const missingInformationLabels = useMemo(
    () =>
      questions
        .filter((question) => question.required)
        .map((question) => question.question),
    [questions]
  );
  const detectedPropertyFacts = useMemo(
    () =>
      detectedPropertyFactDefinitions.flatMap((definition) => {
        const fact = extractedFacts.find((item) =>
          definition.fields.some(
            (field) => field === item.field.trim().toLocaleLowerCase("tr-TR")
          )
        );

        return fact
          ? [
              {
                key: definition.key,
                label: isTurkish
                  ? definition.labels.Turkish
                  : definition.labels.English,
                value: fact.value,
              },
            ]
          : [];
      }),
    [extractedFacts, isTurkish]
  );

  return (
    <UnderstandingCard
      intent={recommendation.intent}
      confidence={recommendation.confidence}
    >
      <div className="mt-7 rounded-2xl bg-white/[0.04] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-100/75">
          {isTurkish ? "İçerik Özeti" : "Content Summary"}
        </p>
        <p className="mt-3 text-sm leading-6 text-zinc-200">
          {recommendation.understanding?.detectedIntent ||
            recommendation.reason}
        </p>
      </div>

      <div className="mt-7">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-100/75">
          {isTurkish ? "Önerilen Analizler" : "Recommended Analyses"}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {recommendation.analyses.map((analysis) => (
            <div
              key={analysis}
              className="flex min-h-12 items-center gap-3 rounded-2xl bg-white/[0.055] px-4 py-3 text-[15px] font-medium text-zinc-100"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-200/12">
                <Check className="h-3.5 w-3.5 text-teal-200" />
              </span>
              {analysis}
            </div>
          ))}
        </div>
      </div>

      {recommendation.detectedFiles.length > 0 || recommendation.detectedUrl ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {recommendation.detectedFiles.map((file) => (
            <FileDetectionBadge key={`${file.name}-${file.kind}`} file={file} />
          ))}
          {recommendation.detectedUrl ? (
            <UrlDetectionBadge detectedUrl={recommendation.detectedUrl} />
          ) : null}
        </div>
      ) : null}

      {missingInformationLabels.length > 0 ? (
        <div className="mt-6 rounded-2xl bg-white/[0.04] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-100/75">
            {isTurkish ? "Eksik Bilgiler" : "Missing Information"}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-zinc-300">
            {missingInformationLabels.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-teal-200" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detectedPropertyFacts.length > 0 ? (
        <div className="mt-6 rounded-2xl bg-white/[0.04] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-100/75">
            {isTurkish ? "Algılanan Bilgiler" : "Detected Information"}
          </p>
          <dl className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {detectedPropertyFacts.map((fact) => (
              <div key={fact.key} className="min-w-0">
                <dt className="text-xs text-zinc-500">{fact.label}</dt>
                <dd className="truncate text-sm font-medium text-zinc-100">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {questions.length > 0 ? (
        <fieldset className="mt-6 space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-100/75">
            {isTurkish ? "Sorular" : "Questions"}
          </legend>
          {questions.map((question) => (
            <div key={question.id}>
              <label
                htmlFor={`clarification-${question.id}`}
                className="block text-sm font-medium leading-6 text-zinc-100"
              >
                {question.question}
              </label>
              {question.options.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {question.options.map((option) => {
                    const selected = answers[question.id] === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: option,
                          }))
                        }
                        className={`rounded-full px-3 py-2 text-xs font-medium transition ${
                          selected
                            ? "bg-teal-200 text-black"
                            : "bg-white/[0.055] text-zinc-300 hover:bg-white/[0.09]"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  id={`clarification-${question.id}`}
                  value={answers[question.id] || ""}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  placeholder={question.placeholder}
                  className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-200/40"
                />
              )}
            </div>
          ))}
        </fieldset>
      ) : null}

      <div className="mt-6">
        <RecommendationReason reason={recommendation.reason} />
      </div>
      <div className="mt-6">
        <RecommendationActions
          isWorking={isWorking}
          primaryDisabled={!requiredQuestionsAnswered}
          primaryLabel={
            questions.length > 0
              ? isTurkish
                ? "Yanıtlarla Araştırmayı Başlat"
                : "Start Research with Answers"
              : isTurkish
                ? "Araştırmayı Başlat"
                : "Start Research"
          }
          secondaryLabel={isTurkish ? "Sohbet Olarak Devam Et" : "Continue as Chat"}
          onAction={(action) => onAction(action, answers)}
        />
      </div>
    </UnderstandingCard>
  );
}
