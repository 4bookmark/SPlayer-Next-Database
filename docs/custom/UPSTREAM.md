# 上游更新与定制维护

## 分支与来源

- 本仓库：`4bookmark/SPlayer-Next-Database`
- `main`：定制版默认分支，保留可运行的功能与修复
- 官方上游：`SPlayer-Dev/SPlayer-Next`，开发分支 `dev`
- 初始定制基础：`6b26b685`，完整提交身份见 `git show snapshot-2026-11-21^`
- 初始存档标签：`snapshot-2026-11-21`

这是保留共同 Git 历史的 Fork，可以持续接收上游功能。后续更新先合并到临时分支，通过测试后再进入主分支；不要把官方 `dev` 强制覆盖到定制版 `main`

## 本地远程配置

当前工作副本使用 `origin` 指向自己的仓库，`upstream` 指向官方。在新机器上：

```sh
git clone https://github.com/4bookmark/SPlayer-Next-Database.git
cd SPlayer-Next-Database
git remote add upstream https://github.com/SPlayer-Dev/SPlayer-Next.git
git fetch upstream
```

## 一次官方更新的流程

先提交或妥善保存工作区修改，然后：

```sh
git switch main
git pull --ff-only origin main
git fetch upstream
git log --oneline main..upstream/dev
git switch -c update/upstream-YYYY-MM-DD
git merge --no-commit --no-ff upstream/dev
```

把分支名中的日期换成本次更新日期。合并完成前检查冲突和自动合并结果；优先保留上游公共实现，将本 Fork 的增量重新接入公共接口。未完成的合并可以 `git merge --abort` 返回合并前状态，不需要改写主分支历史

解决冲突后运行验证：

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build:mac
```

另对本次涉及的源文件运行 ESLint 和 Prettier。人工检查下面的核心流程，再提交并推送更新分支：

```sh
git add <本次确认的文件>
git commit -m "merge: 合并上游功能并保留媒体库定制"
git push -u origin HEAD
```

在自己的 Fork 内创建以 `main` 为目标的 PR，通过检查后合并。测试失败、发现兼容问题或冲突无法确认时，将工作保留在更新分支，继续使用已有主分支或快照安装包

上游 `dev` 可能含尚未发布的功能；希望跟随正式发布时，可以把 `upstream/dev` 换成已经检查过的具体上游版本标签。每次记录更新采用的实际修订和验证结果

## 主要维护自己的增量

优先将新增行为保留在共用模块中，页面只负责接入。维护时以本次存档及后续定制提交为参考：

| 定制区域           | 主要文件                                                                                                                                                           | 上游变化后核对                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 统一曲库和来源隔离 | `src/composables/useUnifiedLibrary.ts`、`src/components/list/UnifiedCatalogView.vue`、`src/utils/unifiedLibrary.ts`、`electron/main/services/streaming/library.ts` | 非激活服务器、身份切换、同步完成、移除来源          |
| 歌手合并与分类     | `shared/utils/artistGroups.ts`、`electron/main/services/streaming/organization.ts`、`src/components/artist/ArtistOrganization.vue`                                 | 分类持久化、合并目标与撤销、路由原始 ID             |
| 专辑分类与时间线   | `shared/utils/albumCategories.ts`、`src/components/artist/AlbumOrganization.vue`、`src/components/list/GroupedCoverList.vue`                                       | 目录关键词、数量规则、自定义分类、年份排序          |
| 喜欢与收藏         | `src/stores/streaming.ts`、`src/pages/Liked.vue`、`src/pages/Favorites.vue`、`electron/main/database/playlists.ts`                                                 | 服务端红心权威、混合歌单引用、并发响应、跨来源收藏  |
| HTTP 封面          | `electron/main/services/streaming/artwork.ts`、`src/components/collection/AlbumArtworkGallery.vue`                                                                 | 原版服务端默认封面、扩展能力探测、主封面一致性      |
| 设备发现与投放     | `electron/main/services/output/`、`native/lan-discovery/`、`src/components/player/PlaybackDevices.vue`                                                             | 普通安装版的 LAN 访问、Sonos 分组协调器、Chromecast |
| 统计               | `electron/main/services/libraryStats.ts`、`electron/main/database/playStats.ts`                                                                                    | 全来源总数、实际播放、服务器和账号代次隔离          |
| macOS 窗口         | `electron/main/window/main.ts`、`src/components/layout/`、`src/composables/useWindowControls.ts`                                                                   | 原生窗口按钮、UI 缩放、折叠侧栏和播放器             |

接入页面、IPC、preload、类型和语言文件也属于定制的一部分。不要只复制某个组件而遗漏这些入口；新增功能应提供自己的回归测试，减少每次合并的人工验证范围

GitHub 的 Fork 关系会保留上游关联，但不会自动替你解决代码冲突，也不会保证未来每个版本均无改动可合并。此存档不启用自动覆盖、自动合并或定时发布

## 发布定制版时

当前 `package.json`、electron-builder 和部分更新链接沿用上游配置。存档附件是此次已验收安装包，仓库名称与应用名称不同是有意保留用户数据兼容性。未来建立自己的自动更新和发布通道时，先将发布目标、更新源与版本规则统一改为本 Fork，避免自动更新安装回官方版本

原上游 CI 与发布工作流也保留在源码中。GitHub 对新 Fork 的 Actions 默认限制与上游不同；此存档不假设工作流已启用或已在 GitHub 构建成功。开启自动发布前需核对目标仓库、版本标签、签名和所需 Secrets
