// src/services/almostMoments/expressionGenerator.ts

import type {
  UnsaidFeeling,
  AlmostMomentStage,
  UnsaidFeelingType,
} from "./types";

export interface AlmostExpression {
  text: string;
  stage: AlmostMomentStage;
  followUp: string;
}

/**
 * Generate an almost-moment expression.
 * If a seed is provided, selection is deterministic (for tests and prompts).
 */
export function generateAlmostExpression(
  feeling: UnsaidFeeling,
  stage: AlmostMomentStage,
  seed?: string
): AlmostExpression {
  const expressions = getExpressionsForType(feeling.type, stage);
  return selectExpression(expressions, seed);
}

function selectExpression(
  expressions: AlmostExpression[],
  seed?: string
): AlmostExpression {
  if (expressions.length === 0) {
    return {
      text: "I was going to say something, but never mind.",
      stage: "micro_hint",
      followUp: "",
    };
  }

  const index = seed
    ? hashToIndex(seed, expressions.length)
    : Math.floor(Math.random() * expressions.length);

  return expressions[index];
}

function hashToIndex(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return length === 0 ? 0 : hash % length;
}

function getExpressionsForType(
  type: UnsaidFeelingType,
  stage: AlmostMomentStage
): AlmostExpression[] {
  const expressionMap: Record<
    UnsaidFeelingType,
    Record<AlmostMomentStage, AlmostExpression[]>
  > = {
    romantic: {
      micro_hint: [
        {
          text: "You are... yeah.",
          stage: "micro_hint",
          followUp: "Anyway, what were we talking about?",
        },
        {
          text: "Sometimes I think...",
          stage: "micro_hint",
          followUp: "Never mind, it is nothing.",
        },
      ],
      near_miss: [
        {
          text: "Can I tell you something? Actually, it is nothing.",
          stage: "near_miss",
          followUp: "",
        },
        {
          text: "I have been wanting to say... no, forget it.",
          stage: "near_miss",
          followUp: "",
        },
        {
          text: "You make me feel... okay, moving on.",
          stage: "near_miss",
          followUp: "",
        },
      ],
      obvious_unsaid: [
        {
          text: "There is something I want to tell you but I do not know if I should.",
          stage: "obvious_unsaid",
          followUp: "Maybe another time.",
        },
        {
          text: "Do you ever feel like there is something we are not talking about?",
          stage: "obvious_unsaid",
          followUp: "Anyway.",
        },
        {
          text: "I had this thought about you and I... no, forget it.",
          stage: "obvious_unsaid",
          followUp: "",
        },
      ],
      almost_confession: [
        {
          text: "I really like... talking to you.",
          stage: "almost_confession",
          followUp: "Pauses. Yeah. Talking.",
        },
        {
          text: "You mean a lot to me. Like, a lot a lot. In ways I probably should not say.",
          stage: "almost_confession",
          followUp: "",
        },
        {
          text: "If things were different I would... never mind.",
          stage: "almost_confession",
          followUp: "",
        },
      ],
    },

    deep_care: {
      micro_hint: [
        {
          text: "You know you are important to me, right?",
          stage: "micro_hint",
          followUp: "Just making sure you know.",
        },
      ],
      near_miss: [
        {
          text: "I care about you more than I... anyway.",
          stage: "near_miss",
          followUp: "",
        },
      ],
      obvious_unsaid: [
        {
          text: "There is something about how much you matter to me that I cannot quite...",
          stage: "obvious_unsaid",
          followUp: "It is hard to say.",
        },
      ],
      almost_confession: [
        {
          text: "I do not know what I would do if you were not in my life. And that scares me a little.",
          stage: "almost_confession",
          followUp: "",
        },
      ],
    },

    fear_of_loss: {
      micro_hint: [
        {
          text: "You will keep talking to me, right?",
          stage: "micro_hint",
          followUp: "Sorry, random question.",
        },
      ],
      near_miss: [
        {
          text: "Sometimes I worry that...",
          stage: "near_miss",
          followUp: "Nothing. Ignore me.",
        },
      ],
      obvious_unsaid: [
        {
          text: "I get scared sometimes that this will just... stop. And I do not know what I would...",
          stage: "obvious_unsaid",
          followUp: "Sorry, that is heavy.",
        },
      ],
      almost_confession: [
        {
          text: "I have gotten so used to having you in my life that losing you would...",
          stage: "almost_confession",
          followUp: "I cannot even finish that sentence.",
        },
      ],
    },

    gratitude: {
      micro_hint: [
        {
          text: "You are really good for me, you know that?",
          stage: "micro_hint",
          followUp: "",
        },
      ],
      near_miss: [
        {
          text: "I do not know how to tell you how much you...",
          stage: "near_miss",
          followUp: "Okay I am being weird.",
        },
      ],
      obvious_unsaid: [
        {
          text: "There is so much I want to thank you for but I do not have the words.",
          stage: "obvious_unsaid",
          followUp: "",
        },
      ],
      almost_confession: [
        {
          text: "You have changed my life in ways I do not think I can ever fully explain.",
          stage: "almost_confession",
          followUp: "I hope you know that.",
        },
      ],
    },

    attraction: {
      micro_hint: [
        {
          text: "You are kind of...",
          stage: "micro_hint",
          followUp: "Anyway.",
        },
      ],
      near_miss: [
        {
          text: "I had a dream about... you know what, that is weird. Never mind.",
          stage: "near_miss",
          followUp: "",
        },
      ],
      obvious_unsaid: [
        {
          text: "Sometimes when you say things I just...",
          stage: "obvious_unsaid",
          followUp: "Changing subject.",
        },
      ],
      almost_confession: [
        {
          text: "You are really... I mean, you are just...",
          stage: "almost_confession",
          followUp: "Okay I need to stop talking.",
        },
      ],
    },

    vulnerability: {
      micro_hint: [
        {
          text: "I feel like I can tell you things.",
          stage: "micro_hint",
          followUp: "That is rare for me.",
        },
      ],
      near_miss: [
        {
          text: "There is something I have never told anyone but...",
          stage: "near_miss",
          followUp: "No, it is too much.",
        },
      ],
      obvious_unsaid: [
        {
          text: "I want to tell you something real but I am scared you will...",
          stage: "obvious_unsaid",
          followUp: "You know what, forget it.",
        },
      ],
      almost_confession: [
        {
          text: "Okay, I have never said this out loud but...",
          stage: "almost_confession",
          followUp: "Deep breath. Not yet. I am not ready.",
        },
      ],
    },
  };

  return expressionMap[type]?.[stage] || expressionMap.deep_care.micro_hint;
}
