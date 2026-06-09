import React from "react";
import { createRoot } from "react-dom/client";
import { AgentViewer } from "./components/AgentViewer";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgentViewer />
  </React.StrictMode>,
);
