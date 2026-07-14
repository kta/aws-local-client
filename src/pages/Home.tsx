import { Link } from "react-router-dom";
import { useConnections } from "../state/connections";
import ddbIcon from "../assets/aws/icon-ddb.svg";
import sqsIcon from "../assets/aws/icon-sqs.svg";
import snsIcon from "../assets/aws/icon-sns.svg";
import s3Icon from "../assets/aws/icon-s3.svg";
import ec2Icon from "../assets/aws/icon-ec2.svg";
import eksIcon from "../assets/aws/icon-eks.svg";

type Service = { id: string; name: string; desc: string; icon: string; to?: string };

const SERVICES: Service[] = [
  { id: "dynamodb", name: "DynamoDB", desc: "NoSQL データベース", icon: ddbIcon, to: "/dynamodb/tables" },
  { id: "sqs", name: "SQS", desc: "coming soon", icon: sqsIcon },
  { id: "sns", name: "SNS", desc: "coming soon", icon: snsIcon },
  { id: "s3", name: "S3", desc: "coming soon", icon: s3Icon },
  { id: "ec2", name: "EC2", desc: "coming soon", icon: ec2Icon },
  { id: "eks", name: "EKS", desc: "coming soon", icon: eksIcon },
];

const CARD_BASE =
  "flex items-center gap-3 rounded-[10px] border bg-white p-[14px] text-left shadow-[0_1px_2px_rgba(0,21,41,.08)]";

function Icon({ src }: { src: string }) {
  return <img src={src} alt="" className="h-[42px] w-[42px] flex-none" />;
}

function Body({ name, desc }: { name: string; desc: string }) {
  return (
    <span>
      <span className="block text-[14px] font-bold">{name}</span>
      <span className="block text-[12px] text-[#5f6b7a]">{desc}</span>
    </span>
  );
}

export function Home() {
  const { active } = useConnections();
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
      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
        {SERVICES.map((s) =>
          s.to ? (
            <Link
              key={s.id}
              to={s.to}
              data-testid={`service-${s.id}`}
              className={`${CARD_BASE} border-[#d9dee3] text-[#16191f] hover:border-[#0972d3]`}
            >
              <Icon src={s.icon} />
              <Body name={s.name} desc={s.desc} />
            </Link>
          ) : (
            <div
              key={s.id}
              aria-disabled="true"
              className={`${CARD_BASE} cursor-not-allowed border-[#d9dee3] text-[#16191f] opacity-45`}
            >
              <Icon src={s.icon} />
              <Body name={s.name} desc={s.desc} />
            </div>
          ),
        )}
      </div>
      <p className="mt-8 text-[11px] text-[#8a94a6]" data-testid="aws-trademark-note">
        Amazon Web Services、Amazon DynamoDB、Amazon SQS、Amazon SNS、Amazon S3、Amazon EC2、Amazon
        EKS は、Amazon.com, Inc. またはその関連会社の商標です。
      </p>
    </div>
  );
}
