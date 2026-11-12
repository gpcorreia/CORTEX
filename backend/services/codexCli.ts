import { spawn } from "node:child_process";
import { readdir, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export async function findCodex(): Promise<string> {
  if (process.env.CODEX_BIN) {
    await access(process.env.CODEX_BIN);
    return process.env.CODEX_BIN;
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const file = path.join(
      directory,
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    try {
      await access(file);
      return file;
    } catch {}
  }
  if (process.platform === "win32") {
    const extensions = path.join(os.homedir(), ".vscode", "extensions");
    const names = await readdir(extensions).catch(() => []);
    for (const name of names
      .filter((n) => n.startsWith("openai.chatgpt-"))
      .sort()
      .reverse()) {
      const file = path.join(
        extensions,
        name,
        "bin",
        "windows-x86_64",
        "codex.exe",
      );
      try {
        await access(file);
        return file;
      } catch {}
    }
  }
  throw new Error(
    "Codex CLI não encontrado. Define CODEX_BIN com o caminho do executável.",
  );
}
export function subscriptionEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (["OPENAI_API_KEY", "CODEX_API_KEY"].includes(key.toUpperCase()))
      delete env[key];
  return env;
}
export async function cliStatus() {
  try {
    const executable = await findCodex();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, ["login", "status"], {
        windowsHide: true,
        env: subscriptionEnvironment(),
      });
      let text = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("O Codex não respondeu."));
      }, 10000);
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(text);
      });
    });
    const chatgpt = /logged in using chatgpt/i.test(output);
    return {
      installed: true,
      subscriptionReady: chatgpt,
      message: chatgpt
        ? "Codex autenticado com ChatGPT."
        : "Inicia sessão no terminal com codex login para usar a subscrição.",
    };
  } catch (e) {
    return {
      installed: false,
      subscriptionReady: false,
      message: (e as Error).message,
    };
  }
}
