import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { HomePage } from "./components/HomePage";
import { ChunkBrowser } from "./components/ChunkBrowser";
import { SearchPage } from "./components/SearchPage";
import { PipelinePage } from "./components/PipelinePage";
import { ExperimentsPage } from "./components/ExperimentsPage";
import { WebSocketProvider } from "./context/WebSocketContext";

export function App() {
  return (
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
          </nav>
          <main className="main-content">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/chunks" element={<ChunkBrowser />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/pipeline" element={<PipelinePage />} />
              <Route path="/experiments" element={<ExperimentsPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </WebSocketProvider>
  );
}
