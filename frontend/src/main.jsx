import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { reefWs } from "@/api/websocket";

// Connect WebSocket immediately on app load — before any component mounts.
// This means the initial state replay from the server arrives as soon as
// the first component subscribes, with no delay.
reefWs.connect();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
