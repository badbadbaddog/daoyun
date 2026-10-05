# DYR-005 摘要口径与待办精确定位

状态：DONE。G1 仍待 DYR-006，整体持续执行，未提交、未部署。

## 最终行为

- 首页移除“我的发布 / 收到回复 / 获得喜欢”。它们原先仅汇总当前 feed，不能代表本人全局总数。成长 EXP 保留既有服务端来源。
- 举报、账号摘要继续复用权限受控的列表接口，按状态请求 limit=5。显示实际返回条数；有 next_cursor 时显示 N+，真实满页为 5+；明确“按状态汇总，每类最多展示 5 条”。失败显示“暂不可用”，独立重试，不以 0 冒充失败。隐藏版块数来自完整的非删除版块列表。
- 工作台具体待办分别带 user_id / board_id / report_id。用户详情直接按 ID 获取，不要求出现在当前分页；版块按完整管理列表定位；举报详情与列表分页分别加载。对象 ID 验证 UUID，旧管理路径与查询仍可解析。
- 打开、关闭详情保留原查询参数和列表实例，避免清空已加载分页。详情关闭清除对象 ID；列表滚动由 list_scroll 恢复，既有抽屉保留焦点与 body 滚动锁。工作台待办带 return_to=dashboard 和 return_scroll，返回工作台在摘要加载完毕后恢复来源位置。
- 版块搜索同步 q；保存版块和访问策略成功后清除 board_id。只读直接链接允许查看，但字段禁用、无保存按钮，保存处理器也校验 canWrite。
- 用户详情主请求使用 AbortController；状态、角色和资料回调按对象 ID 校验，旧用户动作不能串写新用户详情。版块访问策略旧请求会取消并忽略；同对象 URL 同步不重置正在编辑的分区。举报 URL 同步不会重复读取已打开的对象。

## 验证

- 885 个前端测试、103 个测试文件通过。应用类型、浏览器测试类型和生产构建通过。
- 增加 15 个行为测试。先记录失败再实现：局部个人统计、对象 ID 直达、返回筛选、只读边界、工作台来源，以及独立审查发现的竞态与 URL 同步问题。非法测试参数及错误菜单文案不算行为 RED。
- 最终真实浏览器 10 PASS / 0 FAIL / 0 SKIP：本项 4 例与通知兼容 6 例，桌面和移动均执行。验证指定用户 / 版块、刷新后的详情、关闭后筛选、工作台滚动、接口失败不显示 0。60 张截图覆盖 320 / 390 / 768 / 1024 / 1440，0 页面异常、0 横向溢出。
- 主代理实看 320px 用户详情、1440px 版块详情、320px 摘要错误状态。七分区导航与统一设计 token 仍属于 DYR-007。
- OpenAPI 与 DYR-004 字节一致，SHA256 b0f3cb57832c6810b9b1dc2ae4e5f208d312bbab4b18ac2e0a80c3f83e5e4526，仍有 x-request-id。本项无 Rust / 公共 DTO 修改，沿用 DYR-004 的 461 PASS、2 ignored、fmt / clippy 证据，未重复运行 Rust。
- 独立审查首探因 Windows CET 无法使用终端，未视为成功；第二探通过 Node 只读完成。其四项问题均有对应修正；另补同版块分区同步失败测试。

## 证据与保留的失败

- artifacts/v3/dyr005-2026-10-03/verification.json、source-manifest.json、source-snapshot/、tracked-source.patch、protected-original-files.json。
- 跟踪源码补丁 SHA256 d5015787948ed19823e6f02f4652ca6eeaf9f051bdb43d0fbb470abf201009ff。14 文件完整快照另含新增 adminQuery 和 E2E，补丁不代替新增文件快照。
- 最终日志：artifacts/v3/baseline-2026-10-02/logs/dyr005-final-frontend-all.log、dyr005-final-typecheck.log、dyr005-reviewed-build.log、dyr005-reviewed-e2e-typecheck.log、dyr005-reviewed-live-browser.log。
- 最终浏览器结果：browser-reviewed-results.json；browser-reviewed/ 下截图和 summary-evidence.json。summary-fixtures.json 仅存本项隔离用户 / 版块 ID 与测试名称，无密码、会话或 CSRF。
- 保留首轮浏览器失败：测试写死旧管理员昵称，修正为实际登录状态并再次通过。保留类型检查失败及增加 AbortSignal 后旧断言失败，不替换最终证据、不记为产品行为 RED。
- 原有 29 项文件核对：22 项字节未变，7 项属于已记录 V3 续写，无额外变更。V2 交接原文保留。

## 边界与回退

后台 SMTP / 品牌 / 版块配置的区域加载和错误隔离属于下一项 DYR-006；本项未新建全局统计 API。更广的治理筛选、批量处置和内容上下文属于 DYR-017。必要回退可撤回链接适配并保留旧链接解析，不能恢复虚假的个人总数。生产发布须按后续门禁执行。
