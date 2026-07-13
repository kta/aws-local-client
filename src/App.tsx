import { useEffect, useRef } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { Home } from "./pages/Home";
import { TablesPage } from "./features/dynamodb/TablesPage";
import { ConnectionsProvider, useConnections } from "./state/connections";

function Placeholder({ name }: { name: string }) {
  return <div className="p-6 text-gray-500">{name} (準備中)</div>;
}

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
        <Route path="/dynamodb" element={<Navigate to="/dynamodb/tables" replace />} />
        <Route path="/dynamodb/tables" element={<TablesPage />} />
        <Route path="/dynamodb/tables/:tableName" element={<Placeholder name="テーブル詳細" />} />
        <Route path="/dynamodb/explore" element={<Placeholder name="項目を探索" />} />
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
