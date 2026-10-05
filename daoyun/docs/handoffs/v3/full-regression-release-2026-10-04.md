# DYR-028–030 全链路回归、候选测量与隔离恢复

最新直接审计见[2026-10-05记录](direct-current-audit-2026-10-05.md)：前端1096、Rust504通过，39项为35 PASS、2 PARTIAL、2 NOT_RUN；停止完整历史基线恢复检索，历史材料不再阻挡当前行为审计。下文保留前轮测量、恢复及历史材料核验事实。

DYR-028/029/030 的可执行工作已经落实，整体仍为 IN_PROGRESS；三项任务保留 BLOCKED，G3–G6 尚未接受。DYR-001–026 的历史 DONE 记录保留。DYR-027 的公开传播目标未启用，依赖 DYR-028，保持条件任务未启动。原工作区未提交、未部署。

## 本轮修复

- 通知列表、计数、单读、全读及水位快照统一检查目标当前可见性。回复/点赞目标变成受限内容时不泄漏正文、标题或关联通知；事实记录不删除，权限恢复后仍可见。治理通知保留不含正文的处置事实。稳定游标仍检查归属，保留原分页语义。
- 业务响应缺少 Cache-Control 时统一采用 private, no-store；保留静态资源与诊断响应已有的明确缓存头。
- 创建主题与回复的事务在额度和幂等处理前锁定活跃作者，账号受限时返回公开的 user.action_restricted，私有限制原因不出响应，拒绝后无内容或额度副作用。
- WebAuthn 注册/断言省略 excludeCredentials/allowCredentials 时采用标准空数组；非数组继续拒绝。真实 Chromium 虚拟认证器链路覆盖注册、登录、删除、撤销后拒绝及密码恢复。
- 四个内容创建入口补齐 OpenAPI 的 429 ErrorResponse 与 x-request-id，重新生成前端类型。

## 验证范围

冻结源码前端 117 文件、1093 测试通过；Rust workspace 的 Wasm+S3 组合 503 PASS、2 ignored。两个官方组件 ignored 用例分别单独执行并通过，不把 ignored 算入 503。应用及 E2E 类型、生产构建、组合 clippy -D warnings、格式和 OpenAPI 生成核对通过。完整 Rust 门禁之后增强的 OIDC 用例单独 1 PASS，批量处置测试文件 10 PASS；总用例数仍为 503。

冻结副本本轮去重后 46 个浏览器场景 PASS，其中新加的两个回归文件包含 16 个新场景。以此前已接受交接的 168 为历史累计口径，累计 184；重跑既有场景不重复累计。浏览器为桌面 Chromium 与 390px 窄屏，相关检查额外使用 320/768/1024/1440 宽度及 Axe。它们不能替代实体手机软键盘或实体认证器。

普通 Cookie 会话 CSRF 矩阵涉及 107 个写操作：105 个操作的缺失/错误令牌共 210 次真实 API 拒绝，91 张业务表前后哈希一致；另外两个 OIDC 绑定/替换操作使用已配置本地 IdP 和真实已登录会话覆盖 8 次拒绝。本地无 provider 时原矩阵的四个 404 不作为 CSRF 证据。9 个公开注册/安装、登录及挑战令牌操作按各自认证协议测试，未冒称为普通会话 CSRF。

批量举报处置沿用冻结契约：只有全局能力可进入批次；scoped reviewer 的混合版块批次整体 403，状态和审计均不变。整批采用一个事务，任一对象无效全部回滚，成功返回所有 report_ids。重复提交不幂等，会再次推进各项 revision 并增加审计；未知结果先读取状态，不自动重试。逐项操作采用独立 PATCH 与 expected_revision，不新增部分成功批次。

异步通知角标用两个实际标签页和延迟的真实计数响应复验。Headless bringToFront 不可靠触发焦点事件，因此显式发送 window focus 以启动生产刷新逻辑；没有伪造业务响应。账号切换使用新注册夹具及相同版块；已有耗尽额度夹具的失败记录保留，没有重置额度掩盖失败。

补充验证（本地时间2026-10-05）：公开/受限/恢复三个阶段的主题、附件列表、原图与缩略图均断言 private,no-store。官方Wasm组件真实运行后停用并销毁旧worker，重新启用revision3并创建全新runtime/worker，重放6个原事件；经验账户、流水、命令回执与事件时间/来源的完整快照保持一致。两项定向测试、格式及Clippy通过，正常Rust用例数与浏览器累计数不变；AC-X-25/27 仍为PARTIAL。证据：artifacts/v3/dyr030-2026-10-04/supported-worker-cache-verification.json。

## DYR-029 候选测量

原始 artifacts/v3/baseline-2026-10-02 已缺失，已询问其保存位置；DYR-025 的局部重建不能代替完整基线。所有以下数字都是候选测量值，不能给出改善百分比或判定历史退化。

同机暖缓存五轮：TypeScript 增量检查+Vite 构建中位数 18.934 秒，最近秩 P95 19.225 秒。强制 TypeScript 全编译+Vite 五轮中位数 23.013 秒，P95 26.592 秒；--force 绕过编译增量缓存，OS/依赖缓存仍暖，冷 OS 构建 NOT_RUN。

四种 release --locked 产物均成功构建，各启动五轮、每轮各采样 30 次 feed 和搜索请求，能力声明与实际结果一致：

| 产物 | 二进制字节数 | 启动中位数 ms | Windows working set 中位数 KiB |
| --- | ---: | ---: | ---: |
| base | 52871624 | 147.113 | 17800 |
| wasm | 78184043 | 151.043 | 18548 |
| s3 | 60822352 | 155.556 | 20456 |
| combined | 86348853 | 153.175 | 21220 |

基础/Wasm 构建不支持历史 S3 读取，实际返回 503；S3/组合构建返回 200 且对象 SHA 相同。Native 模块独立于 Wasm；基础版实际管理页和旧投票提交/回放在两个浏览器项目中通过，数据库投票仍一条。早先 debug/dev 测量另存，未混成 release 性能。

五轮新 Chromium context 的首页 HAR：浏览器 HTTP 缓存冷、OS/数据库暖；每轮16个API请求，其中2个是轻量权限入口，不算隐藏重管理数据。隐藏重请求0、富文本编辑器未加载、页面错误0。首屏 JS 为 index-BwfcgGV0.js，构建约429.20kB/gzip117.25kB；编辑器独立约433.83kB/gzip138.22kB。Release 基础版五轮真实 SQLx 查询日志按服务器 request_id 关联：首页 feed 每次3条，搜索每次1条，封套与header相同。SQL追踪模式只用于计数，不与无追踪延迟混用。

## DYR-030 恢复与回退

独立冻结副本包含源码与锁文件，执行固定锁安装及门禁。Windows 的安装钩子裸 node 路径导致初次失败，改为固定锁安装后显式运行所需钩子，锁文件没有改动。Cargo 复验复用暖 target，不声称从空缓存构建。原仓库之外的私有冻结副本可创建证据提交，原 HEAD 和暂存区保持原样。最终副本提交及源码哈希见 verification.json。

源写入停止后，完整 dump 的 SHA256 为 ab6da0ac9a3431b24e36b92bf150bc2e77ecffa7b5c4bec95df5dfcb010ffd52，大小459672字节。Native pg_dump/pg_restore 真实执行，在全新专用恢复库启动 worker 之前对比全部93张表（54张非空），行内容与计数完全一致；6个 S3 original/thumbnail/草稿/品牌/勋章对象的字节与SHA相同。配置材料按哈希对账，测试密钥、Cookie、验证码与SMTP原始内容保存在忽略的 private 目录。

恢复后真实验证：账号登录、TOTP/MFA密文解密、SMTP密码解密及验证码投递/注册、私有草稿归属、新写local与旧S3读取、provider=NULL的历史fallback、附件原图和缩略图、品牌与勋章。Points账本非空2条余额35，重放原收据不新增流水；EXP账本1条，原发布幂等与命令回执保留。过期邮件和插件租约从attempt3重试到4，奖励重放后账本仍1条。

恢复点后源库新增一笔7积分，源余额42，恢复库仍35，明确该新增写入不在备份内；认证/worker后续状态也按恢复点回退，不能宣称RPO=0或“只损失7积分”。原旧V2二进制缺失，实际旧镜像回退 NOT_RUN。当前演练恢复到本次测试备份，不替代非空V2历史升级验证。

PowerShell子进程宿主无法执行脚本内部native工具，因此仓库PowerShell封装脚本 NOT_RUN，实际数据库操作使用native工具完成。Linux脚本、生产S3、真实CDN和实体设备未执行。Restore材料验收使用本地S3协议服务与独立SMTP服务，不冒称生产云验证。

AC-028-02 已按用户确认的每用户、每窗口额度验收通过：两个用户同时发起16个请求，每人一成功七拒绝，额度/主题/幂等记录各一；主题数据库测试25条通过，格式与Clippy通过。证据：artifacts/v3/dyr030-2026-10-04/quota-per-user-window-verification.json。

历史候选核验（本地时间2026-10-05）：在现存 .daoyun-postgres-55433 中识别到8月15日检查点的实际开发库。原目录未启动，1654个文件完整复制到private隔离副本并逐项核对，原文件字节检查后仍全部相同。候选包含7账户、7组成员、7角色授予，但积分/经验流水、标准权益授予为空，尚无草稿表。52条迁移中50条匹配当前与V2 HEAD，202608150010/12两条校验不匹配。再次复制数据库后使用已验证SHA的release基础产物启动，真实拒绝Migration(VersionMismatch(202608150010))，API未监听，72表1531行及52条迁移记录保持一致；没有重写校验或绕过迁移检查。该候选不是10月2日DYR-001 V2基线，不能闭合历史升级或旧产物回退。证据：artifacts/v3/dyr030-2026-10-04/legacy-migration-rejection-verification.json；原始数据副本和配置均在private，检查进程已停止。

历史源码恢复进展（本地时间2026-10-05）：此前静态写入/读取候选未匹配原始哈希；继续扫描1108个未引用Git文件对象后，八个此前缺失文件以原始字节恢复，均复核Git对象SHA-1及清单SHA256。包含TopicComposer、DraftShelf、CommunityApp、认证接口及其测试、附件测试与主题持久层。现已固定24/28个原V2保护文件，剩余styles.css、App.test.tsx与草稿冲突/账号标签页两个E2E文件未找到。全部3954个Git文件对象已读取核对（六个大对象为非UTF8的旧测试库日志段），编辑器历史与有限静态反向差异检索也未补齐四文件。另静态读取历史测试库控制元数据，检查点8月14日；未恢复完整簇、未启动数据库或确认快照一致性。所有候选保存在private，当前产品源码未覆盖。该保护子集不是原695文件完整快照，旧API产物与匹配V2的历史数据库仍缺失，八项验收状态不变。证据：artifacts/v3/dyr030-2026-10-04/unreferenced-v2-source-recovery-verification.json；artifacts/v3/dyr030-2026-10-04/recovered-v2-protected-source-manifest.json。

## 当前未闭合范围（2026-10-05修正）

- AC-029-01/03：当前测量通过，历史性能前后比较与冷OS采样未执行。
- AC-X-20：实际软键盘展开未执行。
- AC-X-27：源站策略通过，实际CDN边缘范围未执行。
- 实际旧V2二进制回退未执行；当前恢复/RPO用例已通过，不作为该用例附加前置。

草稿旧新格式、非空旧结构迁移不变量、当前Wasm执行器交接已用直接行为测试验收，不再等待完整历史基线。详细状态及范围见最新直接审计记录；最终发布门禁仍未接受。

## 证据与续跑

- 回归与失败修正：artifacts/v3/dyr028-2026-10-04/，保留 red/green、CSRF及原失败日志。
- 候选测量：artifacts/v3/dyr029-2026-10-04/candidate-release-summary.json、release-build-matrix.json、candidate-api-release-matrix.json、candidate-browser-home.json、candidate-sql-calls.json。HAR与SQL原日志包含会话或参数，置于private，不提交。
- 冻结/恢复：artifacts/v3/dyr030-2026-10-04/verification.json、browser-unique-pass-manifest.json、backup-manifest.json、pre-start-restore-verification.json、registration-code-restored-verification.json、finance-restored-verification.json、restore-api-verification.json、provider-switch-verification.json、restored-growth-replay.json、post-backup-delta.json。
- 测试仅使用127.0.0.1专用PG15438与独立DB、API3003/3004/3005、浏览器4176、协议服务19039/19040/19041。完成检查点后按所属PID停止服务，关闭结果以service-shutdown.json为准；不删除数据库或恢复材料。
- 下一步按最新直接审计记录处理实际发布环境与单列历史结论；不再恢复完整历史基线以阻挡当前测试，仍不得自动提交或部署。
