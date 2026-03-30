import type { IncomingMessage, ServerResponse } from "node:http";
import { handleLinearWebhook } from "../../src/webhook";

export const config = {
  maxDuration: 300,
  api: { bodyParser: false },
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const rawBody = await readBody(req);
  const signature = (req.headers["linear-signature"] as string) ?? null;

  const result = await handleLinearWebhook(rawBody, signature);

  res.writeHead(result.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result.body));
}
