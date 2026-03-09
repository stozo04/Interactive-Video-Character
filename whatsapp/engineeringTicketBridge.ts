import { getActiveSock, sentMessageIds } from "./baileyClient";
import {
  startEngineeringTicketBridge,
  type EngineeringTicketBridgeHandle,
} from "../server/services/engineeringTicketBridge";
import { log } from "../lib/logger";

const runtimeLog = log.fromContext({
  source: "whatsappEngineeringTicketBridge",
  route: "whatsapp/engineering-ticket-bridge",
});

const STEVEN_JID = process.env.WHATSAPP_STEVEN_JID;

export function startWhatsAppEngineeringTicketBridge(): EngineeringTicketBridgeHandle {
  if (!STEVEN_JID) {
    runtimeLog.warning(
      "Engineering ticket bridge disabled: WHATSAPP_STEVEN_JID not configured",
      { source: "whatsappEngineeringTicketBridge" },
    );
    return { stop: () => {} };
  }

  return startEngineeringTicketBridge({
    channelName: "whatsapp",
    actorName: "whatsapp_bridge",
    isReady: () => !!getActiveSock() && !!STEVEN_JID,
    sendMessage: async (message: string) => {
      const sock = getActiveSock();
      if (!sock || !STEVEN_JID) {
        throw new Error("WhatsApp socket is not connected");
      }
      const sent = await sock.sendMessage(STEVEN_JID, { text: message });
      if (sent?.key?.id) {
        sentMessageIds.add(sent.key.id);
      }
    },
  });
}
