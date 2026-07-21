import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerHttpsOptions } from "../../src/server/server-https";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadServerHttpsOptions", () => {
  it("keeps local development on HTTP when no TLS paths are configured", () => {
    expect(loadServerHttpsOptions({})).toBeUndefined();
  });

  it("reads a mounted certificate chain and private key", () => {
    const directory = mkdtempSync(join(tmpdir(), "role-player-tls-"));
    directories.push(directory);
    const certPath = join(directory, "fullchain.pem");
    const keyPath = join(directory, "privkey.pem");
    writeFileSync(certPath, "certificate-chain");
    writeFileSync(keyPath, "private-key");

    const options = loadServerHttpsOptions({ certPath, keyPath });

    expect(options?.cert).toEqual(Buffer.from("certificate-chain"));
    expect(options?.key).toEqual(Buffer.from("private-key"));
  });

  it("rejects partial or unreadable TLS configuration", () => {
    expect(() =>
      loadServerHttpsOptions({ certPath: "/missing/fullchain.pem" }),
    ).toThrow("must be configured together");
    expect(() =>
      loadServerHttpsOptions({
        certPath: "/missing/fullchain.pem",
        keyPath: "/missing/privkey.pem",
      }),
    ).toThrow("Could not read TLS certificate chain");
  });
});
