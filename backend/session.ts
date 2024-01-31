import {
  ResponseBase,
  Message,
  Control,
  HistoryConversation,
  PostResponseSuccess,
  PostResponseFail,
  Agent,
  AgentResponse,
} from "./session_interface";
import { v4 as uuidv4 } from "uuid";
import * as express from "express";
const app = express();
app.use(express.static("public"));

const sessions: PostResponseSuccess[] = [];
function eventHandlers(req, res, next) {
  const { query } = req;
  let session: PostResponseSuccess | undefined;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  });
  if (query.id == undefined) {
    //Request a query in a new conversation
    try {
      session = getNewSession();
      sessions.push(session);
    } catch (error) {
      const errSession = getErrorSession(error);
      res.write(JSON.stringify(errSession));
    }
  } else {
    //Request a query in a created conversation
    const index = findSession(query.id);
    if (index != -1) {
      session = sessions[index];
    } else {
      const errSession = getErrorSession(
        new Error("Cannot find the conversation.")
      );
      res.write(JSON.stringify(errSession));
    }
  }
  if (session == undefined) {
    res.end("ERROR");
    return;
  }
  session.chatAgent = getTestChatAgent();
  if (query.message != undefined && session.chatAgent != undefined) {
    //Testing
    let solution: string = session.chatAgent.query(session.id, query);
    var flag = 10;
    var loop = setInterval(() => {
      try {
        let result: AgentResponse = JSON.parse(solution);
        //Testing condition
        if (result.status !== "yes") {
          throw new Error("Collect data failed.");
        }
        if (flag < 0) {
          //Generation done
          session!.type = "control";
          let control: Control = { signal: "generation-done" };
          session!.control = control;
          session!.message = undefined;
          console.log("Loop done");
          res.write(JSON.stringify(session));
          clearInterval(loop);
        } else {
          let message: Message = getNewMessage(result.response);
          session!.message = message;
          res.write(JSON.stringify(session));
          console.log(
            "LOG: Message sent: session ID: " +
              session?.id +
              "\nMessage: " +
              message.content
          );
        }
      } catch (error) {
        session!.type = "control";
        let control: Control = { signal: "generation-error" };
        session!.control = control;
        session!.message = undefined;
        res.write(JSON.stringify(session));
        clearInterval(loop);
      } finally {
        flag--;
      }
    }, 5000);
    console.log("Session out");
  } else {
    ///Testing code
    ///The query.message that should not be empty
    res.end("ERROR");
  }

  // Close the connection when the client disconnects
  req.on("close", () => res.end("OK"));
}

function getNewSession(): PostResponseSuccess {
  const newSession: PostResponseSuccess = {
    status: "success",
    type: "message",
    id: uuidv4(),
    message: undefined,
    control: undefined,
    chatAgent: undefined,
  };
  if (findSession(newSession.id) != -1) {
    throw new Error("Create new session failed: session id confilct.");
  }
  return newSession;
}

function getErrorSession(error: Error): PostResponseFail {
  const newSession: PostResponseFail = {
    status: "fail",
    reason: error.message,
  };
  console.log("INFO: Created error session:" + error.message);
  return newSession;
}

function getNewMessage(response: string): Message {
  const message: Message = {
    id: uuidv4(),
    contentType: "message",
    content: response,
    author: { role: "assistant" },
  };
  return message;
}

function getTestChatAgent(): Agent {
  const newAgent: Agent = {
    query(id: string, queryStr: string): string {
      //TO DO: testing code
      return '{"status": "yes", "response": "abcccc"}';
    },
  };
  return newAgent;
}

function findSession(id: string): number {
  for (let index = 0; index < sessions.length; index++) {
    const tmp: PostResponseSuccess = sessions[index];
    if (tmp.id === id) {
      return index;
    }
  }
  return -1;
}

app.post("/api/conversation", eventHandlers);
app.get("/api/conversation", eventHandlers);

app.listen(3001, () => console.log("App listening: http://localhost:3001"));
