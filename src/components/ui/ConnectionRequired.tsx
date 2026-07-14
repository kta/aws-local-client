import { Link } from "react-router-dom";
import { useConnections } from "../../state/connections";

/**
 * Guard that renders the "接続が未登録です…" prompt when there is no active
 * connection, otherwise its children (§2.12). Unifies the guard across pages.
 */
export function ConnectionRequired({ children }: { children: React.ReactNode }) {
  const { active } = useConnections();
  if (!active) {
    return (
      <div className="p-6 text-gray-500">
        接続が未登録です。
        <Link to="/connections" className="text-blue-600 underline">
          接続管理
        </Link>
        から登録してください。
      </div>
    );
  }
  return <>{children}</>;
}
