# 健身打卡 · 部署站点

这是**发布目录** —— 里面的文件会原样发布到 GitHub Pages。

**线上地址：<https://hanhaicangnan99.github.io/fitness/>**

## 这个仓库是什么

一个可以装到安卓桌面、断网也能用的健身打卡 App。训练计划是五分化（胸 / 背 / 肩 / 腿 / 手臂），
动作取自谭成义体系；饮食按五班三倒的班次排。

**源码不在这个仓库里**，它在本地 `H:\健身\`：

```
H:\健身\
├─ app/                 ← 这个仓库（发布目录）
├─ tools/               构建、测试、部署脚本
├─ dist/                单文件离线版
└─ README-部署到手机.md   完整说明
```

改了东西之后，在 `app/` 里跑：

```bash
node ../tools/publish.mjs "这次改了什么"
```

它会先跑全套检查（构建 + 数据层 + 渲染 + 真浏览器），全过了才提交并推送。

## 目录说明

| 路径 | 是什么 |
| --- | --- |
| `index.html` | 入口 |
| `assets/` | 样式、计划数据、各页面模块 |
| `icons/` | 桌面图标（PWA 安装用） |
| `manifest.webmanifest` | PWA 清单 |
| `sw.js` | Service Worker（离线缓存，版本号按内容哈希自动生成） |
| `.nojekyll` | 告诉 GitHub Pages 别用 Jekyll 处理 |
