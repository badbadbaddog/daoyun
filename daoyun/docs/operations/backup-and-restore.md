# 完整备份与隔离恢复

DYR-026；仅本地/隔离演练，生产恢复必须由操作者核对目标。数据库 dump 不是完整站点备份。

## 备份集合

- PostgreSQL custom dump 与 SHA-256；包含账号/密码散列、会话、角色授权、内容、附件元数据、草稿关联、积分账本、幂等记录、MFA/SMTP 密文及 Outbox/插件任务。
- 所有实际对象：本地附件根目录、历史 S3 bucket/prefix 下的原图/缩略图/主题和草稿附件、品牌与上传勋章。静态资源另随部署构建保存。对象清单至少含存储类型、相对 key、长度、SHA-256；S3 分页列举实际对象并下载或保存可恢复版本，清单不替代对象本身。
- 私密材料：DAOYUN_MFA_ENCRYPTION_KEY（TOTP）、DAOYUN_SMTP_ENCRYPTION_KEY（SMTP 密码与注册验证码），以及已有 S3/数据库/SMTP/OIDC 凭据、TLS 材料或其可恢复的秘密管理版本。不得重新生成这两把解密密钥替代备份；密钥丢失的密文无法恢复。
- 配置版本：附件当前/历史 provider、保留的 local root 和 S3 endpoint/bucket/prefix/region/寻址方式，邮件与注册设置、Passkey RP/origin、OIDC provider 设置、插件与成长执行模式、告警开关、Redis 可选设置。不要把实际凭据写进清单、Git、工单、日志或交接。
- 运行版本：源代码版本及未提交变更清单、数据库迁移版本/checksum、Cargo feature、API 二进制/前端构建校验、备份 UTC 起止时点。秘密配置和对象清单放入受限备份集合，并保留独立可验证的完整性摘要。

## 一致备份步骤

1. 暂停用户写入，停止 API 与所有 worker，等待正在处理的事务完成；同时禁止其他进程、对象清理和外部写入。仅停止高级告警不能得到一致备份。
2. 记录备份时点、迁移状态、账号/内容/草稿/附件/权限/账本条数与关键 ID；记录 Outbox pending/processing/dead 的数量、最老 created_at、max(id)、attempts/lease 时间，以及插件事件/任务水位。确认水位来自同一个停止写入的时点。
3. 运行 scripts/backup-postgres.ps1 或 .sh。复制完整本地根目录，备份实际 S3 对象与可恢复版本；核对数据库引用对象及缩略图都在集合中。保存私密配置/解密材料及部署标识，生成对象和配置校验清单。
4. 仅在集合校验完成后恢复服务。恢复点是上述停止写入/备份时点；此后产生的写入不包含在本次备份内，不能把后续数据丢失量宣称为零。Redis 只缓存品牌信息，不是事实来源，恢复时可重建缓存。

## 隔离恢复步骤

1. 在新的数据库和附件目录/隔离 bucket 中恢复；先禁止邮件真实投递、外部事件和所有 worker，核对 DATABASE_URL 指向隔离库。验证 dump、对象、私密配置与构建摘要，拒绝不完整或不匹配的集合。现有恢复脚本仅在 SHA-256 sidecar 存在时校验，因此操作者必须先检查完整集合及摘要；脚本不能替代这一步。
2. 使用备份对应版本/feature 的程序；创建空隔离库，运行 restore-postgres.ps1 -BackupFile <dump> -DatabaseUrl <isolated-url> -AllowDataLoss，或显式 ALLOW_DATA_LOSS=1 的 Bash 脚本。脚本会覆盖目标，不能使用生产连接。
3. 恢复实际对象到对应目录/key；复制备份密钥与配置（通过秘密管理工具或私密文件）。隔离 endpoint/root 可以更换，但对象相对 key 和 S3 prefix 应与备份一致。检查本构建包含读取历史 S3 必需的 infrastructure/s3 feature。在启动 API 前对比备份水位与恢复后 SQL 状态；API 启动会同时启动基础 worker。
4. 启动隔离 API。验证 live/ready、request_id、账号密码登录、TOTP 登录解密、SMTP 密码和注册验证码解密；核对公开内容、原图/缩略图、草稿所有者隔离、非授权附件拒绝、角色/用户组/权益权限、积分账本及幂等记录。
5. 隔离 API 启动后，基础 worker 会继续处理任务。检查过期 lease 的重试与幂等，确认任务不重复产生账本/外部副作用；邮件测试只指向受控接收器。
6. 记录实际断言、日志与摘要。对容器/Linux、生产 S3、真实邮件或实体设备未运行的部分明确标为 NOT_RUN。验证完成后停止隔离进程，保留集合与证据。生产切换另行授权。

## 从 S3 切换为本地新写入

保持历史 S3 endpoint、bucket、prefix、region 和访问身份；DAOYUN_ATTACHMENT_PROVIDER=local 仅决定新写入。已标记记录按 storage_provider 选择存储；未标记旧记录需要 DAOYUN_ATTACHMENT_LEGACY_PROVIDER=s3。新本地记录显式标记 local，避免被历史配置误读。

切换前检查 topic_attachments、site_branding_assets、membership_medal_assets 的 NULL 标记与对象清单。若历史记录混用多个位置，必须先根据实际对象逐项确认并补齐标记，不能盲目统一更新。保留 local root 中的旧本地对象，不修改历史 S3 bucket/prefix；当前支持一个保留的本地根目录与一个保留的 S3 位置。切换或回滚不移动、删除对象，存储配置状态不等同于远端健康。

新增迁移只加可空 provider 列。回滚旧二进制前必须核对新写入的位置和历史读取能力；不要直接删列后让旧单 provider 程序读取混合对象。重新启用高级告警前核对规则、历史活动告警与任务水位，停用期间不会自动评估恢复。
