import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");

test("mobile PDF delivery stays in the current webview without opening a popup", () => {
  assert.match(source, /function usesMobilePdfFlow\(\)/);
  assert.match(source, /window\.matchMedia\("\(max-width: 1023px\)"\)/);

  const mobileBranch = source.slice(
    source.indexOf("if (usesMobilePdfFlow())"),
    source.indexOf("const isSafari")
  );

  assert.match(mobileBranch, /window\.location\.assign\(url\)/);
  assert.doesNotMatch(mobileBranch, /window\.open/);
  assert.match(
    mobileBranch,
    /PDF could not be opened on this device\. Please try again\./
  );
});

test("desktop PDF delivery retains the existing Safari and download behavior", () => {
  const desktopBranch = source.slice(source.indexOf("const isSafari"));

  assert.match(desktopBranch, /window\.open\(url, "_blank"\)/);
  assert.match(desktopBranch, /link\.download = createFileName\(report\.title\)/);
  assert.match(desktopBranch, /link\.click\(\)/);
});
