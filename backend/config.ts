import path from "node:path";
import { fileURLToPath } from "node:url";
export const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
export const config = {
  host: "127.0.0.1",
  port: Number(process.env.PORT ?? 1000),
  maxConcurrentDownloads: Math.max(
    1,
    Math.min(8, Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 4),
  ),
  dataDir: path.join(workspaceRoot, "data/inputs"),
  publicDir: path.join(workspaceRoot, "backend/public"),
  sheetUrl:
    "https://docs.google.com/spreadsheets/d/1J_hP-_yCvBONsKRhzpvHThImayse4InS8ZazRYV2upE/export?format=csv",
};
