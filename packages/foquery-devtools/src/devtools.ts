/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
if (typeof chrome !== "undefined" && chrome.devtools?.panels) {
  chrome.devtools.panels.create("FoQuery", "icon.svg", "panel.html");
}
