# Clash Verge Rev v2.5.7 节点删除定制版

目标：Windows 11 x64。基于官方仓库 v2.5.7 标签，提交 ea509b82363a40c3c32e951d7ce9d66d66da411f。
上游：https://github.com/clash-verge-rev/clash-verge-rev/tree/v2.5.7
许可证：GPL-3.0-only；完整源码包保留上游 LICENSE。

## 使用

在代理组页面点“删除节点”进入选择模式；也可点某个代理组的垃圾桶按钮，仅在该组内选择。

- 单击节点：选择一个。
- Ctrl + 单击：增选或取消该节点；勾选框同样支持多选。
- Shift + 单击：按界面当前排序连续选择。
- Delete 或“删除所选”：删除选中的节点。
- Ctrl + A 或“全选”：选择当前操作范围的全部真实节点。
- “删除全部节点”或“删除本组全部节点”：确认后批量删除。
- Esc 或“完成”：退出选择模式。
- “恢复已删节点”：恢复当前订阅记录的全部删除项。

选择模式中单击节点不会切换代理。DIRECT、REJECT 等内置策略和代理组不能删除。

## 删除与恢复的含义

删除由 Rust 后端执行，校验新配置后重新加载代理内核，并持久保存在当前订阅的 option.deleted_nodes / deleted_providers 中。
原始订阅文件保留，以便恢复。删除会作用于当前订阅各组中的同名节点，订阅更新、内核重载后仍然有效。
节点按名字识别：订阅端改名的节点会作为新节点出现。全部删除的 provider 将停用，直到点击恢复。
被删除节点的规则目标、拨号代理和空组兜底引用会修复；空组默认直连。自定义兜底策略按配置保留。

## 代码

这是原有 Rust + Tauri + React 架构：删除、持久配置、配置校验与内核重载使用 Rust；节点勾选和快捷键沿用 React/TypeScript 前端。

主要 Rust 文件：
- src-tauri/src/enhance/node_delete.rs
- src-tauri/src/cmd/proxy.rs
- src-tauri/src/config/prfitem.rs

主要前端文件：
- src/components/proxy/node-deletion-context.tsx
- src/components/proxy/use-node-deletion.tsx
- src/components/proxy/node-selection-model.ts

## 安装包构建方式

提供的安装包使用 x86_64-pc-windows-gnu 工具链交叉编译，release 优化，LTO 关闭。WebView2Loader.dll 已加入安装包。
内核与服务由上游 prebuild 脚本准备；稳定内核为 Mihomo v1.19.32，服务为 v2.7.6。
Windows 本机脚本使用 MSVC 工具链构建同一份功能源码。

## Windows 本机重新编译

安装 Rust、Node/pnpm，以及 Visual Studio 的“使用 C++ 的桌面开发”（含 MSVC 与 Windows SDK）。详细环境要求见上游 CONTRIBUTING.md。
在解压后的源码目录打开 PowerShell，运行：

```powershell
.\BUILD_WINDOWS_X64.ps1
```

脚本使用 Windows MSVC x64 工具链，先运行官方 prebuild 准备内核与资源，再生成未签名 NSIS 安装包。

## 已完成的验证

- 前端 TypeScript 检查、改动文件 ESLint 检查、生产构建通过。
- 前端测试：7 个测试文件，29 项测试通过。
- Rust 删除模块：4 项单元测试通过；Windows GNU 目标完整 cargo check / Clippy 通过。
- 真实 Mihomo 内核：当前节点删除、全部普通节点删除、带前缀与特殊字符 provider 节点、HTTP provider 刷新、全部 provider 节点删除、include-all 空组、不同 provider 的前缀名称碰撞及恢复均通过。
- 浏览器组件交互：单选、Ctrl 多选、Shift 连选、Delete、焦点在复选框时 Delete、Ctrl+A、Esc、恢复、失败保留、全部删除确认通过。

本次验证未包含 Windows 11 真机安装、TUN 驱动或实际订阅节点联网。定制安装包未使用官方签名；安装前请备份现有配置。
官方升级会覆盖定制程序，需要保留此源码包以便重新构建。
