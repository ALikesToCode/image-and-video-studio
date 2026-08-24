import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const apiRoot = fileURLToPath(new URL("../app/api/", import.meta.url));

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(entryPath);
    return entry.name === "route.ts" ? [entryPath] : [];
  });
}

test("Cloudflare API routes use OpenNext's supported Node runtime", () => {
  const edgeRoutes = collectRouteFiles(apiRoot)
    .filter((routeFile) =>
      /export\s+const\s+runtime\s*=\s*["']edge["']/.test(
        readFileSync(routeFile, "utf8")
      )
    )
    .map((routeFile) => path.relative(apiRoot, routeFile))
    .sort();

  assert.deepEqual(
    edgeRoutes,
    [],
    "OpenNext Cloudflare cannot load Next edge route entries in the default Worker"
  );
});
