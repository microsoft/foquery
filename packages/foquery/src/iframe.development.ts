/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
export * from "./iframe";
export { connectFoQueryChildFrameDevtools as connectFoQueryChildFrame } from "./iframe-devtools";
import { installFoQueryIFrameDevtools } from "./iframe-devtools";

installFoQueryIFrameDevtools();
