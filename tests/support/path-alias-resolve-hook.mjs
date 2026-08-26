import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Node ESM "resolve" hook (registered via register-path-alias.mjs) that
// teaches plain `node --test` the SAME "@/*" -> "./*" path alias
// tsconfig.json and the Next.js bundler already resolve. Without this,
// any file with a REAL (non type-only) "@/"-aliased import throws
// ERR_MODULE_NOT_FOUND under plain node, because "@/" is not a valid
// npm scope and Node has no built-in concept of a tsconfig path alias.
//
// This is a resolve-time rewrite only -- it does not change what any
// file imports or how Next.js resolves it; it only lets the SAME
// source resolve under node's own module loader as well, which is what
// makes app/lib/decision-engine-v2/shadow-mode.ts (and any other module
// with a real "@/" value import) unit-testable without the full Next.js
// bundler and without rewriting production import statements to suit
// one runtime over the other.
//
// Inert for every specifier that does not start with "@/" -- existing
// tests that never hit this path are entirely unaffected.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }

  const relativePath = specifier.slice(2);
  const hasExtension = path.extname(relativePath) !== "";
  const absolutePath = path.join(repoRoot, hasExtension ? relativePath : `${relativePath}.ts`);
  const target = pathToFileURL(absolutePath).href;
  return nextResolve(target, context);
}
