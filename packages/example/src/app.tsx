/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { useState, useCallback, useContext } from "react";
import { FoQueryProvider, FoQueryParent, useFoQuery, FoQueryContext } from "foquery-react";
import type { Types } from "foquery";
import { RequestStatus } from "foquery";
import "./app.css";

function Leaf({ names, children }: { names: string[]; children: string }) {
  const ref = useFoQuery<HTMLButtonElement>(names);
  return <button ref={ref}>{children}</button>;
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

function ContentByStep({ step }: { step: number }) {
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
          {diagnostics.progressiveMatches.map((match, i) => (
            <tr key={i} className={match.degraded ? "degraded" : ""}>
              <td>
                {match.matched ? (match.degraded ? "degraded" : "partial match") : "lost match"}
              </td>
              <td className="xpath-col">{match.xpath || "—"}</td>
              <td>{fmt(match.timestamp)}</td>
            </tr>
          ))}
          <tr className={status === "Succeeded" ? "success" : "failure"}>
            <td>resolved: {status}</td>
            <td className="xpath-col">
              {diagnostics.winner
                ? (diagnostics.winner.foQueryLeafNode?.names.join(", ") ??
                  diagnostics.winner.foQueryParentNode?.name ??
                  "—")
                : "none"}
            </td>
            <td>{resolvedAt ? fmt(resolvedAt) : "—"}</td>
          </tr>
        </tbody>
      </table>
      <div className="diag-summary">
        {diagnostics.candidates.length} candidate{diagnostics.candidates.length !== 1 ? "s" : ""},{" "}
        {diagnostics.progressiveMatches.length} progressive step
        {diagnostics.progressiveMatches.length !== 1 ? "s" : ""}
        {resolvedAt ? `, total ${resolvedAt - startedAt}ms` : ""}
      </div>
    </div>
  );
}

// --- Sidebar ---

function SidebarContent({ onProgressive }: { onProgressive: () => void }) {
  return (
    <FoQueryParent name="sidebar">
      <div className="region sidebar">
        <h2>Sidebar</h2>
        <Leaf names={["SelectedItem"]}>Inbox</Leaf>
        <Leaf names={["DefaultItem"]}>Drafts</Leaf>
        <Leaf names={["DefaultItem"]}>Sent</Leaf>
        <hr style={{ margin: "8px 0", borderColor: "#ddd" }} />
        <button onClick={onProgressive} className="progressive-btn">
          Progressive
        </button>
      </div>
    </FoQueryParent>
  );
}

// --- Main app ---

function InnerApp() {
  const ctx = useContext(FoQueryContext);
  const [panels, setPanels] = useState<number[]>([]);
  const [nextId, setNextId] = useState(1);
  const [contentStep, setContentStep] = useState(4);
  const [diagResult, setDiagResult] = useState<{
    diagnostics: Types.RequestDiagnostics;
    status: string;
  } | null>(null);

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
          const statusName =
            status === RequestStatus.Succeeded
              ? "Succeeded"
              : status === RequestStatus.Canceled
                ? "Canceled"
                : status === RequestStatus.TimedOut
                  ? "TimedOut"
                  : status === RequestStatus.NoCandidates
                    ? "NoCandidates"
                    : `Status ${status}`;

          setDiagResult({
            diagnostics: request.diagnostics!,
            status: statusName,
          });

          setTimeout(() => setContentStep(4), 500);
        });
      }, 0);
    });
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

        <SidebarContent onProgressive={runProgressive} />

        <FoQueryParent name="content" focus="./messages">
          <div className="region content">
            <h2>Content {contentStep < 4 && `(loading step ${contentStep}/3...)`}</h2>
            <ContentByStep step={contentStep} />
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
      </div>

      <p className="info">
        Open Chrome DevTools and look for the &quot;FoQuery&quot; panel. The tree is exposed as{" "}
        <code>window.__FOQUERY_ROOT__</code>.
      </p>
    </>
  );
}

export function App() {
  return (
    <FoQueryProvider rootName="Root" devtools>
      <InnerApp />
    </FoQueryProvider>
  );
}
