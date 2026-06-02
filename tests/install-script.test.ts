import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { releaseAssetName, platformPackageConfig } from "../scripts/build-npm-package";

describe("release binary install contract", () => {
  test("linux x64 release asset uses tar.gz name for template curl install", () => {
    const config = platformPackageConfig("linux-x64", "0.0.0");

    expect(releaseAssetName(config)).toBe("ai-agent-switch-linux-x64.tar.gz");
  });

  test("windows release asset keeps zip suffix", () => {
    const config = platformPackageConfig("windows-x64", "0.0.0");

    expect(releaseAssetName(config)).toBe("ai-agent-switch-windows-x64.zip");
  });

  test("install script downloads GitHub release assets and verifies version", async () => {
    const text = await readFile("install.sh", "utf8");

    expect(text).toContain("install.sh");
    expect(text).toContain("curl -fsSL https://raw.githubusercontent.com/sealos-apps/ai-agent-switch/main/install.sh | sh");
    expect(text).toContain("curl -fsSL https://raw.githubusercontent.com/sealos-apps/ai-agent-switch/main/install.sh | sh -s -- vX.Y.Z");
    expect(text).toContain("AI_AGENT_SWITCH_REPO=\"${AI_AGENT_SWITCH_REPO:-sealos-apps/ai-agent-switch}\"");
    expect(text).toContain("AI_AGENT_SWITCH_LATEST_RELEASE_URL=\"https://api.github.com/repos/${AI_AGENT_SWITCH_REPO}/releases/latest\"");
    expect(text).toContain("resolve_latest_version()");
    expect(text).toContain("VERSION=\"$(resolve_latest_version)\"");
    expect(text).toContain("v*.*.*)");
    expect(text).toContain("mktemp -d 2>/dev/null || mktemp -d -t ai-agent-switch");
    expect(text).toContain("ai-agent-switch-linux-x64.tar.gz");
    expect(text).toContain("mkdir -p \"$INSTALL_DIR\"");
    expect(text).toContain("cp \"${tmp_dir}/ai-agent-switch-${platform}/ai-agent-switch\" \"${INSTALL_DIR}/ai-agent-switch\"");
    expect(text).toContain("chmod 0755 \"${INSTALL_DIR}/ai-agent-switch\" \"${INSTALL_DIR}/as\"");
    expect(text).not.toContain("install -m");
    expect(text).toContain("expected_version=\"${VERSION#v}\"");
    expect(text).toContain("\"${INSTALL_DIR}/ai-agent-switch\" --version");
  });

  test("documented pipe install command supports latest and explicit versions", async () => {
    const english = await readFile("README.md", "utf8");
    const chinese = await readFile("README_CN.md", "utf8");

    expect(english).toContain("curl -fsSL https://raw.githubusercontent.com/sealos-apps/ai-agent-switch/main/install.sh | sh");
    expect(chinese).toContain("curl -fsSL https://raw.githubusercontent.com/sealos-apps/ai-agent-switch/main/install.sh | sh");
    expect(english).toContain("sh -s -- vX.Y.Z");
    expect(chinese).toContain("sh -s -- vX.Y.Z");
    expect(english).not.toContain("sh -s -- v0.1.3");
    expect(chinese).not.toContain("sh -s -- v0.1.3");
  });

  test("release workflow uploads binary assets to GitHub releases", async () => {
    const text = await readFile(".github/workflows/release.yml", "utf8");

    expect(text).toContain("Pack release binary");
    expect(text).toContain("ai-agent-switch-${{ matrix.platform }}.tar.gz");
    expect(text).toContain("gh release upload");
    expect(text).toContain("contents: read");
    expect(text).toContain("contents: write");
  });
});
