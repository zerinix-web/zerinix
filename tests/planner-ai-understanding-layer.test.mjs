import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const detectorSource = await readFile(
  new URL("../components/planner/IntentDetector.ts", import.meta.url),
  "utf8"
);
const recommendationSource = await readFile(
  new URL("../components/planner/RecommendationCard.tsx", import.meta.url),
  "utf8"
);
const recommendationActionsSource = await readFile(
  new URL("../components/planner/RecommendationActions.tsx", import.meta.url),
  "utf8"
);
const understandingSource = await readFile(
  new URL("../components/planner/UnderstandingCard.tsx", import.meta.url),
  "utf8"
);
const mobileSource = await readFile(
  new URL("../components/planner/MobileConversationExperience.tsx", import.meta.url),
  "utf8"
);
const chatRouteSource = await readFile(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);
const composerSuggestionsSource = await readFile(
  new URL("../components/planner/composer-suggestions.ts", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const reportWorkerSource = await readFile(
  new URL("../app/lib/report-jobs/worker.ts", import.meta.url),
  "utf8"
);
const marketRouteSource = await readFile(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
const attachmentsSource = await readFile(
  new URL("../components/planner/useAttachments.ts", import.meta.url),
  "utf8"
);
const analysisAssetsSource = await readFile(
  new URL("../app/lib/ai/analysis-assets.ts", import.meta.url),
  "utf8"
);
const betaAccessSource = await readFile(
  new URL("../app/lib/beta-access.ts", import.meta.url),
  "utf8"
);
const strategicReportAccessSource = await readFile(
  new URL("../app/lib/strategic-report-access.ts", import.meta.url),
  "utf8"
);
const reportErrorsSource = await readFile(
  new URL("../app/lib/report-errors.ts", import.meta.url),
  "utf8"
);
const reportFormatterSource = await readFile(
  new URL("../app/lib/report-engine/formatter.ts", import.meta.url),
  "utf8"
);
const reportUtilsSource = await readFile(
  new URL("../app/dashboard/report-utils.ts", import.meta.url),
  "utf8"
);

test("planner uses one universal input and gates execution behind understanding", () => {
  assert.match(plannerSource, /Turn complex inputs into clear decisions\./);
  assert.match(plannerSource, /Select an analysis type to continue\./);
  assert.match(plannerSource, /Business Idea Validation/);
  assert.match(plannerSource, /Market Intelligence/);
  assert.match(plannerSource, /Strategic Advisory/);
  assert.match(plannerSource, /submitForUnderstanding/);
  assert.match(plannerSource, /requestUniversalUnderstanding/);
  assert.match(plannerSource, /universalUnderstandingSchema\.safeParse/);
  assert.match(plannerSource, /pendingRecommendation/);
  assert.match(plannerSource, /!hasSelectedAnalysisMode/);
});

test("polished composer uses contextual suggestions and a calm understanding transition", () => {
  assert.match(plannerSource, /"Analyze"/);
  assert.doesNotMatch(plannerSource, /"Understand"/);
  assert.match(plannerSource, /getComposerSuggestions\(draft\)/);
  assert.doesNotMatch(plannerSource, /const firstInteractionSuggestions/);
  assert.match(plannerSource, /isUnderstanding/);
  assert.match(
    understandingSource,
    /ZERINIX is understanding your request\.\.\./
  );
  assert.match(
    plannerSource,
    /Ask a question, describe your objective, paste a URL, or add files for context\./
  );
});

test("typing state is isolated and full detection runs only after Analyze", () => {
  const composerStart = plannerSource.indexOf("const ChatComposer = memo");
  const plannerStart = plannerSource.indexOf("export default function Planner");
  const composerSource = plannerSource.slice(composerStart, plannerStart);
  const understandingStart = plannerSource.indexOf(
    "async function submitForUnderstanding"
  );
  const understandingEnd = plannerSource.indexOf(
    "async function continueRecommendationAsChat"
  );
  const analyzeSource = plannerSource.slice(understandingStart, understandingEnd);

  assert.match(composerSource, /const \[draft, setDraft\] = useState\(""\)/);
  assert.doesNotMatch(plannerSource, /\[chatPrompt, setChatPrompt\]/);
  assert.doesNotMatch(composerSource, /detectPlannerIntent/);
  assert.doesNotMatch(
    composerSuggestionsSource,
    /detectPlannerIntent|new URL|attachments/
  );
  assert.match(analyzeSource, /requestUniversalUnderstanding/);
  assert.match(analyzeSource, /recommendationFromUnderstanding/);
});

test("recommendation actions use chat or the single Decision Intelligence report pipeline", () => {
  assert.match(plannerSource, /continueRecommendationAsChat/);
  assert.match(
    plannerSource,
    /await sendChatMessage\(chatPrompt,\s*true,\s*"",\s*queuedAttachments\)/
  );
  assert.match(
    plannerSource,
    /createUniversalReportReadiness\([\s\S]*void generatePlan\(\s*reportPrompt,\s*true,\s*queuedAttachments,\s*reportReadiness,\s*recommendation\.reportMode\s*\)/
  );
  assert.match(plannerSource, /"X-Zerinix-Universal-Input": "true"/);
  assert.match(plannerSource, /reportReadiness/);
  assert.doesNotMatch(plannerSource, /fetch\("\/api\/market-analysis"/);
  assert.doesNotMatch(plannerSource, /function analyzeMarket\(/);
  assert.match(plannerSource, /"X-Zerinix-Pipeline": "decision_intelligence_v1"/);
  assert.match(recommendationSource, /RecommendationActions/);
  assert.match(recommendationActionsSource, /Generate Strategic Report/);
  assert.match(recommendationActionsSource, /Continue as Chat/);
  assert.match(
    recommendationActionsSource,
    /onAction\("continue_as_chat"\)/
  );
  assert.match(
    recommendationActionsSource,
    /onAction\("generate_strategic_report"\)/
  );
  assert.match(
    plannerSource,
    /if \(action === "continue_as_chat"\)[\s\S]*continueRecommendationAsChat\(clarificationAnswers\)[\s\S]*return;/
  );
});

test("completed report payloads render even when research contains advisory warnings", () => {
  assert.match(reportErrorsSource, /isReportAdvisoryWarningText/);
  assert.match(reportErrorsSource, /provider_unavailable/);
  assert.match(reportErrorsSource, /could not be verified/);
  assert.match(
    reportErrorsSource,
    /if \(isReportAdvisoryWarningText\(normalized\)\) \{\s*return false;/
  );
  assert.match(reportWorkerSource, /if \(event\.fatal === false\)/);
  assert.match(reportWorkerSource, /warnings\.push\(errorText\)/);
  assert.match(reportWorkerSource, /persistCompletedReport/);
  assert.match(plannerSource, /jobStatus\.status === "completed"/);
  assert.match(plannerSource, /const reportCompleted =[\s\S]*hasCompletePayload/);
  assert.match(plannerSource, /moveReportAdvisoriesIntoWarningsSection/);
  assert.match(plannerSource, /Warnings \/ Missing Evidence/);
  assert.doesNotMatch(
    plannerSource,
    /if \(isReportGenerationFailureText\(chunk\)\)/
  );
  assert.doesNotMatch(
    plannerSource,
    /Report completed, but (?:conversation|report) persistence failed/
  );
  assert.doesNotMatch(
    reportFormatterSource,
    /containsReportGenerationFailure/
  );
  assert.doesNotMatch(
    reportFormatterSource,
    /isReportGenerationFailureText/
  );
  assert.match(
    reportUtilsSource,
    /const failedReport = rowStatus\.toLowerCase\(\) !== "completed"/
  );
});

test("detector covers business, file, image, spreadsheet, and URL understanding locally", () => {
  for (const intent of [
    "Business Idea",
    "Business Expansion",
    "Market Research",
    "Competitor Analysis",
    "Strategic Advisory",
    "Financial Planning",
    "Pricing Strategy",
    "Investment Analysis",
    "Contract Review",
    "Spreadsheet Analysis",
    "Image Analysis",
    "Website Analysis",
    "Company Analysis",
    "Location Intelligence",
    "Real Estate",
    "General Chat",
  ]) {
    assert.match(detectorSource, new RegExp(`"${intent}"`));
  }

  assert.match(detectorSource, /Google Maps/);
  assert.match(detectorSource, /LinkedIn/);
  assert.match(detectorSource, /Amazon Product/);
  assert.match(detectorSource, /Financial Spreadsheet/);
  assert.match(detectorSource, /Commercial Contract/);
  assert.match(detectorSource, /Receipt Image/);
  assert.match(detectorSource, /Chart Image/);
  assert.match(detectorSource, /isAmbiguousBusinessRequest/);
  assert.doesNotMatch(detectorSource, /fetch\(/);
});

test("mobile keeps the same universal understanding and attachment flow", () => {
  assert.match(mobileSource, /What do you want to accomplish today\?/);
  assert.match(mobileSource, /recommendationContent/);
  assert.match(mobileSource, /type="file"/);
  assert.match(mobileSource, /attachments\.length/);
});

test("shared asset validation accepts the universal input file families", () => {
  for (const extension of [
    "pdf",
    "docx",
    "pptx",
    "xlsx",
    "txt",
    "zip",
    "png",
    "jpeg",
    "webp",
  ]) {
    assert.match(analysisAssetsSource, new RegExp(`"${extension}"`));
  }
});

test("file upload queues attachments and waits for explicit mode selection and Analyze", () => {
  const uploadStart = plannerSource.indexOf(
    "async function handlePlannerFiles"
  );
  const uploadEnd = plannerSource.indexOf(
    "async function handlePlannerDrop"
  );
  const uploadSource = plannerSource.slice(uploadStart, uploadEnd);

  assert.match(attachmentsSource, /return uploadedFiles/);
  assert.match(uploadSource, /await handleFiles\(files\)/);
  assert.doesNotMatch(
    uploadSource,
    /requestUniversalUnderstanding|generatePlan|analyzeMarket|sendChatMessage/
  );
  assert.match(plannerSource, /selectedMode === "chat"/);
  assert.match(plannerSource, /analysisMode: requestedMode/);
  assert.match(plannerSource, /analysisMode: "chat" as const/);
});

test("stale conversation hydration cannot replace an explicit new analysis", () => {
  const hydrationStart = plannerSource.indexOf(
    "async function loadPersistedConversations"
  );
  const hydrationEnd = plannerSource.indexOf(
    "async function loadPersistedMessages",
    hydrationStart
  );
  const hydrationSource = plannerSource.slice(hydrationStart, hydrationEnd);
  const newConversationStart = plannerSource.indexOf(
    "async function createNewConversation"
  );
  const newConversationEnd = plannerSource.indexOf(
    "function renameConversation",
    newConversationStart
  );
  const newConversationSource = plannerSource.slice(
    newConversationStart,
    newConversationEnd
  );

  assert.match(
    newConversationSource,
    /conversationNavigationGenerationRef\.current \+= 1/
  );
  assert.match(
    hydrationSource,
    /const hydrationGeneration = conversationNavigationGenerationRef\.current/
  );
  assert.match(
    hydrationSource,
    /hydrationGeneration !== conversationNavigationGenerationRef\.current/
  );
  assert.match(
    hydrationSource,
    /if \(hydrationIsStale\)[\s\S]*setConversations[\s\S]*return;[\s\S]*setConversations\(nextConversations\)/
  );
});

test("Strategic Advisory cannot enter the Blob PDF path without explicit export intent", () => {
  const pdfStart = plannerSource.indexOf("async function downloadPdf");
  const pdfEnd = plannerSource.indexOf(
    "if (isPrivateBetaReportRestriction",
    pdfStart
  );
  const pdfSource = plannerSource.slice(pdfStart, pdfEnd);
  const chatStart = plannerSource.indexOf("async function sendChatMessage");
  const chatEnd = plannerSource.indexOf(
    "async function generatePlan",
    chatStart
  );
  const chatSource = plannerSource.slice(chatStart, chatEnd);

  assert.match(pdfSource, /event\.preventDefault\(\)/);
  assert.match(pdfSource, /event\.stopPropagation\(\)/);
  assert.match(pdfSource, /pdfExportIntentRef\.current = 0/);
  assert.match(
    pdfSource,
    /if \(!event\.isTrusted \|\| intentAge < 0 \|\| intentAge > 2_000\)[\s\S]*return;[\s\S]*URL\.createObjectURL/
  );
  assert.match(
    plannerSource,
    /onPointerDown=\{\(\) => \{[\s\S]*pdfExportIntentRef\.current = Date\.now\(\)/
  );
  assert.doesNotMatch(
    chatSource,
    /downloadPdf|runPdfExport|createObjectURL|window\.open|location\.href/
  );
  assert.match(chatSource, /fetch\("\/api\/chat"/);
});

test("PDF Excel Word and image detections preserve the existing chat file pipeline", () => {
  for (const extension of ["pdf", "docx", "xlsx", "png"]) {
    assert.equal(plannerSource.includes(`.${extension}`), true);
  }

  for (const detection of [
    "Commercial Contract",
    "Financial Spreadsheet",
    "Invoice",
    "Land Registry Document",
    "Business Plan",
    "Pitch Deck",
    "Image",
  ]) {
    assert.match(detectorSource, new RegExp(`"${detection}"`));
  }

  const continueStart = plannerSource.indexOf(
    "async function continueRecommendationAsChat"
  );
  const continueEnd = plannerSource.indexOf(
    "function generateRecommendedReport"
  );
  const continueSource = plannerSource.slice(continueStart, continueEnd);

  assert.match(continueSource, /attachments: queuedAttachments/);
  assert.match(
    continueSource,
    /sendChatMessage\(chatPrompt,\s*true,\s*"",\s*queuedAttachments\)/
  );
  assert.match(
    plannerSource,
    /const currentAttachments =\s*attachmentOverride\?\.length \? attachmentOverride : attachments/
  );
  assert.match(
    plannerSource,
    /const queuedAttachments = lastRequest\?\.attachments \|\| \[\]/
  );
  assert.match(
    plannerSource,
    /sendChatMessage\(submittedPrompt,\s*false,\s*"",\s*queuedAttachments\)/
  );
  assert.match(
    plannerSource,
    /attachments: serializePlannerAttachments\(currentAttachments\)/
  );
  assert.match(plannerSource, /requestMode,/);
  assert.match(plannerSource, /dataUrl: attachment\.dataUrl/);
  assert.match(plannerSource, /chatRequestInFlightRef\.current/);
  assert.match(chatRouteSource, /body\?\.requestMode === "file_analysis"/);
  assert.match(chatRouteSource, /!betaAccessAllowed && !isFileAnalysis/);
  assert.match(chatRouteSource, /buildAttachmentModelContent/);
  assert.match(analysisAssetsSource, /type: "input_image"/);
  assert.match(analysisAssetsSource, /type: "input_file"/);
  assert.match(chatRouteSource, /input: providerInput/);
  assert.match(chatRouteSource, /requestKind === "file_analysis"/);
});

test("assets and URLs become first-class context in chat and strategic reports", () => {
  assert.match(chatRouteSource, /extractAnalysisUrls\(prompt\)/);
  assert.match(chatRouteSource, /shouldUseAnalysisWebResearch\(prompt, attachments\)/);
  assert.match(chatRouteSource, /type: "web_search_preview"/);
  assert.match(chatRouteSource, /primary user-supplied evidence/);

  assert.match(
    plannerSource,
    /attachments: serializePlannerAttachments\(reportAttachments\)/g
  );

  for (const routeSource of [planRouteSource, marketRouteSource]) {
    assert.match(routeSource, /getAnalysisAssetValidationError/);
    assert.match(routeSource, /normalizeAnalysisAssets/);
    assert.match(routeSource, /buildAnalysisAssetContext/);
    assert.match(routeSource, /buildAnalysisAssetEvidenceInstructions/);
    assert.match(routeSource, /buildAnalysisProviderInput/);
    assert.match(routeSource, /createAnalysisAssetFingerprint/);
    assert.match(routeSource, /Uploaded asset evidence/);
    assert.match(routeSource, /type: "web_search_preview"/);
  }
});

test("localhost development bypass is limited to authenticated owners and admins", () => {
  assert.match(
    betaAccessSource,
    /process\.env\.NODE_ENV !== "development" \|\|\s*process\.env\.VERCEL/
  );
  assert.match(
    betaAccessSource,
    /hostname === "localhost"[\s\S]*hostname === "127\.0\.0\.1"[\s\S]*hostname === "\[::1\]"/
  );
  assert.match(
    betaAccessSource,
    /isFounderAccount\(account\) \|\| hasVerifiedAdminOrOwnerClaim\(account\)/
  );
  assert.match(
    strategicReportAccessSource,
    /isLocalDevelopmentOwnerOrAdmin\(request, account\)/
  );
  assert.match(strategicReportAccessSource, /"local_development_owner_admin"/);
  for (const routeSource of [
    chatRouteSource,
    planRouteSource,
    marketRouteSource,
  ]) {
    assert.match(routeSource, /authorizeStrategicReportAccess/);
  }
});

test("private beta report denial stays authorized and renders as neutral information", () => {
  for (const routeSource of [planRouteSource, marketRouteSource]) {
    assert.match(routeSource, /if \(!reportAccess\.allowed\)/);
    assert.match(routeSource, /Private beta access only\./);
    assert.match(routeSource, /status: 403/);
  }

  assert.match(
    plannerSource,
    /Strategic Reports are currently limited to approved beta users\./
  );
  assert.match(
    plannerSource,
    /Your request was understood successfully, but full report generation is not/
  );
  assert.match(plannerSource, /Continue as Chat/);
  assert.match(plannerSource, /Back to Workspace/);
  assert.doesNotMatch(plannerSource, /Request Beta Access/);
});
