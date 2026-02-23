import type {
  ChatMessageRole,
  EngineeringChatMessage,
  EngineeringChatSession,
} from "./chatSessionStore";
import type { SupabaseChatSessionStore } from "./chatSessionStore";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[TeamChatRouter]";
const runtimeLog = log.fromContext({ source: "teamChatRouter" });

// TeamChatRouter is a thin wrapper around the chat session store.
// It can later be extended to route messages to agents.
export class TeamChatRouter {
  public constructor(private readonly store: SupabaseChatSessionStore) {}

  // Create a new chat session.
  public async createSession(input: {
    title: string;
    mode: "direct_agent" | "team_room";
    ticketId?: string;
    createdBy: string;
  }): Promise<EngineeringChatSession> {
    return this.store.createSession(input);
  }

  // List recent sessions.
  public async listSessions(limit = 25): Promise<EngineeringChatSession[]> {
    return this.store.listSessions(limit);
  }

  // List messages for a session.
  public async listMessages(
    sessionId: string,
    limit = 100,
  ): Promise<EngineeringChatMessage[]> {
    return this.store.listMessages(sessionId, limit);
  }

  // Post a message and (for now) auto-reply with a system notice.
  public async postMessage(input: {
    sessionId: string;
    role: ChatMessageRole;
    messageText: string;
  }): Promise<EngineeringChatMessage[]> {
    const inbound = await this.store.addMessage({
      sessionId: input.sessionId,
      role: input.role,
      messageText: input.messageText,
    });

    runtimeLog.info(`${LOG_PREFIX} message received`, {
      sessionId: input.sessionId,
      role: input.role,
    });

    // Temporary system response until real agent chat is wired.
    const systemReply = await this.store.addMessage({
      sessionId: input.sessionId,
      role: "system",
      messageText:
        "Discussion-only mode. Direct agent responses are not yet enabled.",
      metadata: {
        mode: "discussion_only",
      },
    });

    return [inbound, systemReply];
  }
}
