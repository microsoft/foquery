/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, FrameApp, isFoQueryFrameRoute } from "./app";

const isFrameRoute = isFoQueryFrameRoute();
document.body.classList.toggle("frame-body", isFrameRoute);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isFrameRoute ? <FrameApp /> : <App />}</StrictMode>,
);
