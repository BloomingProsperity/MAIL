import { createConnection, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

export interface SendSmtpSmokeMessageInput {
  host: string;
  port: number;
  secure?: boolean;
  from: string;
  to: string;
  messageId: string;
  subject: string;
  text: string;
  timeoutMs?: number;
  now?: () => Date;
}

export interface SmtpSmokeDeliveryResult {
  host: string;
  port: number;
  to: string;
  messageId: string;
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

export async function sendSmtpSmokeMessage(
  input: SendSmtpSmokeMessageInput,
): Promise<SmtpSmokeDeliveryResult> {
  const normalized = normalizeInput(input);
  const socket = await openSocket(normalized);
  const reader = createSmtpReader(socket);

  try {
    await expectResponse(reader, [220], "SMTP greeting");
    await writeCommand(socket, reader, "EHLO emailhub-smoke.local", [250]);
    await writeCommand(socket, reader, `MAIL FROM:<${normalized.from}>`, [250]);
    await writeCommand(socket, reader, `RCPT TO:<${normalized.to}>`, [250, 251]);
    await writeCommand(socket, reader, "DATA", [354]);
    socket.write(`${buildMessage(normalized)}\r\n.\r\n`);
    await expectResponse(reader, [250], "SMTP message acceptance");
    await writeCommand(socket, reader, "QUIT", [221]);

    return {
      host: normalized.host,
      port: normalized.port,
      to: normalized.to,
      messageId: `<${normalized.messageId}>`,
    };
  } finally {
    socket.end();
    socket.destroy();
  }
}

async function openSocket(
  input: Required<SendSmtpSmokeMessageInput>,
): Promise<Socket> {
  const socket = input.secure
    ? connectTls({ host: input.host, port: input.port, servername: input.host })
    : createConnection({ host: input.host, port: input.port });

  socket.setEncoding("utf8");
  socket.setTimeout(input.timeoutMs);

  return await new Promise<Socket>((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
      socket.off("timeout", onTimeout);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new Error(`SMTP smoke connection timed out to ${input.host}:${input.port}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.once(input.secure ? "secureConnect" : "connect", onConnect);
    socket.once("timeout", onTimeout);
    socket.once("error", onError);
  });
}

function createSmtpReader(socket: Socket): () => Promise<SmtpResponse> {
  const lines: string[] = [];
  let buffer = "";
  let waiting:
    | {
        resolve: (line: string) => void;
        reject: (error: Error) => void;
      }
    | undefined;

  socket.on("data", (chunk) => {
    buffer += String(chunk);
    let nextLineIndex = buffer.indexOf("\r\n");
    while (nextLineIndex >= 0) {
      const line = buffer.slice(0, nextLineIndex);
      buffer = buffer.slice(nextLineIndex + 2);
      if (waiting) {
        const current = waiting;
        waiting = undefined;
        current.resolve(line);
      } else {
        lines.push(line);
      }
      nextLineIndex = buffer.indexOf("\r\n");
    }
  });

  socket.on("error", (error) => {
    if (waiting) {
      const current = waiting;
      waiting = undefined;
      current.reject(error);
    }
  });

  async function readLine(): Promise<string> {
    const line = lines.shift();
    if (line !== undefined) {
      return line;
    }

    return await new Promise<string>((resolve, reject) => {
      waiting = { resolve, reject };
    });
  }

  return async () => {
    const responseLines: string[] = [];
    let responseCode: number | undefined;

    while (true) {
      const line = await readLine();
      responseLines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) {
        continue;
      }

      responseCode = Number.parseInt(match[1], 10);
      if (match[2] === " ") {
        return { code: responseCode, lines: responseLines };
      }
    }
  };
}

async function writeCommand(
  socket: Socket,
  reader: () => Promise<SmtpResponse>,
  command: string,
  expectedCodes: number[],
): Promise<void> {
  socket.write(`${command}\r\n`);
  await expectResponse(reader, expectedCodes, command);
}

async function expectResponse(
  reader: () => Promise<SmtpResponse>,
  expectedCodes: number[],
  phase: string,
): Promise<SmtpResponse> {
  const response = await reader();
  if (!expectedCodes.includes(response.code)) {
    throw new Error(
      `SMTP smoke ${phase} expected ${expectedCodes.join("/")} but got ${
        response.code
      }: ${response.lines.join(" | ")}`,
    );
  }

  return response;
}

function buildMessage(input: Required<SendSmtpSmokeMessageInput>): string {
  const body = dotStuff(input.text).replace(/\r?\n/g, "\r\n");
  return [
    `Message-ID: <${input.messageId}>`,
    `Date: ${input.now().toUTCString()}`,
    `From: Email Hub Smoke <${input.from}>`,
    `To: <${input.to}>`,
    `Subject: ${sanitizeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

function dotStuff(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\n");
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function normalizeInput(
  input: SendSmtpSmokeMessageInput,
): Required<SendSmtpSmokeMessageInput> {
  const host = input.host.trim();
  const from = input.from.trim();
  const to = input.to.trim();
  const messageId = input.messageId.trim().replace(/^<|>$/g, "");
  const subject = input.subject.trim();

  if (!host) {
    throw new Error("SMTP smoke host is required");
  }
  if (!Number.isInteger(input.port) || input.port <= 0) {
    throw new Error("SMTP smoke port is required");
  }
  if (!from || !to || !messageId || !subject) {
    throw new Error("SMTP smoke from, to, messageId, and subject are required");
  }

  return {
    host,
    port: input.port,
    secure: input.secure ?? false,
    from,
    to,
    messageId,
    subject,
    text: input.text,
    timeoutMs: input.timeoutMs ?? 10000,
    now: input.now ?? (() => new Date()),
  };
}
