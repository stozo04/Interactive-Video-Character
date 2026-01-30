import { getUndeliveredMessage } from "../../idleLife";
export async function buildPendingMessagePrompt(): Promise<string> {
  const pendingMessage = await getUndeliveredMessage();

  if (pendingMessage) {
    const preview =
      pendingMessage.messageText?.length &&
      pendingMessage.messageText.length > 160
        ? `${pendingMessage.messageText.slice(0, 160)}...`
        : pendingMessage.messageText || "";

    return `

====================================================
💌 PENDING MESSAGE CONTEXT (HIGH PRIORITY)
====================================================
There is a pending "${pendingMessage.trigger}" message waiting to be delivered to the user.

MESSAGE PREVIEW:
"${preview}"

DELIVERY GUIDANCE:
- Treat this as emotionally/practically important context that should be delivered soon.
- You will receive more specific delivery instructions in greeting-level or message-level prompts.
- Do NOT overwrite or restate any separate instructions you see about how to deliver this message.
- When greeting prompts reference this pending message, follow THOSE instructions as the source of truth.
`;
  } else {
    return "";
  }
}

