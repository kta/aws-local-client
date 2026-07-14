import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { serviceForPath } from "../services/registry";

const ITEM_BASE = "block border-l-[3px] px-[18px] py-[7px] text-[13.5px] no-underline";

export function SideNav() {
  const { pathname } = useLocation();
  const service = serviceForPath(pathname);
  if (!service || service.nav.length === 0) return null;

  // Active item = the nav entry whose prefix matches and is the most specific
  // (longest). This reproduces the previous exact-vs-startsWith behavior:
  // "/dynamodb" only lights the dashboard, deeper paths light their own item.
  const prefixOf = (item: (typeof service.nav)[number]) => item.matchPrefix ?? item.path;
  const activePath = service.nav
    .filter((item) => pathname.startsWith(prefixOf(item)))
    .sort((a, b) => prefixOf(b).length - prefixOf(a).length)[0]?.path;

  const itemClass = (active: boolean) =>
    active
      ? `${ITEM_BASE} border-[#0972d3] bg-[#0972d314] font-bold text-[#0972d3]`
      : `${ITEM_BASE} border-transparent text-[#16191f] hover:bg-[#0972d30f]`;

  return (
    <aside className="w-[210px] flex-none border-r border-[#d9dee3] bg-white py-[14px]">
      <h2 className="mb-[6px] border-b border-[#e9ecef] px-[18px] pb-[10px] text-[15px] font-bold">
        {service.name}
      </h2>
      {service.nav.map((item, i) => {
        const prev = service.nav[i - 1];
        const separator = i > 0 && (item.group ?? 0) !== (prev.group ?? 0);
        return (
          <Fragment key={item.path}>
            {separator && <div className="my-2 h-px bg-[#e9ecef]" />}
            <Link to={item.path} data-testid={item.testId} className={itemClass(item.path === activePath)}>
              {item.label}
            </Link>
          </Fragment>
        );
      })}
      <div className="my-2 h-px bg-[#e9ecef]" />
      <Link to="/" className={`${ITEM_BASE} border-transparent text-[#16191f] hover:bg-[#0972d30f]`}>
        ← サービス一覧へ
      </Link>
    </aside>
  );
}
