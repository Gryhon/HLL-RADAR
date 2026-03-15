import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

/**
 * Dev-only plugin: POST /__dev/save-strong-points
 * Writes strong point positions directly into maps.ts so they're
 * committed to the codebase and available to all users.
 */
function strongPointEditor(): Plugin {
  return {
    name: "strong-point-editor",
    configureServer(server) {
      server.middlewares.use("/__dev/save-strong-points", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const { mapKey, strongPoints } = JSON.parse(body) as {
              mapKey: string;
              strongPoints: { name: string; x: number; y: number; r?: number }[];
            };

            const mapsFile = path.resolve(
              __dirname,
              "src/config/maps.ts"
            );
            let content = fs.readFileSync(mapsFile, "utf-8");

            // Build the new strongPoints block
            const spLines = strongPoints
              .map((sp) => {
                const rPart = sp.r != null ? `, r: ${sp.r}` : "";
                return `      { name: "${sp.name}", x: ${sp.x}, y: ${sp.y}${rPart} },`;
              })
              .join("\n");
            const spBlock = `strongPoints: [\n${spLines}\n    ],`;

            // Find the map config block for this key
            // Match: mapKey: { ... } up to the next top-level key or closing brace
            const mapBlockRegex = new RegExp(
              `(  ${mapKey}:\\s*\\{[\\s\\S]*?)(strongPoints:\\s*\\[[\\s\\S]*?\\],)([\\s\\S]*?\\n  \\})`,
            );
            const hasExisting = mapBlockRegex.test(content);

            if (hasExisting) {
              // Replace existing strongPoints array
              content = content.replace(mapBlockRegex, `$1${spBlock}$3`);
            } else {
              // Insert strongPoints before the closing brace of this map config
              const insertRegex = new RegExp(
                `(  ${mapKey}:\\s*\\{[\\s\\S]*?)(\\n  \\})`
              );
              content = content.replace(
                insertRegex,
                `$1\n    ${spBlock}$2`
              );
            }

            fs.writeFileSync(mapsFile, content, "utf-8");

            res.setHeader("Content-Type", "application/json");
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            console.error("Failed to save strong points:", err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), strongPointEditor()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8081",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8081",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
