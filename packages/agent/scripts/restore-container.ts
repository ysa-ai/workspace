import { rmSync, writeFileSync } from "fs";
import { resolve } from "path";

rmSync(resolve(import.meta.dir, "../src/container"), { recursive: true, force: true });
writeFileSync(
  resolve(import.meta.dir, "../src/container-assets.ts"),
  "// Stub — overwritten by scripts/prepare-container.ts before bun build --compile\nexport const assetPaths: Record<string, string> = {};\n"
);
console.log("Container assets restored to stub.");
