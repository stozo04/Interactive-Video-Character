import { bot, getStevenChatId } from "./telegramClient";
import {
  startEngineeringTicketBridge,
  type EngineeringTicketBridgeHandle,
} from "../services/engineeringTicketBridge";
import { log } from "../runtimeLogger";

const runtimeLog = log.fromContext({
  source: "telegramEngineeringTicketBridge",
  route: "telegram/engineering-ticket-bridge",
});

export function startTelegramEngineeringTicketBridge(): EngineeringTicketBridgeHandle {
  const chatId = getStevenChatId();
  if (!chatId) {
    runtimeLog.warning(
      "Engineering ticket bridge disabled: TELEGRAM_STEVEN_CHAT_ID not configured",
      { source: "telegramEngineeringTicketBridge" },
    );
    return { stop: () => {} };
  }

  return startEngineeringTicketBridge({
    channelName: "telegram",
    actorName: "telegram_bridge",
    isReady: () => getStevenChatId() > 0,
    sendMessage: async (message: string) => {
      const liveChatId = getStevenChatId();
      if (!liveChatId) {
        throw new Error("TELEGRAM_STEVEN_CHAT_ID is not configured");
      }
      await bot.api.sendMessage(liveChatId, message);
    },
  });
}
