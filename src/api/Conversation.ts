import type { EndpointHandlerContext } from "./types/EndpointHandler.js";
import { QUERY_STATUS } from "/ai/AIStructs.js";
import { ChatAgent } from "/ai/chat-agents/ChatAgent.js";
import type { Message } from "/api/interfaces/Common.js";
import type { PostResponse } from "/api/interfaces/Conversation.js";
import {
  PostRequestSchema,
  PostResponseSchema
} from "/api/schemas/Conversation.js";
import { HistorySessionModelSchema } from "/model/schemas/HistorySessionModel.js";
import { HistorySessionsModelSchema } from "/model/schemas/HistorySessionsModel.js";
import { Session } from "/session/Session.js";
import { HTTP_BAD_REQUEST, HTTP_OK } from "/utilities/Constants.js";
import { parseError } from "/utilities/ErrorParser.js";
import { HTTPError } from "/utilities/HTTPError.js";
import { logger } from "/utilities/Log.js";
import crypto from "crypto";
import { json, Request, Response } from "express";

export function handleConversation({
  app,
  sessionManager,
  userManager,
  database
}: EndpointHandlerContext) {
  const loggerContext = "ConversationAPIHandler";
  const endpoint = "/api/conversation";

  app.use(endpoint, json());
  logger.debug(
    { context: loggerContext },
    "JSON middleware enabled for endpoint %s",
    endpoint
  );

  app.post(endpoint, handleConversationPost);
  logger.debug(
    { context: loggerContext },
    "POST handler registered endpoint %s",
    endpoint
  );

  // This function should not throw an error: all errors have to be handled here
  //  and converted to an error response to be sent to the frontend.
  async function handleConversationPost(request: Request, response: Response) {
    const loggerContext = "ConversationPOSTHandler";

    // Set up the response headers
    response.writeHead(HTTP_OK, {
      "Content-Type": "text/event-stream",
      "Connection": "keep-alive",
      "Cache-Control": "no-cache"
    });
    logger.debug({ context: loggerContext }, "SSE header written");

    response.on("close", () => {
      logger.info({ context: loggerContext }, "Client closed SSE connection");
      response.end();
    });

    try {
      const { message, username, id } = PostRequestSchema.parse(request.body);
      logger.info({ context: loggerContext }, "Request received: %o", {
        id,
        username,
        message
      });

      // Get records from database
      const historySessionsPath = "chatHistory/historySessions";
      const historySessionsRecords = await database.get(
        historySessionsPath,
        HistorySessionsModelSchema
      );
      const historySessionPath = "chatHistory/historySession";
      const historySessionRecords = await database.get(
        historySessionPath,
        HistorySessionModelSchema
      );

      const sessionIdExist = id
        ? historySessionsRecords[id] !== undefined
        : false;

      if (id && !sessionIdExist) {
        // If session ID is specified, and it does not exist in the database
        throw new HTTPError(HTTP_BAD_REQUEST, "Invalid session ID");
      }
      // else: if session ID is not specified, or it exists in the database

      // Get session if ID provided, otherwise create a new session
      const session = await sessionManager.getSession(
        username,
        userManager,
        id
      );
      logger.debug(
        { context: loggerContext },
        "Session retrieved with ID %s",
        session.id
      );

      // Create a new record in the database if ID does not exist
      if (!sessionIdExist) {
        historySessionsRecords[session.id] = {
          id: session.id,
          dateTime: new Date().toISOString(),
          title: "New Chat"
        };
        historySessionRecords[session.id] = {
          messages: []
        };
        await database.set(
          historySessionsPath,
          historySessionsRecords,
          HistorySessionsModelSchema
        );
        await database.set(
          historySessionPath,
          historySessionRecords,
          HistorySessionModelSchema
        );
      }

      historySessionRecords[session.id].messages.push(message);
      await database.set(
        historySessionPath,
        historySessionRecords,
        HistorySessionModelSchema
      );

      let finalMessage: Message | null = null;
      for await (const postResponse of query(session, message)) {
        writeSseMessage(response, JSON.stringify(postResponse));
        if (
          postResponse.status === "success" &&
          postResponse.type === "message"
        ) {
          finalMessage = postResponse.message;
        }
      }
      if (finalMessage) {
        historySessionRecords[session.id].messages.push(finalMessage);
        await database.set(
          historySessionPath,
          historySessionRecords,
          HistorySessionModelSchema
        );
      }
    } catch (error) {
      const { reason } = parseError(error);
      const errorResponseBody = PostResponseSchema.parse({
        status: "fail",
        reason: reason
      });
      writeSseMessage(response, JSON.stringify(errorResponseBody));
    } finally {
      response.end();
    }
  }
}

async function* query(
  session: Session,
  message: Message
): AsyncGenerator<PostResponse> {
  if (!session.chatAgent.isChatEnabled()) {
    yield PostResponseSchema.parse({
      status: "fail",
      reason: "Chat agent is not available"
    });
    // Dummy return: will be ignored by the for-loop
    return {};
  }

  const agentInput = ChatAgent.prepareInput(message.content, session.id);
  // Query the chat agent with the user query
  for await (const agentResponse of session.chatAgent.query(agentInput)) {
    switch (agentResponse.status) {
      case QUERY_STATUS.PENDING:
        yield PostResponseSchema.parse({
          status: "success",
          id: session.id,
          type: "control",
          control: {
            signal: "generation-pending"
          }
        });
        break;
      case QUERY_STATUS.STARTED:
        yield PostResponseSchema.parse({
          status: "success",
          id: session.id,
          type: "control",
          control: {
            signal: "generation-started"
          }
        });
        break;
      case QUERY_STATUS.ERROR:
        yield PostResponseSchema.parse({
          status: "fail",
          reason: String(agentResponse.error)
        });
        break;
      case QUERY_STATUS.SUCCESS:
        yield PostResponseSchema.parse({
          status: "success",
          id: session.id,
          type: "message",
          message: {
            id: crypto.randomUUID(),
            username: "",
            content: agentResponse.response.output,
            author: {
              role: "assistant"
            }
          }
        });
        break;
      case QUERY_STATUS.DONE:
        yield PostResponseSchema.parse({
          status: "success",
          id: session.id,
          type: "control",
          control: {
            signal: "generation-done"
          }
        });
        break;
    }
  }

  // Dummy return: will be ignored by the for-loop
  return {};
}

function writeSseMessage(response: Response, data: string) {
  response.write("event: message\n");
  response.write(`data: ${data}\n`);
  response.write("\n\n");
}
