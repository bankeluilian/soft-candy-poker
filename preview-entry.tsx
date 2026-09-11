import React from "react";
import { createRoot } from "react-dom/client";
import PokerGame from "./app/page.js";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><PokerGame /></React.StrictMode>,
);
