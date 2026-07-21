import { readFileSync } from "node:fs";
import type { ServerOptions } from "node:https";

export interface ServerTlsPaths {
  certPath?: string;
  keyPath?: string;
}

/** Reads the PEM certificate chain and matching private key at process start. */
export function loadServerHttpsOptions(
  paths: ServerTlsPaths,
): ServerOptions | undefined {
  if (!paths.certPath && !paths.keyPath) return undefined;
  if (!paths.certPath || !paths.keyPath) {
    throw new Error(
      "TLS_CERT_PATH and TLS_KEY_PATH must be configured together.",
    );
  }

  const cert = readPemFile(paths.certPath, "TLS certificate chain");
  const key = readPemFile(paths.keyPath, "TLS private key");
  return { cert, key };
}

function readPemFile(path: string, label: string): Buffer {
  let contents: Buffer;
  try {
    contents = readFileSync(path);
  } catch (cause) {
    throw new Error(`Could not read ${label} at ${path}.`, { cause });
  }
  if (contents.length === 0) {
    throw new Error(`${label} at ${path} is empty.`);
  }
  return contents;
}
