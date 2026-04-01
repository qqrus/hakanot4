import { spawn } from "node:child_process";

import { env } from "../config/env.js";

type DockerStatus = "running" | "exited" | "created" | "not_found" | "unknown";

interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runDocker(args: string[]): Promise<DockerResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += error.message;
      resolve({ code: 1, stdout, stderr });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function ensureVolume(volumeName: string): Promise<void> {
  const inspect = await runDocker(["volume", "inspect", volumeName]);
  if (inspect.code === 0) {
    return;
  }
  const create = await runDocker(["volume", "create", volumeName]);
  if (create.code !== 0) {
    throw new Error(`Не удалось создать volume ${volumeName}: ${create.stderr || create.stdout}`);
  }
}

async function getContainerStatus(containerName: string): Promise<DockerStatus> {
  const inspect = await runDocker(["container", "inspect", containerName, "--format", "{{.State.Status}}"]);
  if (inspect.code !== 0) {
    if (/No such container/i.test(inspect.stderr)) {
      return "not_found";
    }
    return "unknown";
  }
  const status = inspect.stdout.trim();
  if (status === "running" || status === "exited" || status === "created") {
    return status;
  }
  return "unknown";
}

async function createRoomContainer(input: {
  containerId: string;
  volumeName: string;
}): Promise<void> {
  const create = await runDocker([
    "container",
    "create",
    "--name",
    input.containerId,
    "--network",
    "none",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "--volume",
    `${input.volumeName}:/workspace`,
    env.PYTHON_IMAGE,
    "sh",
    "-lc",
    "while true; do sleep 3600; done",
  ]);

  if (create.code !== 0) {
    throw new Error(
      `Не удалось создать контейнер ${input.containerId}: ${create.stderr || create.stdout}`,
    );
  }
}

export async function ensureRoomRuntimeArtifacts(input: {
  containerId: string;
  volumeName: string;
}): Promise<void> {
  await ensureVolume(input.volumeName);
  const status = await getContainerStatus(input.containerId);
  if (status === "not_found") {
    await createRoomContainer(input);
  }
}

export async function startRoomContainer(containerId: string): Promise<void> {
  const status = await getContainerStatus(containerId);
  if (status === "running") {
    return;
  }
  if (status === "not_found") {
    throw new Error("Контейнер комнаты не найден.");
  }
  const started = await runDocker(["container", "start", containerId]);
  if (started.code !== 0) {
    throw new Error(`Не удалось запустить контейнер ${containerId}: ${started.stderr || started.stdout}`);
  }
}

export async function stopRoomContainer(containerId: string): Promise<void> {
  const status = await getContainerStatus(containerId);
  if (status === "not_found" || status === "exited" || status === "created") {
    return;
  }
  const stopped = await runDocker(["container", "stop", containerId]);
  if (stopped.code !== 0) {
    throw new Error(`Не удалось остановить контейнер ${containerId}: ${stopped.stderr || stopped.stdout}`);
  }
}

export async function inspectRoomContainerStatus(containerId: string): Promise<DockerStatus> {
  return getContainerStatus(containerId);
}
