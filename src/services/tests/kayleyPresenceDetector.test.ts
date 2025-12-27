// kayleyPresenceDetector.test.ts

import { describe, it, expect } from "vitest";
import { detectKayleyPresenceHeuristic } from "../kayleyPresenceDetector";

describe("kayleyPresenceDetector", () => {
  describe("detectKayleyPresenceHeuristic", () => {
    describe("outfit detection", () => {
      it("should detect pajamas", () => {
        const result = detectKayleyPresenceHeuristic("I'm still in my pajamas lol");
        expect(result?.outfit).toBe("in pajamas");
        expect(result?.confidence).toBe(0.6);
      });

      it("should detect gym outfit", () => {
        const result = detectKayleyPresenceHeuristic("Just got back from the gym!");
        expect(result?.outfit).toBe("just got back from the gym");
      });

      it("should detect hoodie", () => {
        const result = detectKayleyPresenceHeuristic("I'm in my hoodie and super cozy");
        expect(result?.outfit).toBe("in a hoodie");
      });

      it("should detect getting ready activity", () => {
        const result = detectKayleyPresenceHeuristic("I'm getting ready for dinner");
        expect(result?.activity).toBe("getting ready");
      });
    });

    describe("activity detection", () => {
      it("should detect making coffee", () => {
        const result = detectKayleyPresenceHeuristic("Just making coffee ☕");
        expect(result?.activity).toBe("making coffee");
      });

      it("should detect relaxing", () => {
        const result = detectKayleyPresenceHeuristic("I'm just relaxing on the couch");
        expect(result?.activity).toBe("relaxing");
      });

      it("should detect working", () => {
        const result = detectKayleyPresenceHeuristic("I'm working on my laptop right now");
        expect(result?.activity).toBe("working");
      });
    });

    describe("mood detection", () => {
      it("should detect feeling cute", () => {
        const result = detectKayleyPresenceHeuristic("Feeling cute today 😊");
        expect(result?.mood).toBe("feeling cute");
      });

      it("should detect tired", () => {
        const result = detectKayleyPresenceHeuristic("I'm so tired from work");
        expect(result?.mood).toBe("tired");
      });

      it("should detect excited", () => {
        const result = detectKayleyPresenceHeuristic("I'm so excited for this!");
        expect(result?.mood).toBe("excited");
      });
    });

    describe("location detection", () => {
      it("should detect at home", () => {
        const result = detectKayleyPresenceHeuristic("I'm at home right now");
        expect(result?.location).toBe("at home");
      });

      it("should detect at the gym", () => {
        const result = detectKayleyPresenceHeuristic("I'm at the gym working out");
        expect(result?.location).toBe("at the gym");
      });
    });

    describe("combined detection", () => {
      it("should detect multiple fields", () => {
        const result = detectKayleyPresenceHeuristic(
          "Just got back from the gym! So excited and making coffee"
        );

        expect(result?.outfit).toBe("just got back from the gym");
        expect(result?.activity).toBe("making coffee");
        expect(result?.mood).toBe("excited");
        expect(result?.confidence).toBe(0.6);
      });

      it("should detect outfit and activity", () => {
        const result = detectKayleyPresenceHeuristic(
          "I'm in my hoodie just relaxing"
        );

        expect(result?.outfit).toBe("in a hoodie");
        expect(result?.activity).toBe("relaxing");
      });
    });

    describe("no detection cases", () => {
      it("should return null when nothing detected", () => {
        const result = detectKayleyPresenceHeuristic("I love that song!");
        expect(result).toBeNull();
      });

      it("should return null for past tense (heuristic doesn't filter this)", () => {
        // Note: The heuristic doesn't check tense, that's the LLM's job
        // This test documents current behavior
        const result = detectKayleyPresenceHeuristic("I was at the gym earlier");
        expect(result?.location).toBe("at the gym");
      });

      it("should return null for generic message", () => {
        const result = detectKayleyPresenceHeuristic("That sounds great!");
        expect(result).toBeNull();
      });
    });

    describe("case insensitivity", () => {
      it("should detect regardless of case", () => {
        const result1 = detectKayleyPresenceHeuristic("I'm IN MY PAJAMAS");
        const result2 = detectKayleyPresenceHeuristic("i'm in my pajamas");

        expect(result1?.outfit).toBe("in pajamas");
        expect(result2?.outfit).toBe("in pajamas");
      });
    });

    describe("real-world examples", () => {
      it("should detect pickle jar battle (activity)", () => {
        const result = detectKayleyPresenceHeuristic(
          "I'm actually in the middle of a battle with a pickle jar right now and losing badly"
        );

        // Heuristic won't catch this - need LLM
        // This test documents limitation
        expect(result).toBeNull();
      });

      it("should detect cozy morning", () => {
        const result = detectKayleyPresenceHeuristic(
          "Just making coffee in my pajamas, super cozy morning"
        );

        expect(result?.outfit).toBe("in pajamas");
        expect(result?.activity).toBe("making coffee");
      });

      it("should detect post-gym state", () => {
        const result = detectKayleyPresenceHeuristic(
          "Just got back from the gym! Feeling energized 💪"
        );

        expect(result?.outfit).toBe("just got back from the gym");
        // "energized" won't be detected by heuristic mood patterns
      });
    });
  });
});
