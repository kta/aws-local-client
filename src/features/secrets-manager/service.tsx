import { Navigate } from "react-router-dom";
import type { ServiceDefinition } from "../../services/types";
import { SecretDetailPage } from "./SecretDetailPage";
import { SecretsPage } from "./SecretsPage";

export const secretsManagerService: ServiceDefinition = {
  id: "secrets-manager",
  name: "Secrets Manager",
  description: "シークレット管理",
  basePath: "/secrets-manager",
  enabled: true,
  home: "/secrets-manager/secrets",
  nav: [
    { label: "シークレット", path: "/secrets-manager/secrets", testId: "nav-secrets", group: 0 },
  ],
  routes: [
    { path: "/secrets-manager", element: <Navigate to="/secrets-manager/secrets" replace /> },
    { path: "/secrets-manager/secrets", element: <SecretsPage /> },
    { path: "/secrets-manager/secrets/:name", element: <SecretDetailPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/secrets-manager/secrets/")) {
      const name = decodeURIComponent(pathname.slice("/secrets-manager/secrets/".length));
      return ["シークレット", name];
    }
    if (pathname.startsWith("/secrets-manager/secrets")) return ["シークレット"];
    return null;
  },
};
