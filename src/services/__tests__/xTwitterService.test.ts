import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/services/supabaseAdmin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("../../../server/runtimeLogger", () => ({
  log: {
    fromContext: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("../imageGenerationService", () => ({
  generateCompanionSelfie: vi.fn(),
}));

vi.stubEnv("X_CLIENT_ID", "test");
vi.stubEnv("X_CLIENT_SECRET", "test");
vi.stubEnv("X_CALLBACK_URL", "http://localhost");

import { parseTweetApprovalAction } from "../../../server/services/xTwitterServerService";

describe("xTwitterServerService.parseTweetApprovalAction", () => {
  it("recognizes positive approval phrases", () => {
    expect(parseTweetApprovalAction("POST TWEET")).toBe("post");
    expect(parseTweetApprovalAction("lets do it")).toBe("post");
  });

  it("recognizes rejection phrases and ignores unrelated text", () => {
    expect(parseTweetApprovalAction("reject tweet")).toBe("reject");
    expect(parseTweetApprovalAction("maybe later")).toBeNull();
  });
});
