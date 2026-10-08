import type { ServerEvent } from "@milestone/shared";
import { useEffect, useState } from "react";

// Live feed of PayPal webhook events from the server.
export function useServerEvents() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<ServerEvent[]>([]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as ServerEvent;
      if (event.type !== "hello") setEvents((prev) => [event, ...prev].slice(0, 50));
    };
    return () => source.close();
  }, []);

  return { connected, events };
}
