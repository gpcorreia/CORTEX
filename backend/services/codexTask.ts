import { spawn } from "node:child_process";
import { findCodex, subscriptionEnvironment, cliStatus } from "./codexCli.js";
export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}
export async function codexTask(
  prompt: string,
  cwd: string,
  schema: string,
  writable: boolean,
  progress: (message: string) => void = () => {},
) {
  const auth = await cliStatus();
  if (!auth.subscriptionReady) throw new Error(auth.message);
  const executable = await findCodex();
  return await new Promise<{ result: any; usage: TokenUsage | null }>(
    (resolve, reject) => {
      const child = spawn(
        executable,
        [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--ephemeral",
          "--sandbox",
          writable ? "workspace-write" : "read-only",
          "-c",
          'forced_login_method="chatgpt"',
          "-c",
          "sandbox_workspace_write.network_access=false",
          // Bound tool transcripts in worker history; preserve full prompts and schemas.
          "-c",
          "tool_output_token_limit=4000",
          "-c",
          'model_verbosity="low"',
          "--output-schema",
          schema,
          "-",
        ],
        {
          cwd,
          windowsHide: true,
          env: subscriptionEnvironment(),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let buffer = "",
        last = "",
        error = "",
        usage: TokenUsage | null = null;
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
      child.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (
              event.type === "item.completed" &&
              event.item?.type === "agent_message"
            ) {
              last = String(event.item.text);
              if (!last.trim().startsWith("{")) progress(last.slice(0, 500));
            }
            if (event.type === "turn.completed" && event.usage) {
              usage = {
                inputTokens:
                  (usage?.inputTokens ?? 0) + event.usage.input_tokens,
                cachedInputTokens:
                  (usage?.cachedInputTokens ?? 0) +
                  (event.usage.cached_input_tokens ?? 0),
                outputTokens:
                  (usage?.outputTokens ?? 0) + event.usage.output_tokens,
              };
            }
            if (event.type === "error" || event.type === "turn.failed")
              error = String(
                event.message ?? event.error?.message ?? "Falha no Codex",
              ).slice(0, 1500);
          } catch {}
        }
      });
      child.stderr.on("data", (data) => {
        error = (error + data.toString()).slice(-2000);
      });
      child.on("error", reject);
      child.on("close", () => {
        try {
          resolve({ result: JSON.parse(last), usage });
        } catch {
          reject(
            new Error(
              error ||
                "O Codex terminou sem resultado. Não foi gasto processamento em novas tentativas.",
            ),
          );
        }
      });
    },
  );
}
