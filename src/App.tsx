import { useEffect, useRef } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { Home } from "./pages/Home";
import { SERVICES } from "./services/registry";
import { ConnectionsProvider, useConnections } from "./state/connections";

function AppRoutes() {
  const { profiles, loading } = useConnections();
  const location = useLocation();
  const navigate = useNavigate();
  const started = useRef(false);

  // Connection management is the entry screen: redirect there once on startup.
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      navigate("/connections", { replace: true });
    }
  }, [navigate]);

  // With zero profiles, keep the user on /connections.
  useEffect(() => {
    if (!loading && profiles.length === 0 && location.pathname !== "/connections") {
      navigate("/connections", { replace: true });
    }
  }, [loading, profiles.length, location.pathname, navigate]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        {SERVICES.flatMap((s) => s.routes).map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ConnectionsProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </ConnectionsProvider>
  );
}
