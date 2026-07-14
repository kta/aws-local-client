import { useState } from "react";
import { Link } from "react-router-dom";
import { useConnections } from "../state/connections";
import { SERVICES } from "../services/registry";

const CARD_BASE =
  "flex items-center gap-3 rounded-[10px] border bg-white p-[14px] text-left shadow-[0_1px_2px_rgba(0,21,41,.08)]";

function Icon({ src, name }: { src?: string; name: string }) {
  if (src) return <img src={src} alt="" className="h-[42px] w-[42px] flex-none" />;
  // Abbreviation tile for services without a bespoke icon: word initials for
  // multi-word names ("Step Functions" -> SF), first three letters otherwise.
  const words = name.split(/\s+/).filter(Boolean);
  const abbr =
    words.length > 1
      ? words
          .map((w) => w[0])
          .join("")
          .slice(0, 3)
          .toUpperCase()
      : name.slice(0, 3).toUpperCase();
  return (
    <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[8px] bg-[#eceff4] text-[12px] font-bold tracking-wide text-[#5f6b7a]">
      {abbr}
    </span>
  );
}

export function Home() {
  const { active } = useConnections();
  const [query, setQuery] = useState("");
  // Enabled services first; keep the registry order within each group.
  const sorted = [...SERVICES].sort((a, b) => Number(b.enabled) - Number(a.enabled));
  // Case-insensitive substring match on service name and id.
  const q = query.trim().toLowerCase();
  const services = q
    ? sorted.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    : sorted;
  return (
    <div className="p-[22px] px-6 pb-[30px]">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-[20px] font-bold" data-testid="home-heading">
        サービス
      </h1>
        <span className="text-[12.5px] text-[#5f6b7a]">
          接続: <b className="text-[#16191f]">{active?.name ?? "未選択"}</b>
        </span>
      </div>
      <div className="mb-4">
        <input
          type="search"
          data-testid="service-search"
          placeholder="サービスを検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-[360px] rounded-lg border border-[#d9dee3] bg-white px-[12px] py-[7px] text-[13px] text-[#16191f] outline-none focus:border-[#0972d3]"
        />
      </div>
      {services.length === 0 && (
        <p className="text-[13px] text-[#5f6b7a]" data-testid="service-search-empty">
          該当するサービスがありません
        </p>
      )}
      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
        {services.map((s) =>
          s.enabled ? (
            <Link
              key={s.id}
              to={s.home}
              data-testid={`service-${s.id}`}
              className={`${CARD_BASE} border-[#d9dee3] text-[#16191f] hover:border-[#0972d3]`}
            >
              <Icon src={s.icon} name={s.name} />
              <span className="text-[14px] font-bold">{s.name}</span>
            </Link>
          ) : (
            <div
              key={s.id}
              aria-disabled="true"
              className={`${CARD_BASE} cursor-not-allowed border-[#d9dee3] text-[#16191f] opacity-45`}
            >
              <Icon src={s.icon} name={s.name} />
              <span className="text-[14px] font-bold">{s.name}</span>
            </div>
          ),
        )}
      </div>
      <p className="mt-8 text-[11px] text-[#8a94a6]" data-testid="aws-trademark-note">
        Amazon Web Services および本アプリに表示される各 AWS サービス名は、Amazon.com, Inc.
        またはその関連会社の商標です。本アプリは AWS 非公式のローカルエミュレータ用クライアントです。
      </p>
    </div>
  );
}
