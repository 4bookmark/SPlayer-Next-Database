# SPlayer-Next-Database

SPlayer-Next-Database 是 [SPlayer-Dev/SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 的个人 Fork，保留上游历史与 AGPL-3.0 许可证。2026-11-21 存档以应用版本 1.2.1 为基础，记录 macOS 与媒体源整理功能的定制源码

## 当前功能

- 本地与已同步媒体源共用音乐库、艺术家、专辑浏览；支持全部、本地及指定媒体源筛选
- 音乐库提供歌曲列表与按专辑聚合的封面视图，保存视图偏好
- 音乐库、专辑页与媒体源复用同一专辑整理组件，支持自动分类、自定义分类与手动指定
- 艺术家入口与媒体源复用分类、多选、指定保留目标合并、撤销合并逻辑
- 歌曲喜欢与媒体服务器同步，并汇总到“我喜欢的音乐”；媒体源歌曲可加入 SPlayer 本地歌单，保留播放引用
- 专辑与歌手提供本地持久收藏，按服务器隔离
- 统计概览与实际播放排行包含媒体源，资源按服务器及账号代次隔离
- macOS 使用左上角原生窗口按钮；局域网输出包含 UPnP / Sonos 和 Chromecast 发现及控制
- 专辑封面选择通过 HTTP 读取，客户端不再依赖 Mac SMB 挂载

媒体源支持沿用上游 Subsonic / OpenSubsonic 家族以及 Jellyfin / Emby 适配层。实际现场验收使用 Gonic，其余通过共用接口及回归测试覆盖

## 功能边界

- 浏览使用最近同步的媒体源快照；首次使用需要配置服务器并完成同步
- 多来源汇总保留各自的整理结果，筛选到单个媒体源可编辑分类或合并，不跨服务器合并身份
- 专辑、歌手收藏及整理规则保存在 SPlayer 本地，不写 NAS 音乐文件；歌曲红心沿用服务端接口
- 播放统计基于 SPlayer 实际收听记录，不导入其他播放器的播放次数
- 原版 Gonic 通常仅提供默认封面。目录中多张图片的 HTTP 枚举需要服务端扩展；可选开发资料保存在 `deploy/gonic-artwork/`，此次客户端验收未部署该扩展
- macOS 系统 AirPlay 输出可继续由系统选择，设备面板中不提供手动 AirPlay 2 指定入口
- 安装包为 Apple Silicon（arm64）本地 ad-hoc 签名构建，未经过 Apple 公证；其他平台及架构尚未针对定制功能现场验收
- 上游更新来源和应用标识保持原有配置，安装上游更新可能覆盖本定制版；需要保留本版时使用此 Fork 的源码或存档安装包

## 获取存档安装包

在 [Releases](https://github.com/4bookmark/SPlayer-Next-Database/releases) 下载 `snapshot-2026-11-21` 对应的 DMG 与 `SHA256SUMS.txt`。源代码保留在 `main`，上游原有分支和提交历史保留，可通过快照标签重现本次源码

仓库不包含个人媒体库数据库、账号、密码、服务器配置、音乐文件或本机缓存。已编译原生模块和 DMG 不提交到 Git 历史，安装包单独保存为 Release 附件

## 从源码构建

要求 Node.js >= 24、pnpm >= 12、Rust 工具链。macOS 原生辅助进程需要 Xcode Command Line Tools 与 Swift 编译器，构建对应架构的安装包

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build:mac
```

`pnpm build:mac` 会构建原生模块、Swift 辅助进程和前后端，再执行 electron-builder。未配置开发者签名身份时，可在完成 `pnpm build` 后执行本地签名打包：

```sh
pnpm exec electron-builder --config electron-builder.config.ts --mac dmg -c.mac.identity=-
```

详情与上游开发指南见根目录 README、AGENTS.md；可选 Gonic 扩展是独立服务端改动，不是客户端构建依赖

## 本次验证

- Node 测试 70 / 70 通过
- Vitest 完整套件 735 / 735 通过（97 个文件）
- 最后目录元数据与共享视图调整后，受影响的 10 项回归再次通过
- Node 与 Renderer 类型检查通过，相关 ESLint、Prettier、`git diff --check` 通过
- 生产构建、应用签名完整性检查及 DMG 校验通过
- 安装版已核对统一曲库、原有地区分类、多选合并入口、详情导航、收藏按钮、右键加入歌单和统计页面

本 Fork 的软件版权和许可证声明沿用原文件；新增改动同样遵循项目许可证

## 与上游持续合并

`main` 是本 Fork 的定制版本，`upstream` 指向官方仓库。合并官方更新时遵循 [上游更新与定制维护](UPSTREAM.md)，通过临时分支和回归测试再进入 `main`。仓库改名不修改已安装应用的名称或用户数据位置
