import { spawn } from "node:child_process";

import type { ExecutionResult, TerminalLine } from "@collabcode/shared";

import { env } from "../config/env.js";
import { createId } from "../lib/id.js";

function createLine(stream: TerminalLine["stream"], text: string): TerminalLine {
  return {
    id: createId("term"),
    stream,
    text,
    createdAt: new Date().toISOString(),
  };
}

export interface SandboxRunOptions {
  code: string;
  onLine: (line: TerminalLine) => void;
}

export async function runPythonInSandbox(
  options: SandboxRunOptions,
): Promise<ExecutionResult> {
  if (/\binput\s*\(/.test(options.code)) {
    const lines: TerminalLine[] = [];
    const inputLine = createLine(
      "system",
      "input() недоступен в текущем sandbox-режиме (интерактивный stdin отключен). Используйте заранее заданные данные в коде.",
    );
    lines.push(inputLine);
    options.onLine(inputLine);
    return {
      status: "error",
      exitCode: null,
      lines,
    };
  }

  return new Promise((resolve) => {
    const lines: TerminalLine[] = [];
    const args = [
      "run",
      "--rm",
      "--network",
      "none",
      "--cpus",
      "0.5",
      "--memory",
      "128m",
      "-i",
      env.PYTHON_IMAGE,
    ];

    let settled = false;
    const processHandle = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      processHandle.kill("SIGKILL");
      const timeoutLine = createLine("system", "Выполнение остановлено по таймауту.");
      lines.push(timeoutLine);
      options.onLine(timeoutLine);
      settled = true;
      resolve({
        status: "timeout",
        exitCode: null,
        lines,
      });
    }, env.EXECUTION_TIMEOUT_MS);

    processHandle.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trimEnd();
      if (!text) {
        return;
      }

      for (const part of text.split("\n")) {
        const line = createLine("stdout", part);
        lines.push(line);
        options.onLine(line);
      }
    });

    processHandle.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trimEnd();
      if (!text) {
        return;
      }

      for (const part of text.split("\n")) {
        const line = createLine("stderr", part);
        lines.push(line);
        options.onLine(line);
      }
    });

    processHandle.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }

      const line = createLine(
        "system",
        `Docker sandbox недоступен: ${error.message}. Проверьте, что Docker запущен и образ собран.`,
      );
      lines.push(line);
      options.onLine(line);
      settled = true;
      resolve({
        status: "error",
        exitCode: null,
        lines,
      });
    });

    processHandle.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        status: exitCode === 0 ? "success" : "error",
        exitCode,
        lines,
      });
    });

    processHandle.stdin.write(options.code);
    processHandle.stdin.end();
  });
}
