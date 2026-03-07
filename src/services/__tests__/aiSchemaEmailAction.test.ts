import { describe, expect, it } from "vitest";
import { GeminiMemoryToolDeclarations } from "../aiSchema";

describe("aiSchema email_action declaration", () => {
  it("includes confirmation fields for outbound send", () => {
    const emailActionDecl = GeminiMemoryToolDeclarations.find(
      (decl) => decl.name === "email_action"
    );
    expect(emailActionDecl).toBeDefined();

    const properties = emailActionDecl?.parameters?.properties as
      | Record<string, unknown>
      | undefined;
    expect(properties).toBeDefined();
    expect(properties).toHaveProperty("draft_id");
    expect(properties).toHaveProperty("confirmed");
  });
});

