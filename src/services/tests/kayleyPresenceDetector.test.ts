// kayleyPresenceDetector.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectKayleyPresence } from "../kayleyPresenceDetector";

describe("kayleyPresenceDetector", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "");
  });

  it("returns null when API key is missing", async () => {
    const result = await detectKayleyPresence("I'm in my favorite hoodie");
    expect(result).toBeNull();
  });
});
