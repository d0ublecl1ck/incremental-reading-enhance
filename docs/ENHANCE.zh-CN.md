# 本地增强（incremental-reading-enhance）

本仓库在纯汉化版基础上增加本地功能。增强代码集中在 `main.js` 的 `// ===== ENHANCE BEGIN =====` 与 `// ===== ENHANCE END =====` 之间，命令注册集中在 `// ---- 增强：把常用菜单项提升为可绑键的命令 ----` 之后。

## 为什么需要增强

上游只把一部分动作注册成 Obsidian 命令，其余放在「当前元素操作…」菜单里。菜单项无法在「设置 → 快捷键」绑定，所以阅读点这类高频操作没有快捷键。增强把这些菜单项提升为真正的命令。

## 新增命令（8 条）

| 命令 | 行为 |
| --- | --- |
| 阅读点：设到光标 | 直接把 `📍` 阅读点设到光标所在行并写 `read_point_line`，不弹菜单 |
| 阅读点：跳转到阅读位置 | 等价于菜单里的「跳转到阅读位置」 |
| 当前元素：已完成 | 等价于菜单里的「已完成」 |
| 当前元素：搁置 | 等价于菜单里的「搁置」 |
| 当前元素：推迟 | 等价于菜单里的「推迟」 |
| 删除当前 IR 材料… | 确认后调用 `FileManager.trashFile`，按库的「删除文件」设置进回收站 |
| 移出 IR（保留笔记）… | 清掉排期字段、`ir/*` 与 `incremental-reading` 标签、`📍` 标记，再把笔记移到库根 |
| 从剪贴板新建来源（文章） | 读剪贴板文本，问标题与优先级，按 `article` 类型在来源文件夹建来源笔记，正文即剪贴板内容 |

## 数据格式不变

增强不改 frontmatter 键值、标签命名、文件夹路径、日期格式与正则，与上游笔记、与 `incremental-reading-zh` 共用同一批数据。

## 合并上游后重新套用

1. `git fetch upstream`
2. `git checkout upstream/main -- main.js`
3. `npm run i18n:remap && npm run i18n:apply`
4. 按本文件「新增命令」一节，把增强块重新插入 `main.js`（锚点一：`cmd('advanced-tools'…)` 之后；锚点二：`async toggleReadPoint() {` 之前），并在 `captureOrCreate()` 的菜单里补回 `// enhance` 标注的那一项
5. `npm run check`

## 只启用一个

`incremental-reading-enhance`、`incremental-reading-zh` 与上游英文版 id 互不相同，但会扫描同一批 `IR/` 笔记。同一时间只启用其中一个，否则同一篇笔记会被两个调度器重复处理。