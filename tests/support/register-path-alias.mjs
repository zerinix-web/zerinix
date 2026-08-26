import { register } from "node:module";

// Loaded via `node --import` (see package.json's "test" script). Runs
// once in the main thread and installs the resolve hook that teaches
// plain `node --test` the "@/*" -> repo-root path alias tsconfig.json
// and Next.js already use -- see path-alias-resolve-hook.mjs for why
// this is necessary.
register("./path-alias-resolve-hook.mjs", import.meta.url);
