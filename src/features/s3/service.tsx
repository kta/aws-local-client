import { Navigate } from "react-router-dom";
import type { ServiceDefinition } from "../../services/types";
import s3Icon from "../../assets/aws/icon-s3.svg";
import { BucketBrowserPage } from "./BucketBrowserPage";
import { BucketsPage } from "./BucketsPage";

export const s3Service: ServiceDefinition = {
  id: "s3",
  name: "S3",
  description: "オブジェクトストレージ",
  icon: s3Icon,
  basePath: "/s3",
  enabled: true,
  home: "/s3/buckets",
  nav: [{ label: "バケット", path: "/s3/buckets", testId: "nav-buckets", group: 0 }],
  routes: [
    { path: "/s3", element: <Navigate to="/s3/buckets" replace /> },
    { path: "/s3/buckets", element: <BucketsPage /> },
    { path: "/s3/buckets/:bucket", element: <BucketBrowserPage /> },
  ],
  crumbLabel: (pathname) => {
    if (pathname.startsWith("/s3/buckets/")) {
      const name = decodeURIComponent(pathname.slice("/s3/buckets/".length));
      return ["バケット", name];
    }
    if (pathname.startsWith("/s3/buckets")) return ["バケット"];
    return null;
  },
};
