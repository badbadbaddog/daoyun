# DYR-026：站点设置与运维按需

完成 AC-026-01/02/03。本轮未提交、未部署；HEAD 40bcff25ec920912bff7f4472bc6174e63b8e2d9，分支 codex/daoyun-home-foundation。前序未提交改动保留。下一项 DYR-027 尚未启动；G3–G6 仍 NOT_ACCEPTED。

## 最终行为

- 站点设置分为品牌、邮件、附件存储和运维。附件存储为按需加载的只读页面；显示新写入、未标记历史记录的位置与构建支持状态。配置状态不是存储健康检查，不返回目录、endpoint、bucket 或凭据。GET /api/v1/admin/attachments/storage 使用 admin.configuration.read 和统一 request_id/OpenAPI 契约。
- DAOYUN_OPERATIONS_ALERTS_ENABLED 默认 true；false/0/no 不构造或启动高级评估 worker，summary 准确报告未启用。Outbox、邮件、账号限制到期和健康检查保留。历史告警可查看、确认，规则保留；停用期间不会自动评估恢复。
- 迁移 202610040002 为 topic_attachments、site_branding_assets、membership_medal_assets 增加可空 storage_provider。新写入显式记录 local/s3；读取和删除按记录位置，NULL 使用 DAOYUN_ATTACHMENT_LEGACY_PROVIDER（缺省当前写 provider）。切换本地新写入需保留历史 S3 配置及 infrastructure/s3 feature。共享品牌/勋章元数据保护本地孤儿清理。
- S3 feature 与 Redis 可选性保留。Redis 仅品牌缓存，PostgreSQL/Outbox 仍为事实来源。当前保留一个本地根目录和一个 S3 bucket/prefix；NULL 混合位置需先按实际对象核验补齐标记，不能猜测。
- 备份脚本吞掉 PostgreSQL 详细诊断并报通用错误；修复无 ProgramFiles 和单一候选安装路径定位。脚本遇到失败返回非零，不承诺传播子进程原始退出码。完整备份/恢复操作见 [运维说明](../../operations/backup-and-restore.md)。SHA-256 sidecar 缺失不会被现有 CLI 自动拒绝，必须先验证完整集合。

## 真实验证

- 前端 117 文件、1091 条通过；应用类型、生产构建、E2E 类型、实际 OpenAPI 生成类型一致性通过。
- Rust 基础 API 215 条通过；全 workspace（Wasm/S3）492 条通过、2 ignored。两种构建 clippy 与格式通过。ignored 的官方成长 Wasm 构件用例未算 PASS。
- 本轮新增唯一浏览器 6 PASS；重复运行不累计，之前 162 → 累计 168。桌面/手机检查 320、390、768、1024、1440px；320/1440 的 axe、无水平溢出、控制台/请求检查通过。最终 40 张截图，抽查存储与运维在 320/1440px 的布局。
- 真实 object_store S3 HTTP 适配器连接受控 loopback 协议服务，写入主题/草稿原图缩略图、品牌、勋章；切换本地后，标记 S3 与 NULL 历史读取正常，新记录明确 local。不是生产 AWS/MinIO 验收。
- 停止 API/worker 后通过现有 PowerShell 脚本备份并恢复至新隔离库。最终备份 2026-10-04T09:20:02.228Z；93 张表、395 行的排序内容 SHA-256 在恢复后、启动 worker 前完全一致。2 个本地对象和 6 个 S3 对象复制到新目录后长度和摘要一致，解密材料从备份复制。
- 恢复后的密码登录、MFA TOTP 登录、SMTP 密码解密、注册验证码解密/投递与实际注册通过。主题/品牌/勋章原图、草稿缩略图可读；草稿所有者恢复成功，他人访问草稿/私有缩略图 404、配置读取 403。
- 过期租约重新领取，注册邮件实际投递一次且完成后 attempts 稳定；品牌缓存失效任务完成一次，过期限制账号恢复 active。Outbox/plugin 水位另存，未注册处理器的既有 pending 事件未伪装成已清空。
- 恢复 checksum 篡改被拒绝；PowerShell PATH/默认安装目录两种定位的诊断保护四用例先红后绿。Bash 两脚本仅语法检查通过。

## 证据与范围

[验证清单](../../../artifacts/v3/dyr026-2026-10-04/verification.json)，[最终备份摘要](../../../artifacts/v3/dyr026-2026-10-04/restore-bundle-final-verification.json)，[恢复注册](../../../artifacts/v3/dyr026-2026-10-04/registration-code-restored-verification.json)，[浏览器证据](../../../artifacts/v3/dyr026-2026-10-04/browser-restored/)。

本轮只使用新建 PostgreSQL 集群 15437 的 DYR-026 source/restore 库及受控邮件/S3 服务。API 3002、页面 4175、PG 15437、S3 19037、SMTP 19038 全部停止；库、完整对象、私密测试材料和日志保留在忽略目录。未读取/改写生产配置，不把测试密钥放入 Git 或交接。

生产 S3、Linux/Docker 恢复、实体手机软键盘 NOT_RUN。账本/幂等表已作全表摘要对账，但本样本账本为空，非空财务重放未验证，留待后续完整回归。首次已投递验证码样本被替换为真正待发送密文，再执行最终备份恢复；协议服务启动参数、用例选择器/等待、类型检查配置等失败记录保留，最终以 PASS 日志为准。

## 回滚

回退代码不移动或删除历史对象；关闭新写入前保存当前完整集合。删除 provider 列或运行旧单存储二进制前，核对混合对象的实际位置和读取能力，不能仅交换二进制。恢复旧 worker 前核对队列水位、过期 lease 与幂等；恢复点之后的新写入不在本备份 RPO 内。
