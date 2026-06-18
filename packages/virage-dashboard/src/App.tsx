import { Component, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { HomePage } from "./components/HomePage";
import { ChunkBrowser } from "./components/ChunkBrowser";
import { SearchPage } from "./components/SearchPage";
import { PipelinePage } from "./components/PipelinePage";
import { ExperimentsPage } from "./components/ExperimentsPage";
import { AnalyticsPage } from "./components/AnalyticsPage";
import { WebSocketProvider } from "./context/WebSocketContext";
import { ToastProvider } from "./context/ToastContext";

class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            fontFamily: "monospace",
            maxWidth: 640,
            margin: "48px auto",
          }}
        >
          <h2 style={{ color: "#c00" }}>Dashboard error</h2>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 16,
              borderRadius: 4,
              overflowX: "auto",
            }}
          >
            {(this.state.error as Error).message}
          </pre>
          <p>
            Check the terminal where <code>virage dashboard</code> is running
            for server logs. Run with <code>--verbose</code> for request-level
            detail.
          </p>
          <button onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <DashboardErrorBoundary>
      <ToastProvider>
        <WebSocketProvider>
          <BrowserRouter>
            <div className="layout">
              <nav className="sidebar">
                <div className="sidebar-logo">Virage</div>
                <NavLink to="/" end>
                  Home
                </NavLink>
                <NavLink to="/chunks">Chunks</NavLink>
                <NavLink to="/search">Search</NavLink>
                <NavLink to="/pipeline">Pipeline</NavLink>
                <NavLink to="/experiments">Experiments</NavLink>
                <NavLink to="/analytics">Analytics</NavLink>
              </nav>
              <main className="main-content">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/chunks" element={<ChunkBrowser />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/pipeline" element={<PipelinePage />} />
                  <Route path="/experiments" element={<ExperimentsPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                </Routes>
              </main>
            </div>
          </BrowserRouter>
        </WebSocketProvider>
      </ToastProvider>
    </DashboardErrorBoundary>
  );
}
