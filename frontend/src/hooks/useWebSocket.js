import { useEffect, useState } from "react";
import { reefWs } from "@/api/websocket";
import { useDoserStore } from "@/store/doserStore";

/**
 * Connects the WebSocket singleton to the Zustand stores.
 * Mount this once at the App level — it subscribes to all inbound
 * messages and routes them to the appropriate device store.
 *
 * Returns the current WebSocket connection status.
 */

export function useWebSocket() {
  const [connected, setConnected] = useState(reefWs.connected);

  const handleDoserMessage = useDoserStore((s) => s.handleWsMessage);

  // Point this to fetchSchedule, which actually exists in your store
  const fetchSchedule = useDoserStore((s) => s.fetchSchedule);

  useEffect(() => {
    reefWs.connect();

    // Trigger the schedule fetch instantly on mount
    if (fetchSchedule) {
      fetchSchedule().catch((err) => console.error("Initial load failed:", err));
    }

    const unsubMsg = reefWs.onMessage((msg) => {
      if (msg.device === "doser") {
        handleDoserMessage(msg);
      }
    });

    const unsubStatus = reefWs.onStatus(setConnected);

    return () => {
      unsubMsg();
      unsubStatus();
    };
  }, [handleDoserMessage, fetchSchedule]);

  return connected;
}
