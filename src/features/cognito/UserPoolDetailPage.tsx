import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toAppError } from "../../api/client";
import type {
  CognitoGroup,
  CognitoUser,
  UserPoolClientSummary,
  UserPoolDetail,
} from "../../api/cognito";
import type { AppError, ConnectionProfile } from "../../api/types";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  Button,
  Card,
  ConfirmDangerModal,
  ConnectionRequired,
  Modal,
  ModalFooter,
} from "../../components/ui";
import { isUnsupportedOperation } from "../../lib/unsupported";
import { useProfileScopedFetch } from "../../lib/useProfileScopedFetch";
import { useConnections } from "../../state/connections";
import { CreateUserModal, type CreateUserInput } from "./CreateUserModal";

type Tab = "users" | "clients" | "groups";

const FIELD = "mt-1 w-full rounded border border-gray-300 px-2 py-1";
const LABEL = "block text-sm";
const LABEL_TEXT = "text-gray-600";

const TH =
  "[&>th]:border-b [&>th]:border-[#d9dee3] [&>th]:bg-[color-mix(in_srgb,#fff_60%,#f0f1f3)] [&>th]:px-[14px] [&>th]:py-[9px] [&>th]:text-left [&>th]:text-[12px] [&>th]:font-semibold [&>th]:text-[#5f6b7a]";
const TD = "[&>td]:border-b [&>td]:border-[#e9ecef] [&>td]:px-[14px] [&>td]:py-[9px]";
const REMOVE_BTN =
  "rounded-lg border border-[color-mix(in_srgb,#d13212_45%,#d9dee3)] px-[12px] py-[4px] text-[12.5px] font-semibold text-[#d13212] hover:border-[#5f6b7a]";

function tabClass(active: boolean): string {
  return `-mb-px whitespace-nowrap border-b-2 px-4 py-[9px] text-[13.5px] font-semibold ${
    active ? "border-[#0972d3] text-[#0972d3]" : "border-transparent text-[#5f6b7a]"
  }`;
}

export function UserPoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { active } = useConnections();
  const poolId = id ?? "";
  const {
    data: pool,
    error,
    reload,
  } = useProfileScopedFetch<UserPoolDetail>(
    (profile) => api.cognito.getUserPool(profile, poolId),
    [poolId],
  );

  const [tab, setTab] = useState<Tab>("users");

  return (
    <ConnectionRequired>
      <div className="p-[22px] px-6 pb-[30px]">
        <div className="mb-0.5 text-[12.5px] text-[#5f6b7a]">
          <Link
            to="/cognito/user-pools"
            className="font-semibold text-[#0972d3] hover:underline"
          >
            ユーザープール
          </Link>
          {" / "}
          {pool?.name ?? poolId}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[20px] font-bold" data-testid="pool-detail-heading">
            {pool?.name ?? poolId}
          </h1>
          <span className="font-mono text-[12.5px] text-[#5f6b7a]">{poolId}</span>
        </div>

        <ErrorBanner error={error} onRetry={reload} />

        <div className="mb-4 flex gap-0.5 overflow-x-auto border-b border-[#d9dee3]">
          <button onClick={() => setTab("users")} data-testid="tab-users" className={tabClass(tab === "users")}>
            ユーザー
          </button>
          <button
            onClick={() => setTab("clients")}
            data-testid="tab-app-clients"
            className={tabClass(tab === "clients")}
          >
            アプリクライアント
          </button>
          <button
            onClick={() => setTab("groups")}
            data-testid="tab-groups"
            className={tabClass(tab === "groups")}
          >
            グループ
          </button>
        </div>

        {active && poolId && tab === "users" && <UsersTab poolId={poolId} profile={active} />}
        {active && poolId && tab === "clients" && <ClientsTab poolId={poolId} profile={active} />}
        {active && poolId && tab === "groups" && <GroupsTab poolId={poolId} profile={active} />}
      </div>
    </ConnectionRequired>
  );
}

// ---- Users tab (R61) --------------------------------------------------------

function UsersTab({ poolId, profile }: { poolId: string; profile: ConnectionProfile }) {
  const { data, error, reload } = useProfileScopedFetch<CognitoUser[]>(
    (p) => api.cognito.listUsers(p, poolId),
    [poolId],
  );
  const users = data ?? [];
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CognitoUser | null>(null);
  const [pwdFor, setPwdFor] = useState<CognitoUser | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const createUser = async (input: CreateUserInput) => {
    try {
      await api.cognito.adminCreateUser(
        profile,
        poolId,
        input.username,
        input.email,
        input.tempPassword,
      );
      setCreating(false);
      setActionError(null);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  const toggleEnabled = async (u: CognitoUser) => {
    setActionError(null);
    try {
      if (u.enabled) await api.cognito.adminDisableUser(profile, poolId, u.username);
      else await api.cognito.adminEnableUser(profile, poolId, u.username);
      await reload();
    } catch (e) {
      setActionError(toAppError(e));
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="primary" onClick={() => setCreating(true)} data-testid="user-create">
          ユーザーの作成
        </Button>
      </div>

      <ErrorBanner error={actionError ?? error} onRetry={reload} />

      <Card className="overflow-x-auto">
        <table data-testid="users-table" className="w-full border-collapse [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className={TH}>
              <th>ユーザー名</th>
              <th>ステータス</th>
              <th>有効</th>
              <th>メール</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-[#5f6b7a]">
                  ユーザーがありません
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.username} data-testid={`user-row-${u.username}`} className={TD}>
                <td className="font-semibold">{u.username}</td>
                <td className="text-xs">{u.status ?? "-"}</td>
                <td className="text-xs">{u.enabled ? "有効" : "無効"}</td>
                <td className="font-mono text-xs">{u.email ?? "-"}</td>
                <td className="whitespace-nowrap">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPwdFor(u)}
                      data-testid={`user-set-password-${u.username}`}
                      className="rounded-lg border border-[#d9dee3] px-[12px] py-[4px] text-[12.5px] font-semibold text-[#0972d3] hover:border-[#5f6b7a]"
                    >
                      パスワード設定
                    </button>
                    <button
                      onClick={() => toggleEnabled(u)}
                      data-testid={u.enabled ? `user-disable-${u.username}` : `user-enable-${u.username}`}
                      className="rounded-lg border border-[#d9dee3] px-[12px] py-[4px] text-[12.5px] font-semibold text-[#5f6b7a] hover:border-[#5f6b7a]"
                    >
                      {u.enabled ? "無効化" : "有効化"}
                    </button>
                    <button onClick={() => setDeleting(u)} data-testid={`user-delete-${u.username}`} className={REMOVE_BTN}>
                      削除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {creating && <CreateUserModal onSubmit={createUser} onClose={() => setCreating(false)} />}

      {pwdFor && (
        <SetPasswordModal
          username={pwdFor.username}
          onSubmit={async (password, permanent) => {
            await api.cognito.adminSetUserPassword(profile, poolId, pwdFor.username, password, permanent);
            setPwdFor(null);
            await reload();
          }}
          onClose={() => setPwdFor(null)}
        />
      )}

      {deleting && (
        <ConfirmDangerModal
          title="ユーザーの削除"
          description={
            <>
              ユーザー <b className="font-mono text-[#16191f]">{deleting.username}</b>{" "}
              を削除します。確認のためユーザー名を入力してください。
            </>
          }
          requiredText={deleting.username}
          confirmLabel="削除"
          onConfirm={async () => {
            await api.cognito.adminDeleteUser(profile, poolId, deleting.username);
            setDeleting(null);
            await reload();
          }}
          onClose={() => setDeleting(null)}
          inputTestId="user-delete-input"
          confirmTestId="user-delete-confirm"
        />
      )}
    </div>
  );
}

function SetPasswordModal({
  username,
  onSubmit,
  onClose,
}: {
  username: string;
  onSubmit: (password: string, permanent: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [permanent, setPermanent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const valid = password.length > 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password, permanent);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`パスワード設定: ${username}`}
      onClose={onClose}
      maxWidth="md"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="設定"
          confirmingLabel="設定中..."
          confirmDisabled={!valid}
          confirmTestId="sp-save"
          busy={busy}
        />
      }
    >
      <div className="space-y-3">
        <ErrorBanner error={error} />
        <label className={LABEL}>
          <span className={LABEL_TEXT}>新しいパスワード</span>
          <input
            className={FIELD}
            data-testid="sp-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="sp-permanent"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
          />
          <span className={LABEL_TEXT}>永続的なパスワードにする</span>
        </label>
      </div>
    </Modal>
  );
}

// ---- App clients tab (R62) --------------------------------------------------

function ClientsTab({ poolId, profile }: { poolId: string; profile: ConnectionProfile }) {
  const { data, error, reload } = useProfileScopedFetch<UserPoolClientSummary[]>(
    (p) => api.cognito.listUserPoolClients(p, poolId),
    [poolId],
  );
  const clients = data ?? [];
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserPoolClientSummary | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="primary" onClick={() => setCreating(true)} data-testid="client-create">
          アプリクライアントの作成
        </Button>
      </div>

      <ErrorBanner error={actionError ?? error} onRetry={reload} />

      <Card className="overflow-x-auto">
        <table data-testid="clients-table" className="w-full border-collapse [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className={TH}>
              <th>名前</th>
              <th>クライアント ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                  アプリクライアントがありません
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr key={c.clientId} data-testid={`client-row-${c.clientName}`} className={TD}>
                <td className="font-semibold">{c.clientName}</td>
                <td className="font-mono text-xs" data-testid={`client-id-${c.clientName}`}>
                  {c.clientId}
                </td>
                <td>
                  <button onClick={() => setDeleting(c)} data-testid={`client-delete-${c.clientName}`} className={REMOVE_BTN}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {creating && (
        <NameDescModal
          title="アプリクライアントの作成"
          nameLabel="クライアント名"
          nameTestId="cc-name"
          saveTestId="cc-save"
          onSubmit={async (name) => {
            try {
              await api.cognito.createUserPoolClient(profile, poolId, name);
              setCreating(false);
              setActionError(null);
              await reload();
            } catch (e) {
              setActionError(toAppError(e));
            }
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {deleting && (
        <ConfirmDangerModal
          title="アプリクライアントの削除"
          description={
            <>
              アプリクライアント <b className="font-mono text-[#16191f]">{deleting.clientName}</b>{" "}
              を削除します。確認のためクライアント名を入力してください。
            </>
          }
          requiredText={deleting.clientName}
          confirmLabel="削除"
          onConfirm={async () => {
            await api.cognito.deleteUserPoolClient(profile, poolId, deleting.clientId);
            setDeleting(null);
            await reload();
          }}
          onClose={() => setDeleting(null)}
          inputTestId="clients-delete-input"
          confirmTestId="clients-delete-confirm"
        />
      )}
    </div>
  );
}

// ---- Groups tab (R62) -------------------------------------------------------

function GroupsTab({ poolId, profile }: { poolId: string; profile: ConnectionProfile }) {
  const { data, error, reload } = useProfileScopedFetch<CognitoGroup[]>(
    (p) => api.cognito.listGroups(p, poolId),
    [poolId],
  );
  const groups = data ?? [];
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CognitoGroup | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  // kumo answers group operations with InvalidAction; show a notice instead of
  // an error banner and hide the create action (symmetric with the RDS pattern).
  const unsupported = error && isUnsupportedOperation(error) ? error : null;
  const listError = error && !unsupported ? error : null;

  return (
    <div>
      {!unsupported && (
        <div className="mb-3 flex items-center gap-2">
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="group-create">
            グループの作成
          </Button>
        </div>
      )}

      {unsupported && (
        <div
          data-testid="cognito-groups-unsupported"
          className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <div className="font-semibold">このエミュレータはグループをサポートしていません</div>
          <div className="mt-1 text-amber-800">{unsupported.message}</div>
        </div>
      )}

      {!unsupported && (
        <>
          <ErrorBanner error={actionError ?? listError} onRetry={reload} />

          <Card className="overflow-x-auto">
            <table data-testid="groups-table" className="w-full border-collapse [font-variant-numeric:tabular-nums]">
              <thead>
                <tr className={TH}>
                  <th>名前</th>
                  <th>説明</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-[#5f6b7a]">
                      グループがありません
                    </td>
                  </tr>
                )}
                {groups.map((g) => (
                  <tr key={g.name} data-testid={`group-row-${g.name}`} className={TD}>
                    <td className="font-semibold">{g.name}</td>
                    <td className="text-xs text-[#5f6b7a]">{g.description ?? "-"}</td>
                    <td>
                      <button onClick={() => setDeleting(g)} data-testid={`group-delete-${g.name}`} className={REMOVE_BTN}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {creating && (
        <NameDescModal
          title="グループの作成"
          nameLabel="グループ名"
          nameTestId="cg-name"
          descLabel="説明(任意)"
          descTestId="cg-desc"
          saveTestId="cg-save"
          onSubmit={async (name, description) => {
            try {
              await api.cognito.createGroup(profile, poolId, name, description);
              setCreating(false);
              setActionError(null);
              await reload();
            } catch (e) {
              setActionError(toAppError(e));
            }
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {deleting && (
        <ConfirmDangerModal
          title="グループの削除"
          description={
            <>
              グループ <b className="font-mono text-[#16191f]">{deleting.name}</b>{" "}
              を削除します。確認のためグループ名を入力してください。
            </>
          }
          requiredText={deleting.name}
          confirmLabel="削除"
          onConfirm={async () => {
            await api.cognito.deleteGroup(profile, poolId, deleting.name);
            setDeleting(null);
            await reload();
          }}
          onClose={() => setDeleting(null)}
          inputTestId="groups-delete-input"
          confirmTestId="groups-delete-confirm"
        />
      )}
    </div>
  );
}

/** Small create modal with a required name and an optional description. */
function NameDescModal({
  title,
  nameLabel,
  nameTestId,
  descLabel,
  descTestId,
  saveTestId,
  onSubmit,
  onClose,
}: {
  title: string;
  nameLabel: string;
  nameTestId: string;
  descLabel?: string;
  descTestId?: string;
  saveTestId: string;
  onSubmit: (name: string, description?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, descTestId ? desc.trim() || undefined : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      maxWidth="lg"
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={submit}
          confirmLabel="作成"
          confirmingLabel="作成中..."
          confirmDisabled={!valid}
          confirmTestId={saveTestId}
          busy={submitting}
        />
      }
    >
      <div className="space-y-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>{nameLabel}</span>
          <input
            className={FIELD}
            data-testid={nameTestId}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {descTestId && (
          <label className={LABEL}>
            <span className={LABEL_TEXT}>{descLabel}</span>
            <input
              className={FIELD}
              data-testid={descTestId}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
