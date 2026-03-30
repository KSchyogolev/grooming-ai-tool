export interface LogEntry {
  level: "info" | "warn" | "error";
  msg: string;
  issueId?: string | undefined;
  step?: string | undefined;
  durationMs?: number | undefined;
  [key: string]: unknown;
}

function emit(entry: LogEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  if (entry.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function info(msg: string, extra?: Omit<LogEntry, "level" | "msg">): void {
  emit({ level: "info", msg, ...extra });
}

export function warn(msg: string, extra?: Omit<LogEntry, "level" | "msg">): void {
  emit({ level: "warn", msg, ...extra });
}

export function error(msg: string, extra?: Omit<LogEntry, "level" | "msg">): void {
  emit({ level: "error", msg, ...extra });
}

export function timed<T>(
  fn: () => Promise<T>,
  msg: string,
  extra?: Omit<LogEntry, "level" | "msg" | "durationMs">,
): Promise<T> {
  const start = Date.now();
  return fn().then(
    (result) => {
      info(msg, { ...extra, durationMs: Date.now() - start });
      return result;
    },
    (err) => {
      error(`${msg} — failed`, { ...extra, durationMs: Date.now() - start, error: String(err) });
      throw err;
    },
  );
}
