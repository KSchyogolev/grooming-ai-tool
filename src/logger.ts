export interface LogEntry {
  level: "info" | "warn" | "error";
  msg: string;
  issueId?: string | undefined;
  step?: string | undefined;
  durationMs?: number | undefined;
  [key: string]: unknown;
}

export type LogWriter = (line: string, level: "info" | "warn" | "error") => void;

const defaultWriter: LogWriter = (line, level) => {
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
};

let _writer: LogWriter = defaultWriter;

export function setWriter(w: LogWriter): void {
  _writer = w;
}

export function resetWriter(): void {
  _writer = defaultWriter;
}

function emit(entry: LogEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  _writer(line, entry.level);
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
