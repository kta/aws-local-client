import { Link, useLocation } from "react-router-dom";

const ITEM_BASE = "block border-l-[3px] px-[18px] py-[7px] text-[13.5px] no-underline";
const SOON = `${ITEM_BASE} cursor-not-allowed border-transparent text-[#5f6b7a] opacity-50`;

export function SideNav() {
  const { pathname } = useLocation();
  const tablesActive = pathname.startsWith("/dynamodb/tables");
  const exploreActive = pathname.startsWith("/dynamodb/explore");

  const itemClass = (active: boolean) =>
    active
      ? `${ITEM_BASE} border-[#0972d3] bg-[#0972d314] font-bold text-[#0972d3]`
      : `${ITEM_BASE} border-transparent text-[#16191f] hover:bg-[#0972d30f]`;

  return (
    <aside className="w-[210px] flex-none border-r border-[#d9dee3] bg-white py-[14px]">
      <h2 className="mb-[6px] border-b border-[#e9ecef] px-[18px] pb-[10px] text-[15px] font-bold">
        DynamoDB
      </h2>
      <span className={SOON} aria-disabled="true">
        ダッシュボード
      </span>
      <Link to="/dynamodb/tables" className={itemClass(tablesActive)}>
        テーブル
      </Link>
      <Link to="/dynamodb/explore" className={itemClass(exploreActive)}>
        項目を探索
      </Link>
      <div className="my-2 h-px bg-[#e9ecef]" />
      <span className={SOON} aria-disabled="true">
        PartiQL エディタ
      </span>
      <span className={SOON} aria-disabled="true">
        バックアップ
      </span>
      <div className="my-2 h-px bg-[#e9ecef]" />
      <Link to="/" className={`${ITEM_BASE} border-transparent text-[#16191f] hover:bg-[#0972d30f]`}>
        ← サービス一覧へ
      </Link>
    </aside>
  );
}
