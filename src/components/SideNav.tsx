import { Link, useLocation } from "react-router-dom";

const ITEM_BASE = "block border-l-[3px] px-[18px] py-[7px] text-[13.5px] no-underline";

export function SideNav() {
  const { pathname } = useLocation();
  const dashboardActive = pathname === "/dynamodb";
  const tablesActive = pathname.startsWith("/dynamodb/tables");
  const exploreActive = pathname.startsWith("/dynamodb/explore");
  const partiqlActive = pathname.startsWith("/dynamodb/partiql");
  const backupsActive = pathname.startsWith("/dynamodb/backups");

  const itemClass = (active: boolean) =>
    active
      ? `${ITEM_BASE} border-[#0972d3] bg-[#0972d314] font-bold text-[#0972d3]`
      : `${ITEM_BASE} border-transparent text-[#16191f] hover:bg-[#0972d30f]`;

  return (
    <aside className="w-[210px] flex-none border-r border-[#d9dee3] bg-white py-[14px]">
      <h2 className="mb-[6px] border-b border-[#e9ecef] px-[18px] pb-[10px] text-[15px] font-bold">
        DynamoDB
      </h2>
      <Link to="/dynamodb" data-testid="nav-dashboard" className={itemClass(dashboardActive)}>
        ダッシュボード
      </Link>
      <Link to="/dynamodb/tables" data-testid="nav-tables" className={itemClass(tablesActive)}>
        テーブル
      </Link>
      <Link to="/dynamodb/explore" data-testid="nav-explore" className={itemClass(exploreActive)}>
        項目を探索
      </Link>
      <div className="my-2 h-px bg-[#e9ecef]" />
      <Link to="/dynamodb/partiql" data-testid="nav-partiql" className={itemClass(partiqlActive)}>
        PartiQL エディタ
      </Link>
      <Link to="/dynamodb/backups" data-testid="nav-backups" className={itemClass(backupsActive)}>
        バックアップ
      </Link>
      <div className="my-2 h-px bg-[#e9ecef]" />
      <Link to="/" className={`${ITEM_BASE} border-transparent text-[#16191f] hover:bg-[#0972d30f]`}>
        ← サービス一覧へ
      </Link>
    </aside>
  );
}
