# 数学教师成长工作台（G1 交互原型）

面向个人高中数学教师的任务型专业成长网站：围绕一个教学难点（首期专题：函数单调性），提供短训示范、判断练习、教学片段编辑与课后复盘。

**设计语言**：LightVela（逆向提取自 `design-system-extraction-2026-10/sites/07-lightvela`）——胶囊 999px 形状语言、深紫 `#211A2A` 行动色、暗橄榄 `#1C2415` 标识色、墨 `#2C2A2E`、紫调浅底 `#F7F5FA`、pinstripe 竖纹材质、blur-reveal 入场动效、IM Shell 双栏、prose 气泡。

**实现对应 PRD**：《高中数学教师成长工作台_PRD_V0.1》六项首版能力 F01–F06；里程碑 G1（交互原型），全部内容标注"草稿 · 未复核"。

## 页面

| 路由 | 内容 |
|---|---|
| `/` | 定位、主流程、样例（IM Shell 演示）、适用人群、六项能力、审核与边界 |
| `/topics/monotonicity/` | 专题页：三单元入口、训练目标、审核与版本 |
| `/learn/concept-intro/` 等 | 三个训练单元：示范讲法 / 练习（判断·改写·迁移）/ 参考分析 / 自查量规 |
| `/workspace/` | 教学片段编辑：四字段 + 自动保存 + 预览 / 打印 / Markdown / JSON 备份 / 复制新版本 |
| `/records/` | 草稿版本、练习历史、使用状态与复盘、备份导入导出、清除记录 |
| `/about/` `/privacy/` | 定位与审核说明、纠错入口；隐私与数据边界 |

## 技术

零外部依赖：纯静态 HTML/CSS/JS（无 CDN、无外部字体、无统计）；公式用 HTML sub/sup + serif 排版；数据层 `localStorage`（`mtw_store_v1`，含 `schema_version`），事件仅本地记录（task_start / practice_submit / draft_save / export_create / usage_confirm / reflection_save，无自由文本）。

## 本地预览

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## 部署

GitHub（唯一可信源）→ Netlify Production（`netlify.toml` 在根目录）。
