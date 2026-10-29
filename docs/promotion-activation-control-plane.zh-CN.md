# Promotion 激活控制面（签名 + 单次消费 + 写入读回）

状态：代码已就绪，**默认仍关闭**。在 owner 完成下面的"启用前置"之前，apply 一律 fail-closed。

## 流程（manual-strategy-switch.yml，apply=true）
1. 生成 target 文件。预览时会在 summary 里打印 `config_sha256`，签发人要把这个值绑进清单。
2. `Verify immutable Promotion Manifest`：沿用原来的 v2 校验，包括字段完全一致、自哈希和有效期。
3. `Verify Promotion Manifest KMS signature`：在 `promotion_signature.py` 里验证分离式 DER 签名。
   - 签名内容：`b"qsl.promotion_signature.v1\n" + canonical_promotion_json(manifest)`。
   - 加这个域前缀，是为了让同一把 KMS root 签的 promotion 签名和 autonomy policy 签名互相不能冒用。
   - 信任根是 `docs/p0_control_roots/gcp/<project>.json`（每个平台一个项目，不能借用别的平台的根）。只有当它的 `trusted_policy_root_sha256` 等于 `runtime-strategy-switch` Environment 变量 `QSL_PROMOTION_TRUSTED_ROOTS_JSON`（`{platform: sha256}`）里钉住的值时才接受。
   - 这个值没钉住、不匹配、签名不对、或有效期超过 24 小时，都拒绝。
4. `Consume single_use_id`：在 `promotion_ledger.py` 里，在 QRS 创建 annotated tag `qsl-promotion-consumed/<id>`。
   - 为什么用这个存储：`POST git/refs` 在 ref 已存在时返回 422，天然是原子的"不存在才创建"；不用新建任何云资源；tag 对象里记了 promotion_sha256、签名摘要、run id，可审计，也不含秘密。
   - 防篡改：消费前会检查 tag ruleset 是否 active、是否覆盖 `refs/tags/qsl-promotion-consumed/**`、是否禁止 deletion 和 update、是否没有 bypass。缺任何一项都拒绝。
   - 判定是 fail-closed 的：必须有一个 ruleset 同时满足 target=tag、列表与详情的 enforcement 都是 active、`conditions` 只含 `ref_name` 且 `ref_name` 恰好只有 `include`/`exclude` 两个字符串列表、include 含 `refs/tags/qsl-promotion-consumed/**`、exclude 里没有任何可能匹配 ledger tag 的模式（`~ALL`、`~DEFAULT_BRANCH`、非 `refs/` 开头的模式、以及字面前缀与 `refs/tags/qsl-promotion-consumed/` 相交的通配，均按覆盖处理，大小写不敏感）、rules 含 deletion 与 update、`bypass_actors` 若可见必须为空列表、`current_user_can_bypass` 为 `never`。exclude 字段缺失或类型不对一律拒绝。
   - 消费发生在写入之前。之后任何一步失败，这个 id 就作废了，要重新签一份，绝不重试。
5. `Apply GitHub variable updates`，然后 `Read back applied variables`（`verify_applied_assignments.py`，只输出变量名）。
6. `trigger_platform_sync` 仍然拒绝。平台同步要另外单独跑。

不受影响的部分：预览（apply=false）、其他平台的预览和 IBKR preflight 都不变。没钉信任根的平台照旧不能 apply。控制台的 `SWITCH_ACTIVATION_CONNECTED` 仍是 false，控制台不能发起签名 apply。

## 签发（人工，不放进 CI）
签发人身份是专用 SA `qsl-promotion-signer@<project>`，只在该平台 root key 上有 `roles/cloudkms.signerVerifier`。由 owner 本人通过 impersonation 运行 `python/scripts/sign_promotion_manifest.sh`。

签名不放进 GitHub workflow：否则任何有仓库写权限的人都能自己签自己放行，人工这道关就没了。

步骤：
- `build_promotion_manifest.py` 生成清单。
- `sign_promotion_manifest.sh` 签名。
- `promotion_signature.py verify` 在本地验证。
- 把 envelope `{"promotion_manifest":…, "kms_signature_b64":…}` 填进 `promotion_manifest_json`，`promotion_single_use_id` 填清单里的 id。

candidate 各字段约定：
- `source_revision`：要运行的平台仓库 commit。
- `artifact_sha256`：该 commit 的 `uv.lock` 的 sha256。
- `config_sha256`：预览打印的值。
- `risk_sha256`：`runtime_target.runtime_risk_limits` 的 canonical JSON 的 sha256。没有限额时，对 `{}` 计算。

## (d) 新 target（例如 LB SG TQQQ）的授权
- 本流程强制 `live_continuity_state=NONE`，不伪造 legacy 基线。
- 新 target 的实盘授权等于"这次被消费的签名 promotion"：ledger tag 加上 promotion_sha256。
- 后续可以加 `release_attested` 型 continuity：`strategy_release = {source_revision, promotion_sha256, ledger_ref}`，由平台在运行时回查 ledger tag。这需要改平台侧代码，单独开 PR。
- 平台在没有 live_continuity 时是否允许 live 下单，要在 LongBridge 的 dry-run 里实测确认。

## 启用前置（owner）
1. 建 tag ruleset（见交接提示词）。
2. 新增 secret `QSL_PROMOTION_LEDGER_TOKEN`：fine-grained token，只给 QRS 的 contents 读写权限。
3. Environment 变量 `QSL_PROMOTION_TRUSTED_ROOTS_JSON` 设为 `{"longbridge":"a8ea86116ab3286ae7d19970b7d3c5d60849bfcaf95976e86669a0e35bff6f91"}`。
4. 运行 KMS IAM 提示词，创建 signer SA 并授权。
