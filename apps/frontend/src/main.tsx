import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/components/app";
import "@agent-kernel/viewer-ui/styles";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
