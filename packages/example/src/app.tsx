/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { useState, useCallback, useContext, useRef, useEffect } from "react";
import type { ReactElement } from "react";
import { FoQueryProvider, FoQueryParent, useFoQuery, FoQueryContext } from "foquery-react";
import { FoQueryFrameProvider, FoQueryIFrameParent } from "foquery-react/iframe";
import type { Types } from "foquery";
import { RequestStatus } from "foquery";
import "./app.css";

function Leaf({ names, children }: { names: string[]; children: string }) {
  const ref = useFoQuery<HTMLButtonElement>(names);
  return <button ref={ref}>{children}</button>;
}

type FocusRequester = (xpath: string) => void;
type ExampleFrameRole = "primary" | "secondary" | "nested" | "level-three";

function IFrameLeaf({
  names,
  children,
  onClick,
}: {
  names: string[];
  children: string;
  onClick?: () => void;
}) {
  const ref = useFoQuery<HTMLButtonElement>(names);
  return (
    <button ref={ref} onClick={onClick} data-foquery-ignore={onClick ? true : undefined}>
      {children}
    </button>
  );
}

function DynamicPanel({ id, onRemove }: { id: number; onRemove: () => void }) {
  return (
    <FoQueryParent name={`panel-${id}`}>
      <div className="region" style={{ gridColumn: "1 / -1" }}>
        <h2>Panel {id}</h2>
        <Leaf names={["SelectedItem", "DefaultItem"]}>Panel {id} Item</Leaf>
        <button onClick={onRemove} className="remove-btn">
          Remove
        </button>
      </div>
    </FoQueryParent>
  );
}

const IFRAME_DEMO_FRAME_ID = "example-card-frame";
const IFRAME_SECONDARY_FRAME_ID = "example-secondary-card-frame";
const IFRAME_NESTED_FRAME_ID = "example-nested-card-frame";
const IFRAME_LEVEL_THREE_FRAME_ID = "example-level-three-card-frame";
const IFRAME_FOCUS_QUERY = "//content/messages/message/CardInIframe//Card/DefaultFocusable";
const IFRAME_SECONDARY_FOCUS_QUERY =
  "//content/messages/message/SecondaryCardInIframe//Card/SecondaryFocusable";
const IFRAME_NESTED_FOCUS_QUERY =
  "//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/DeepFocusable";
const IFRAME_LEVEL_THREE_FOCUS_QUERY =
  "//content/messages/message/CardInIframe//NestedArea/NestedCardInIframe//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable";
const APP_HEADER_FOCUS_QUERY = "//header/SelectedItem";
const IFRAME_CARD_SECONDARY_QUERY =
  "//content/messages/message/CardInIframe//Card/SecondaryFocusable";
const FRAME_ROUTE_PARAM = "foqueryFrame";
const EXAMPLE_FRAME_PORTS = {
  primary: 5174,
  secondary: 5175,
  nested: 5176,
  levelThree: 5177,
};

function getFrameOrigin(port: number): string {
  const hostname = window.location.hostname || "127.0.0.1";
  return `${window.location.protocol}//${hostname}:${port}`;
}

function getFrameOrigins() {
  return {
    primary: getFrameOrigin(EXAMPLE_FRAME_PORTS.primary),
    secondary: getFrameOrigin(EXAMPLE_FRAME_PORTS.secondary),
    nested: getFrameOrigin(EXAMPLE_FRAME_PORTS.nested),
    levelThree: getFrameOrigin(EXAMPLE_FRAME_PORTS.levelThree),
  };
}

function createFrameSrc(
  origin: string,
  role: ExampleFrameRole,
  params: Record<string, string | boolean>,
): string {
  const url = new URL("/", origin);
  url.searchParams.set(FRAME_ROUTE_PARAM, role);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

function getExampleFrameRole(): ExampleFrameRole | undefined {
  const role = new URLSearchParams(window.location.search).get(FRAME_ROUTE_PARAM);
  return role === "primary" || role === "secondary" || role === "nested" || role === "level-three"
    ? role
    : undefined;
}

export function isFoQueryFrameRoute(): boolean {
  return getExampleFrameRole() !== undefined;
}

function CrossOriginFoQueryFrame({
  name,
  frameId,
  title,
  src,
  targetOrigin,
  iframeClassName,
}: {
  name: string;
  frameId: string;
  title: string;
  src: string;
  targetOrigin: string;
  iframeClassName?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <FoQueryIFrameParent
      name={name}
      iframeRef={iframeRef}
      frameId={frameId}
      targetOrigin={targetOrigin}
    >
      <iframe ref={iframeRef} title={title} className={iframeClassName} src={src} />
    </FoQueryIFrameParent>
  );
}

function FocusActionButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" data-foquery-ignore onClick={onClick}>
      {children}
    </button>
  );
}

function useFrameFocusRequester(): FocusRequester {
  const ctx = useContext(FoQueryContext);
  return useCallback(
    (xpath) => {
      ctx?.requestFocus(xpath, { timeout: 5000 });
    },
    [ctx],
  );
}

function LevelThreeCardContent() {
  const requestFromRoot = useFrameFocusRequester();

  return (
    <FoQueryParent name="LevelThreeCard">
      <div className="iframe-card">
        <h4>Level 3 iframe card</h4>
        <IFrameLeaf
          names={["DeepestFocusable"]}
          onClick={() => requestFromRoot(IFRAME_NESTED_FOCUS_QUERY)}
        >
          Deepest target → parent iframe deep target
        </IFrameLeaf>
        <div className="iframe-actions">
          <FocusActionButton onClick={() => requestFromRoot(APP_HEADER_FOCUS_QUERY)}>
            Focus app header
          </FocusActionButton>
          <FocusActionButton onClick={() => requestFromRoot(IFRAME_FOCUS_QUERY)}>
            Focus ancestor iframe
          </FocusActionButton>
          <FocusActionButton onClick={() => requestFromRoot(IFRAME_SECONDARY_FOCUS_QUERY)}>
            Focus sibling iframe
          </FocusActionButton>
        </div>
      </div>
    </FoQueryParent>
  );
}

function NestedCardContent({
  includeLevelThree,
  levelThreeOrigin,
}: {
  includeLevelThree: boolean;
  levelThreeOrigin: string;
}) {
  const ctx = useContext(FoQueryContext);
  const requestFromRoot = useFrameFocusRequester();

  return (
    <FoQueryParent name="NestedCard">
      <div className="iframe-card">
        <h4>Nested iframe card</h4>
        <IFrameLeaf
          names={["DeepFocusable"]}
          onClick={() => {
            ctx?.requestFocus("//NestedCard/LevelThreeFrame//LevelThreeCard/DeepestFocusable", {
              timeout: 5000,
            });
          }}
        >
          Deep target → level 3 iframe
        </IFrameLeaf>
        <div className="iframe-actions">
          <FocusActionButton onClick={() => requestFromRoot(APP_HEADER_FOCUS_QUERY)}>
            Focus app header
          </FocusActionButton>
          <FocusActionButton onClick={() => requestFromRoot(IFRAME_FOCUS_QUERY)}>
            Focus parent iframe default
          </FocusActionButton>
          <FocusActionButton onClick={() => requestFromRoot(IFRAME_CARD_SECONDARY_QUERY)}>
            Focus parent iframe secondary
          </FocusActionButton>
          <FocusActionButton onClick={() => requestFromRoot(IFRAME_SECONDARY_FOCUS_QUERY)}>
            Focus sibling iframe
          </FocusActionButton>
        </div>
        {includeLevelThree && (
          <CrossOriginFoQueryFrame
            name="LevelThreeFrame"
            frameId={IFRAME_LEVEL_THREE_FRAME_ID}
            title="FoQuery level three iframe"
            src={createFrameSrc(levelThreeOrigin, "level-three", {
              frameId: IFRAME_LEVEL_THREE_FRAME_ID,
              parentOrigin: window.location.origin,
            })}
            targetOrigin={levelThreeOrigin}
            iframeClassName="level-three-iframe"
          />
        )}
      </div>
    </FoQueryParent>
  );
}

function IFrameCardContent({
  includeLevelThree = false,
  includeNested = false,
  nestedOrigin,
  levelThreeOrigin,
  progressive = false,
  siblingFocusQuery,
}: {
  includeLevelThree?: boolean;
  includeNested?: boolean;
  nestedOrigin: string;
  levelThreeOrigin: string;
  progressive?: boolean;
  siblingFocusQuery: string;
}) {
  const ctx = useContext(FoQueryContext);
  const requestFromRoot = useFrameFocusRequester();

  return (
    <FoQueryParent name="Card">
      <div className="iframe-card">
        <h4>Iframe card</h4>
        <IFrameLeaf names={["DefaultFocusable"]}>Default target</IFrameLeaf>
        <IFrameLeaf names={["SecondaryFocusable"]}>Secondary target</IFrameLeaf>
        <button
          data-foquery-ignore
          onClick={() => {
            ctx?.requestFocus("//Card/DefaultFocusable");
          }}
        >
          Request from iframe
        </button>
        {includeNested && (
          <FocusActionButton
            onClick={() => {
              ctx?.requestFocus("//Card/NestedArea/NestedCardInIframe//NestedCard/DeepFocusable", {
                timeout: 5000,
              });
            }}
          >
            Request nested iframe
          </FocusActionButton>
        )}
        <FocusActionButton onClick={() => requestFromRoot(APP_HEADER_FOCUS_QUERY)}>
          Request app header
        </FocusActionButton>
        <FocusActionButton onClick={() => requestFromRoot(siblingFocusQuery)}>
          Request sibling iframe
        </FocusActionButton>
        {includeNested && (
          <FoQueryParent name="NestedArea">
            <CrossOriginFoQueryFrame
              name="NestedCardInIframe"
              frameId={IFRAME_NESTED_FRAME_ID}
              title="FoQuery nested iframe card"
              src={createFrameSrc(nestedOrigin, "nested", {
                frameId: IFRAME_NESTED_FRAME_ID,
                parentOrigin: window.location.origin,
                includeLevelThree: progressive ? false : includeLevelThree,
                levelThreeOrigin,
                progressive,
              })}
              targetOrigin={nestedOrigin}
              iframeClassName="nested-iframe"
            />
          </FoQueryParent>
        )}
      </div>
    </FoQueryParent>
  );
}

function IFrameCardDemo({
  iframeStep,
  progressiveRunId,
}: {
  iframeStep: number;
  progressiveRunId: string | null;
}) {
  const frameOrigins = getFrameOrigins();
  const isProgressiveRun = progressiveRunId !== null;

  return (
    <FoQueryParent name="message">
      <div className="subregion nested iframe-demo">
        <h3>Message iframes</h3>
        {iframeStep >= 1 && (
          <CrossOriginFoQueryFrame
            name="CardInIframe"
            frameId={IFRAME_DEMO_FRAME_ID}
            title="FoQuery iframe card"
            src={createFrameSrc(frameOrigins.primary, "primary", {
              frameId: IFRAME_DEMO_FRAME_ID,
              parentOrigin: window.location.origin,
              includeNested: isProgressiveRun ? false : iframeStep >= 2,
              includeLevelThree: isProgressiveRun ? false : iframeStep >= 3,
              nestedOrigin: frameOrigins.nested,
              levelThreeOrigin: frameOrigins.levelThree,
              progressive: isProgressiveRun,
              progressiveRunId: progressiveRunId ?? "",
            })}
            targetOrigin={frameOrigins.primary}
            iframeClassName="primary-iframe"
          />
        )}
        {iframeStep >= 3 && (
          <CrossOriginFoQueryFrame
            name="SecondaryCardInIframe"
            frameId={IFRAME_SECONDARY_FRAME_ID}
            title="FoQuery secondary iframe card"
            src={createFrameSrc(frameOrigins.secondary, "secondary", {
              frameId: IFRAME_SECONDARY_FRAME_ID,
              parentOrigin: window.location.origin,
            })}
            targetOrigin={frameOrigins.secondary}
          />
        )}
      </div>
    </FoQueryParent>
  );
}

function ContentByStep({
  iframeStep,
  progressiveRunId,
  step,
}: {
  iframeStep: number;
  progressiveRunId: string | null;
  step: number;
}) {
  if (step <= 0) return null;

  return (
    <>
      <FoQueryParent name="messages" focus="./thread/SelectedItem">
        <div className="subregion">
          <h3>Messages</h3>
          {step >= 2 && (
            <FoQueryParent name="thread">
              <div className="subregion nested">
                <h3>Thread</h3>
                <Leaf names={["SelectedItem"]}>Message 1</Leaf>
                <Leaf names={["DefaultItem"]}>Message 2</Leaf>
              </div>
            </FoQueryParent>
          )}
          {step >= 3 && (
            <FoQueryParent name="compose">
              <div className="subregion nested">
                <h3>Compose</h3>
                <Leaf names={["DefaultItem"]}>Subject</Leaf>
                <Leaf names={["DefaultItem"]}>Body</Leaf>
                <Leaf names={["SelectedItem"]}>Send</Leaf>
              </div>
            </FoQueryParent>
          )}
          {step >= 4 && (
            <IFrameCardDemo iframeStep={iframeStep} progressiveRunId={progressiveRunId} />
          )}
        </div>
      </FoQueryParent>
      {step >= 4 && (
        <FoQueryParent name="details">
          <div className="subregion">
            <h3>Details</h3>
            <Leaf names={["DefaultItem"]}>Info</Leaf>
            <Leaf names={["SelectedItem"]}>Edit</Leaf>
          </div>
        </FoQueryParent>
      )}
    </>
  );
}

// --- Diagnostics display ---

function ProgressiveDiagnostics({
  diagnostics,
  status,
}: {
  diagnostics: Types.RequestDiagnostics | null;
  status: string | null;
}) {
  if (!diagnostics || !status) return null;

  const { startedAt, resolvedAt } = diagnostics;
  const fmt = (ts: number) => `+${ts - startedAt}ms`;

  return (
    <div className="progressive-diagnostics">
      <h3>Progressive Focus Diagnostics</h3>
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>XPath</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>requestFocus</td>
            <td className="xpath-col">{diagnostics.xpath}</td>
            <td>+0ms</td>
          </tr>
          {diagnostics.events.map((evt, i) => (
            <tr
              key={i}
              className={
                evt.type === "succeeded"
                  ? "success"
                  : evt.type.includes("degraded") ||
                      evt.type.includes("lost") ||
                      evt.type.includes("canceled") ||
                      evt.type.includes("timed")
                    ? "failure"
                    : ""
              }
            >
              <td>{evt.type}</td>
              <td className="xpath-col">
                {"xpath" in evt ? evt.xpath : "leafNames" in evt ? evt.leafNames.join(", ") : "—"}
              </td>
              <td>{fmt(evt.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="diag-summary">
        {diagnostics.candidates.length} candidate{diagnostics.candidates.length !== 1 ? "s" : ""},{" "}
        {diagnostics.events.length} event{diagnostics.events.length !== 1 ? "s" : ""}
        {resolvedAt ? `, total ${resolvedAt - startedAt}ms` : ""}
      </div>
    </div>
  );
}

// --- Sidebar ---

function SidebarContent({
  onProgressive,
  onProgressiveIFrame,
}: {
  onProgressive: () => void;
  onProgressiveIFrame: () => void;
}) {
  return (
    <FoQueryParent name="sidebar">
      <div className="region sidebar">
        <h2>Sidebar</h2>
        <Leaf names={["SelectedItem"]}>Inbox</Leaf>
        <Leaf names={["DefaultItem"]}>Drafts</Leaf>
        <Leaf names={["DefaultItem"]}>Sent</Leaf>
        <hr style={{ margin: "8px 0", borderColor: "#ddd" }} />
        <div className="progressive-actions">
          <button onClick={onProgressive} className="progressive-btn">
            Progressive
          </button>
          <button onClick={onProgressiveIFrame} className="progressive-btn">
            Progressive IFrame
          </button>
        </div>
      </div>
    </FoQueryParent>
  );
}

function getRequestStatusName(status: RequestStatus): string {
  return status === RequestStatus.Succeeded
    ? "Succeeded"
    : status === RequestStatus.Canceled
      ? "Canceled"
      : status === RequestStatus.TimedOut
        ? "TimedOut"
        : status === RequestStatus.NoCandidates
          ? "NoCandidates"
          : `Status ${status}`;
}

// --- Main app ---

function InnerApp() {
  const ctx = useContext(FoQueryContext);
  const [panels, setPanels] = useState<number[]>([]);
  const [nextId, setNextId] = useState(1);
  const [contentStep, setContentStep] = useState(4);
  const [iframeStep, setIFrameStep] = useState(3);
  const [progressiveIFrameRunId, setProgressiveIFrameRunId] = useState<string | null>(null);
  const [focusReady, setFocusReady] = useState(true);
  const [diagResult, setDiagResult] = useState<{
    diagnostics: Types.RequestDiagnostics;
    status: string;
  } | null>(null);

  // Root-level check callback: blocks focus when checkbox is unchecked
  const focusReadyRef = useRef(focusReady);
  focusReadyRef.current = focusReady;

  useEffect(() => {
    if (!ctx) return;
    const check = () => focusReadyRef.current;
    ctx.root.checkCallbacks.add(check);
    return () => {
      ctx.root.checkCallbacks.delete(check);
    };
  }, [ctx]);

  const addPanel = () => {
    setPanels((prev) => [...prev, nextId]);
    setNextId((prev) => prev + 1);
  };

  const removePanel = (id: number) => {
    setPanels((prev) => prev.filter((p) => p !== id));
  };

  const runProgressive = useCallback(() => {
    if (!ctx) return;

    setContentStep(0);
    setIFrameStep(3);
    setProgressiveIFrameRunId(null);
    setDiagResult(null);

    // Wait for React to render empty state
    requestAnimationFrame(() => {
      setTimeout(() => {
        const request = ctx.requestFocus("//content/messages/compose/SelectedItem", {
          timeout: 15000,
        });

        const timers: ReturnType<typeof setTimeout>[] = [];

        for (let step = 1; step <= 3; step++) {
          const tid = setTimeout(() => setContentStep(step), step * 1000);
          timers.push(tid);
        }

        request.promise.then((status) => {
          timers.forEach(clearTimeout);

          setDiagResult({
            diagnostics: request.diagnostics!,
            status: getRequestStatusName(status),
          });

          setTimeout(() => setContentStep(4), 500);
        });
      }, 0);
    });
  }, [ctx]);

  const runProgressiveIFrame = useCallback(() => {
    if (!ctx) return;

    setContentStep(3);
    setIFrameStep(0);
    const runId = String(Date.now());
    setProgressiveIFrameRunId(runId);
    setDiagResult(null);

    requestAnimationFrame(() => {
      setTimeout(() => {
        const request = ctx.requestFocus(IFRAME_LEVEL_THREE_FOCUS_QUERY, {
          timeout: 15000,
        });

        const timers: ReturnType<typeof setTimeout>[] = [
          setTimeout(() => {
            setContentStep(4);
            setIFrameStep(1);
          }, 1000),
        ];

        request.promise.then((status) => {
          timers.forEach(clearTimeout);

          setDiagResult({
            diagnostics: request.diagnostics!,
            status: getRequestStatusName(status),
          });

          setTimeout(() => {
            setContentStep(4);
            setIFrameStep(3);
          }, 500);
        });
      }, 0);
    });
  }, [ctx]);

  const focusIframeCard = useCallback(() => {
    ctx?.requestFocus(IFRAME_FOCUS_QUERY, { timeout: 5000 });
  }, [ctx]);

  const focusSecondaryIframeCard = useCallback(() => {
    ctx?.requestFocus(IFRAME_SECONDARY_FOCUS_QUERY, { timeout: 5000 });
  }, [ctx]);

  const focusNestedIframeCard = useCallback(() => {
    ctx?.requestFocus(IFRAME_NESTED_FOCUS_QUERY, { timeout: 5000 });
  }, [ctx]);

  const focusLevelThreeIframeCard = useCallback(() => {
    ctx?.requestFocus(IFRAME_LEVEL_THREE_FOCUS_QUERY, { timeout: 5000 });
  }, [ctx]);

  return (
    <>
      <h1>FoQuery Example</h1>

      <div className="layout">
        <FoQueryParent name="header">
          <div className="region header">
            <h2>Header</h2>
            <Leaf names={["DefaultItem"]}>Home</Leaf>
            <Leaf names={["SelectedItem"]}>Search</Leaf>
          </div>
        </FoQueryParent>

        <SidebarContent onProgressive={runProgressive} onProgressiveIFrame={runProgressiveIFrame} />

        <FoQueryParent name="content" focus="./messages">
          <div className="region content">
            <h2>
              Content{" "}
              {contentStep < 4
                ? `(loading step ${contentStep}/3...)`
                : iframeStep < 3
                  ? `(loading iframe step ${iframeStep}/3...)`
                  : ""}
            </h2>
            <ContentByStep
              iframeStep={iframeStep}
              progressiveRunId={progressiveIFrameRunId}
              step={contentStep}
            />
          </div>
        </FoQueryParent>

        <FoQueryParent name="footer">
          <div className="region footer">
            <h2>Footer</h2>
            <Leaf names={["DefaultItem"]}>Action</Leaf>
          </div>
        </FoQueryParent>

        {panels.map((id) => (
          <DynamicPanel key={id} id={id} onRemove={() => removePanel(id)} />
        ))}
      </div>

      <ProgressiveDiagnostics
        diagnostics={diagResult?.diagnostics ?? null}
        status={diagResult?.status ?? null}
      />

      <div className="controls">
        <h2>Dynamic Controls</h2>
        <button onClick={addPanel}>Add Panel</button>
        <button onClick={focusIframeCard}>Focus Iframe Card</button>
        <button onClick={focusSecondaryIframeCard}>Focus Sibling Iframe</button>
        <button onClick={focusNestedIframeCard}>Focus Nested Iframe</button>
        <button onClick={focusLevelThreeIframeCard}>Focus Level 3 Iframe</button>
        <label style={{ marginLeft: 12 }} data-foquery-ignore>
          <input
            id="focus-ready-toggle"
            type="checkbox"
            checked={focusReady}
            onChange={(e) => setFocusReady(e.target.checked)}
            data-foquery-ignore
          />{" "}
          Focus Ready
        </label>
      </div>

      {import.meta.env.DEV && (
        <p className="info">
          Open Chrome DevTools and look for the &quot;FoQuery&quot; panel. The tree is exposed as{" "}
          <code>window.__FOQUERY_ROOT__</code>. The iframe demo focuses with{" "}
          <code>{IFRAME_FOCUS_QUERY}</code>, <code>{IFRAME_SECONDARY_FOCUS_QUERY}</code>,{" "}
          <code>{IFRAME_NESTED_FOCUS_QUERY}</code>, and{" "}
          <code>{IFRAME_LEVEL_THREE_FOCUS_QUERY}</code>.
        </p>
      )}
    </>
  );
}

export function App() {
  if (import.meta.env.DEV) {
    return (
      <FoQueryProvider window={window} rootName="Root" devtools>
        <InnerApp />
      </FoQueryProvider>
    );
  }

  return (
    <FoQueryProvider window={window} rootName="Root">
      <InnerApp />
    </FoQueryProvider>
  );
}

export function FrameApp() {
  const role = getExampleFrameRole();
  const params = new URLSearchParams(window.location.search);
  const frameOrigins = getFrameOrigins();
  const parentOrigin = params.get("parentOrigin") ?? "*";
  const nestedOrigin = params.get("nestedOrigin") ?? frameOrigins.nested;
  const levelThreeOrigin = params.get("levelThreeOrigin") ?? frameOrigins.levelThree;
  const progressive = params.get("progressive") === "true";
  const [includeNested, setIncludeNested] = useState(params.get("includeNested") === "true");
  const [includeLevelThree, setIncludeLevelThree] = useState(
    params.get("includeLevelThree") === "true",
  );

  useEffect(() => {
    if (!progressive) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    if (role === "primary") {
      timers.push(setTimeout(() => setIncludeNested(true), 1000));
    } else if (role === "nested") {
      timers.push(setTimeout(() => setIncludeLevelThree(true), 1000));
    }

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [progressive, role]);

  let rootName = "FrameRoot";
  let frameId = IFRAME_DEMO_FRAME_ID;
  let content: ReactElement | null = null;

  if (role === "primary") {
    frameId = params.get("frameId") ?? IFRAME_DEMO_FRAME_ID;
    content = (
      <IFrameCardContent
        includeLevelThree={includeLevelThree}
        includeNested={includeNested}
        nestedOrigin={nestedOrigin}
        levelThreeOrigin={levelThreeOrigin}
        progressive={progressive}
        siblingFocusQuery={IFRAME_SECONDARY_FOCUS_QUERY}
      />
    );
  } else if (role === "secondary") {
    rootName = "SecondaryFrameRoot";
    frameId = params.get("frameId") ?? IFRAME_SECONDARY_FRAME_ID;
    content = (
      <IFrameCardContent
        nestedOrigin={nestedOrigin}
        levelThreeOrigin={levelThreeOrigin}
        siblingFocusQuery={IFRAME_FOCUS_QUERY}
      />
    );
  } else if (role === "nested") {
    rootName = "NestedFrameRoot";
    frameId = params.get("frameId") ?? IFRAME_NESTED_FRAME_ID;
    content = (
      <NestedCardContent
        includeLevelThree={includeLevelThree}
        levelThreeOrigin={levelThreeOrigin}
      />
    );
  } else if (role === "level-three") {
    rootName = "LevelThreeRoot";
    frameId = params.get("frameId") ?? IFRAME_LEVEL_THREE_FRAME_ID;
    content = <LevelThreeCardContent />;
  }

  if (!content) return null;

  return (
    <FoQueryFrameProvider
      window={window}
      rootName={rootName}
      frameId={frameId}
      parentOrigin={parentOrigin}
    >
      <div className="frame-route">{content}</div>
    </FoQueryFrameProvider>
  );
}
