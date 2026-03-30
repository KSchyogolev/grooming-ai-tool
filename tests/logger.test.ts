import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { error, info, timed, warn } from "../src/logger";

describe("logger", () => {
  let captured: string[];
  let origLog: typeof console.log;
  let origError: typeof console.error;

  beforeEach(() => {
    captured = [];
    origLog = console.log;
    origError = console.error;
    console.log = (...args: unknown[]) => captured.push(String(args[0]));
    console.error = (...args: unknown[]) => captured.push(String(args[0]));
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  test("info outputs JSON with level and msg", () => {
    info("test message");
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("test message");
    expect(parsed.ts).toBeDefined();
  });

  test("warn outputs with warn level", () => {
    warn("warning", { issueId: "ENG-1" });
    const parsed = JSON.parse(captured[0] as string);
    expect(parsed.level).toBe("warn");
    expect(parsed.issueId).toBe("ENG-1");
  });

  test("error outputs with error level", () => {
    error("failed", { step: "test" });
    const parsed = JSON.parse(captured[0] as string);
    expect(parsed.level).toBe("error");
    expect(parsed.step).toBe("test");
  });

  test("timed measures duration on success", async () => {
    const result = await timed(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 42;
    }, "operation done");
    expect(result).toBe(42);
    const parsed = JSON.parse(captured[0] as string);
    expect(parsed.durationMs).toBeGreaterThanOrEqual(40);
    expect(parsed.msg).toBe("operation done");
  });

  test("timed logs error and rethrows on failure", async () => {
    try {
      await timed(async () => {
        throw new Error("boom");
      }, "operation");
      expect(true).toBe(false); // Should not reach
    } catch (err) {
      expect((err as Error).message).toBe("boom");
    }
    const parsed = JSON.parse(captured[0] as string);
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toContain("failed");
    expect(parsed.durationMs).toBeDefined();
  });
});
