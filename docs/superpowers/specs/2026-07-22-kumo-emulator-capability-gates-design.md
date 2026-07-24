# kumo エミュレータ対応 + capability ベース E2E ゲート設計

- 日付: 2026-07-22
- ステータス: 承認済み(実装中)
- 関連: `2026-07-14-phase3-dashboard-partiql-backup-design.md`(R20/R21 分岐)、
  `2026-07-14-service-console-expansion-design.md`(R33〜R50 の能力マトリクス)

## 背景と問題

[kumo](https://github.com/sivchari/kumo)(Go 製の軽量 AWS エミュレータ、port 4566、
`ghcr.io/sivchari/kumo:latest`)を LocalStack / floci / ministack と同列の
対応エミュレータに加える。

アプリ本体は「エミュレータ種別」を持たない設計(エンドポイント URL + ランタイムの
unsupported エラー検出)のため改修はほぼ不要だが、実測により **E2E スイートの分岐
モデルが破綻する**ことが判明した:

- 現行の `rds.e2e.ts` は「DescribeDBInstances / CreateDBInstance の 2 プローブ」で
  エミュレータを `create | readonly | unsupported` の 3 値に分類し、R33〜R50 の
  全 RDS テストがこの粗い代表値で分岐する。
- kumo は **部分実装**(instance CRUD / stop / start / modify ○、reboot ×、
  snapshot create/delete ○ だが describe/restore ×、parameter group 全 ×)であり、
  3 値のどれにも当てはまらない。`create` に分類され R48/R49/R50 が RED になる。
- 同様に PartiQL(R19)も kumo 非対応で、現行スイートに非対応分岐が存在しない。

エミュレータとサービスは今後も増える。「エミュレータがどれか」を当てるモデルは
組み合わせ爆発するため、**「この操作をこのエンドポイントがサポートするか」を単位**
とする capability モデルに E2E を再設計する。

## 実測 capability マトリクス(2026-07-22)

プローブ方法: AWS CLI / AWS SDK for JS / aws-sdk-rust / 生 HTTP。
kumo は名前が複数サービスで重複するアクション(TagResource, CreateDBInstance 等)を
**User-Agent の `api/<service>` トークンで判別する**。AWS SDK(JS/Rust)はこれを
送るため実アプリ・E2E とも正常動作する(素の curl や AWS CLI v2 は AmbiguousAction
になるが、これはプローブ手法の問題であり製品挙動ではない)。

| 操作 | localstack:3 | floci | ministack | kumo |
| --- | --- | --- | --- | --- |
| DynamoDB コア(table/item CRUD, Scan, Query, GSI) | ○ | ○ | ○ | ○ |
| DynamoDB PartiQL(ExecuteStatement) | ○ | ○ | ○ | × |
| DynamoDB Backup(Create/List/Restore) | × | × | ○ | × |
| S3 バケット/オブジェクト CRUD・versioning・CORS・policy・copy・multipart | ○ | ○ | ○ | ○ |
| S3 バケットタグ(PutBucketTagging) | ○ | ○ | ○ | ×(CreateBucket に誤ルート) |
| S3 フォルダキー(`<prefix>/` の保持) | △(非決定的に剥離) | ○ | ○ | ×(末尾スラッシュ剥離) |
| SQS 全操作(R22〜R37) | ○ | ○ | ○ | ○ |
| SQS ListDeadLetterSourceQueues | ○ | ○ | × | × |
| SNS 全操作(R26〜R41) | ○ | ○ | ○ | ○ |
| SNS トピックタグ(TagResource の永続化) | ○ | ○ | ○ | ×(成功応答だが未保存) |
| RDS DescribeDBInstances | × | ○ | ○ | ○ |
| RDS CreateDBInstance | × | ×(既定起動) | ○ | ○ |
| RDS Stop/Start/Modify | × | × | ○ | ○ |
| RDS RebootDBInstance | × | × | ○ | × |
| RDS DescribeDBSnapshots | × | ○ | ○ | × |
| RDS CreateDBSnapshot / DeleteDBSnapshot | × | —(instance create 不可のため到達不能) | ○ | ○ |
| RDS RestoreDBInstanceFromDBSnapshot | × | × | ○ | × |
| RDS DBParameterGroup 系 | × | ○ | ○ | × |

### kumo 固有の技術的発見

1. **RDS(Query/XML プロトコル)のエラーを JSON で返す**。
   `{"__type":"UnknownAction","message":"Action X is not supported for service rds"}`。
   AWS SDK は XML を期待するためデシリアライズに失敗し、
   - JS SDK: `Error: @aws-sdk XML parse error`(unsupported 判別不能)
   - Rust SDK: `Unhandled(XmlDecodeError)`、code/message 空
   となり、既存の unsupported 検出(文字列照合)が届かない。
2. **SQS QueueUrl は内部ポート 4566 で組み立てられる**(floci / ministack も同様)。
   ただし AWS SDK は per-queue 操作を設定エンドポイントへ送信し QueueUrl の
   ホスト/ポートをルーティングに使わないため、`EMU_PORT` 運用でも実害はない
   (実測で send/receive/delete が成功することを確認済み)。
3. unsupported エラーの文言は `is not valid` / `not supported` /
   `UnknownOperationException` 系で、フロントの `isUnsupportedOperation` と
   E2E の `isUnsupportedError` の既存正規表現がそのままカバーする。
4. **S3 PutObject の `aws-chunked` ボディをデコードせず保存する**。AWS SDK の
   既定(checksum WhenSupported)は CRC トレーラ付き `aws-chunked` ストリームで
   アップロードするため、kumo ではオブジェクト本文に chunk-signature フレームが
   混入する。アプリの S3 クライアントを `RequestChecksumCalculation::WhenRequired`
   に設定してプレーンな PUT にすることで回避する(他エミュレータにも無害)。
5. **サイレントな部分実装が 2 つ**: SNS TagResource は成功を返すがタグを保存せず、
   S3 の `<prefix>/` フォルダマーカーキーは末尾スラッシュが剥がされる。どちらも
   エラーにならないため、capability プローブは「往復で値が残るか」の機能検証で
   判定する(`sns.topicTags` / `s3.folderKeys`)。

## 設計

### 1. Rust: デシリアライズ不能な ServiceError に生ボディを付与(`error.rs`)

`map_sdk_err` の ServiceError 分岐で **code が無く message も無い**(= エラー本文を
デシリアライズできなかった)場合、生レスポンスボディの先頭(最大 300 バイト)を
AppError メッセージに含める。

- kumo の JSON エラー本文(`...is not supported for service rds`)がそのまま
  フロントに届き、`isUnsupportedOperation` が自然に一致 → Snapshots /
  ParameterGroups ページの unsupported バナーが正しく出る。
- kumo 固有ハックではない: プロトコル不一致のエラーを返すあらゆる相手に対する
  診断情報の改善であり、従来 `Unhandled(XmlDecodeError)` という無情報メッセージ
  だったものが常に改善される。
- ワイヤ契約(AppError の kind/message 構造)は不変。

### 2. E2E: capability レジストリ(`e2e/helpers/capabilities.ts`、新規)

- 名前空間付き capability ID と、その実機プローブを 1 モジュールに集約:

  | capability ID | プローブ |
  | --- | --- |
  | `dynamodb.partiql` | ExecuteStatement(存在しないテーブル)。NotFound 系 → 対応 |
  | `dynamodb.backups` | ListBackups(既存 `supportsBackups` を移設) |
  | `rds.instances.describe` | DescribeDBInstances |
  | `rds.instances.create` | CreateDBInstance → 成功時 Delete(現行 probe を移設) |
  | `rds.instances.reboot` | Reboot(存在しない ID)。NotFound 系 → 対応 |
  | `rds.snapshots.describe` | DescribeDBSnapshots |
  | `rds.snapshots.restore` | Restore(存在しないスナップショット)。NotFound 系 → 対応 |
  | `rds.parameterGroups.describe` | DescribeDBParameterGroups |
  | `s3.bucketTagging` | プローブバケットに Put/GetBucketTagging 往復(機能プローブ) |
  | `s3.folderKeys` | プローブバケットに `probe/` キー put → 一覧で保持確認(機能プローブ) |
  | `sns.topicTags` | プローブトピックに Tag/ListTagsForResource 往復(機能プローブ) |
  | `sqs.dlqSources` | ListDeadLetterSourceQueues(プローブキュー) |

- プローブは **スイート実行につき 1 回、モジュールレベルでメモ化**(全 spec 共有)。
- 判定は `isUnsupportedError` に一元化。**それ以外のエラーは throw**
  (実際の障害を「非対応」と誤判定して黙ってスキップしない)。
- RDS のプローブは kumo が JSON エラーを返し SDK でパースできないため、
  **生 HTTP(Query プロトコル + `api/rds` User-Agent)** で実装し本文を直接判定する。
- Mocha 統合: `gate(this, "R49", { on: [...], off: [...] })` —
  `on` の全 capability が真、`off` の全 capability が偽のときだけテストを実行し、
  実行を R-id 別に記録する。条件を満たさなければ `this.skip()`。

### 3. E2E: ゲート則と対称性ルール(spec 書き換え)

- **AND ゲート則**: supported 側テストは「そのテストが実際に叩く全操作の AND」で
  ゲートする(例: R49 ライフサイクル = `snapshots.describe ∧ instances.create ∧
  snapshots.restore`)。
- **対称性ルール**: capability 分岐は必ず supported 側(実フロー検証)と
  unsupported 側(バナー / エラー UI 検証)の対で書く。
- **カバレッジガード**: spec ファイルの `after` で「各 R-id につき最低 1 テストが
  実行された(全スキップでない)」ことをアサートする。どの capability の組でも
  無検証の R-id が生じたら CI が明示的に失敗し、静かなゼロカバレッジを排除する。
  (現行スイートには floci で R49 が全スキップになる既存の穴があり、これも塞ぐ。)

対象 R-id の再構成:

- R33/R34/R35: 3 値ブランチを `instances.describe` × `instances.create` の
  ゲートに置換(意味は等価)。
- R48: stop/start/modify と reboot を分離。reboot 非対応なら「reboot 実行で
  通常エラーバナー」を検証する対称テストを追加。
- R49: ライフサイクル(AND ゲート)/ `¬snapshots.describe` でバナー /
  describe ○ だがライフサイクル不可なら「一覧は描画され unsupported バナーは
  出ない」を検証(floci 級の中間ケース)。
- R50: `parameterGroups.describe` でゲート。
- R19: 行描画系を `dynamodb.partiql` でゲートし、非対応側は「テンプレート SELECT
  実行でエラーバナー」を検証。テンプレート挿入テストは無条件。
- R20/R21: `supportsBackups` を capability レジストリへ移設(挙動不変)。
- R38: 現行の「テーブル or 注記のどちらかが出る」という弱い either-or アサートを
  `sqs.dlqSources` ゲートで分岐する厳密アサートに強化。
- R43: バケットタグ往復を `s3.bucketTagging` でゲートし、非対応側は
  「タグ保存でエラーバナー」を検証。versioning / CORS / policy は無条件のまま。

### 4. ハーネス / CI / ドキュメント

- `scripts/emulator.sh`: `image_for()` に `kumo) ghcr.io/sivchari/kumo:latest`、
  docker ディスパッチと usage に `kumo` を追加。readiness は既存の汎用
  `list_tables_ok` をそのまま使う(kumo は DynamoDB ListTables に応答する)。
- `.github/workflows/e2e.yml`: `e2e-linux` のマトリクスに `kumo` を追加。
- `README.md` / `AGENTS.md`: 対応エミュレータ一覧・イメージ表・usage に kumo を追加。
  kumo の EMU_PORT 制約(SQS QueueUrl)を注記。
- `e2e/SPEC-COVERAGE.md`: 脚注の「エミュレータ名ベース」の分岐説明を
  「エミュレータ × capability」マトリクスに書き換え、kumo 列を追加。

### 変更しないもの

- 接続モデル(`ConnectionProfile` に種別フィールドは追加しない)
- フロントの unsupported 検出正規表現(`src/lib/unsupported.ts`)— 実測で
  kumo のエラー文言が既存パターンに一致することを確認済み
- `src/services/registry.ts` のサービスカタログ
- テスト ID・R-id 体系(意味の変わる R-id は仕様文を本設計で改訂)

## テスト計画

1. `error.rs` の生ボディ付与: 単体テスト(JSON ボディ + 空 metadata の
   ServiceError → メッセージに本文断片が含まれる)を先に書く(TDD)。
2. 全チェックブロック(tsc / vitest / cargo fmt / clippy / cargo test)green。
3. E2E フルスイートを **localstack:3 / floci / ministack / kumo の 4 種**に対して
   ローカル実行し全 green を確認(分岐再設計の回帰チェック)。
   カバレッジガードにより、どのエミュレータでも全 R-id が最低 1 テスト実行される。
