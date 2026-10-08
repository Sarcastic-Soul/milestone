import type { ServerEvent } from "@milestone/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { setAgentRunning } from "./agentStatus.ts";

// Listens to the server's live feed and refetches whatever a PayPal webhook changed.
export function useServerEvents() {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as ServerEvent;
      if (event.type === "project") {
        qc.invalidateQueries({ queryKey: ["project", event.projectId] });
        qc.invalidateQueries({ queryKey: ["projects"] });
      } else if (event.type === "agent") {
        setAgentRunning(event.projectId, event.running);
      }
    };
    return () => source.close();
  }, [qc]);

  return { connected };
}
