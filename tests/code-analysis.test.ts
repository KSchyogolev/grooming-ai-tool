import { describe, expect, test } from "bun:test";
import { analyzeComplexity, extractImports } from "../src/lib/code-analysis";

describe("analyzeComplexity", () => {
  test("classifies simple file as low complexity", () => {
    const content = `export function hello() {
  return "world";
}

export function add(a: number, b: number): number {
  return a + b;
}
`;
    const result = analyzeComplexity("src/utils.ts", content);
    expect(result.complexity).toBe("low");
    expect(result.lines).toBe(8);
    expect(result.functions).toBe(2);
    expect(result.longFunctions).toHaveLength(0);
  });

  test("classifies deeply nested file as medium/high", () => {
    // Generate deeply nested code
    let content = "export function deep() {\n";
    for (let i = 0; i < 7; i++) {
      content += `${"  ".repeat(i + 1)}if (true) {\n`;
    }
    for (let i = 6; i >= 0; i--) {
      content += `${"  ".repeat(i + 1)}}\n`;
    }
    content += "}\n";
    // Pad to 250 lines
    for (let i = 0; i < 240; i++) {
      content += `// line ${i}\n`;
    }

    const result = analyzeComplexity("src/deep.ts", content);
    expect(result.maxIndentDepth).toBeGreaterThanOrEqual(6);
    expect(result.complexity).not.toBe("low");
  });

  test("detects long functions (>50 lines)", () => {
    let content = "export function longOne() {\n";
    for (let i = 0; i < 55; i++) {
      content += `  const x${i} = ${i};\n`;
    }
    content += "}\n\nexport function shortOne() {\n  return 1;\n}\n";

    const result = analyzeComplexity("src/long.ts", content);
    expect(result.longFunctions.length).toBeGreaterThanOrEqual(1);
    expect(result.longFunctions[0]).toContain("longOne");
  });

  test("classifies large file (>500 lines) as high complexity", () => {
    let content = "";
    for (let i = 0; i < 510; i++) {
      content += `const line${i} = ${i};\n`;
    }
    const result = analyzeComplexity("src/huge.ts", content);
    expect(result.complexity).toBe("high");
    expect(result.lines).toBe(511);
  });

  test("counts ES imports", () => {
    const content = `import { foo } from "./foo.js";
import bar from "../bar.js";
import type { Baz } from "@lib/baz";

export function main() {}
`;
    const result = analyzeComplexity("src/main.ts", content);
    expect(result.functions).toBeGreaterThanOrEqual(1);
    expect(result.lines).toBe(6);
  });

  test("handles empty file", () => {
    const result = analyzeComplexity("src/empty.ts", "");
    expect(result.lines).toBe(1);
    expect(result.functions).toBe(0);
    expect(result.complexity).toBe("low");
    expect(result.longFunctions).toHaveLength(0);
  });
});

describe("extractImports", () => {
  test("extracts ES module imports", () => {
    const content = `import { foo } from "./foo";\nimport bar from "../utils/bar";`;
    const result = extractImports(content, "src/features/index.ts");
    expect(result).toContain("src/features/foo");
    expect(result).toContain("src/utils/bar");
  });

  test("extracts dynamic imports", () => {
    const content = `const m = import("./lazy");`;
    const result = extractImports(content, "src/app.ts");
    expect(result).toContain("src/lazy");
  });

  test("extracts require calls", () => {
    const content = `const x = require("./helper");`;
    const result = extractImports(content, "src/index.ts");
    expect(result).toContain("src/helper");
  });

  test("extracts re-exports (export * from)", () => {
    const content = `export * from "./types";\nexport { foo } from "../utils";`;
    const result = extractImports(content, "src/features/index.ts");
    expect(result).toContain("src/features/types");
    expect(result).toContain("src/utils");
  });

  test("keeps external packages as-is", () => {
    const content = `import Anthropic from "@anthropic-ai/sdk";`;
    const result = extractImports(content, "src/index.ts");
    expect(result).toContain("@anthropic-ai/sdk");
  });

  test("deduplicates imports", () => {
    const content = `import { a } from "./foo";\nimport { b } from "./foo";`;
    const result = extractImports(content, "src/index.ts");
    expect(result.filter((i) => i === "src/foo")).toHaveLength(1);
  });
});
