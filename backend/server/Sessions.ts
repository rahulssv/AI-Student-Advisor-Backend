import { ChatAgent } from "ai/chat-agents/ChatAgent";
import { APISession, SessionId } from "../structs/api/APIStructs";
import { getTestChatAgent } from "../TestChatAgent";

export class Session implements APISession {
  id: SessionId;
  chatAgent?: ChatAgent;
  response?: any;

  constructor(sessionConfig: APISession) {
    this.id = sessionConfig.id;
    this.chatAgent = sessionConfig.chatAgent;
    this.response = sessionConfig.response;
  }

  async setupChatAgent() {
    this.chatAgent = await getTestChatAgent();
  }

  getChatAgent() {
    return this.chatAgent;
  }
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  // Creates a new session, adds it to the session manager and returns the new session
  public getNewSession(sessionConfig: APISession): Session {
    const session: Session = new Session(sessionConfig);
    this.sessions.set(session.id, session);
    return session;
  }

  public getSession(sessionId: SessionId): Session | undefined {
    return this.sessions.get(sessionId);
  }

  public deleteSession(sessionId: SessionId): void {
    this.sessions.delete(sessionId);
  }
}