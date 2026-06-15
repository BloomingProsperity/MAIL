# Email Hub 前端 UI 计划

> 标注：前端 UI。本文只沉淀界面方向、页面拆解和验收标准，不替代后端实施计划。

## 当前基线

前端回滚到用户指定的第一版浅色三栏工作台：

- 左侧为全局功能栏：邮箱、添加邮箱、待办、搜索、Hermes、设置。
- 第二栏为邮箱目录：收件箱、今日优先、星标、稍后提醒、草稿、已发送、归档、垃圾邮件、已删除、所有邮件、附件、标签/项目。
- 中间为邮件列表：Smart Inbox 先分桶再评分，显示原因 chips。
- 右侧为邮件阅读区：工具栏、邮件正文、为什么排前面、附件、回复草稿。
- 底部为第一版 Hermes 长条输入，不采用短小自动隐藏版本。

参考截图文件：

- `emailhub-desktop.png`
- `email-hub-ui-desktop-1440.png`

## 视觉规则

颜色使用用户确认过的浅薄荷灰 + 低饱和珊瑚红 + 中性灰白：

```css
:root {
  --bg-app: #f7faf8;
  --bg-sidebar: #eef7f4;
  --bg-panel: #ffffff;
  --bg-soft: #f9faf8;
  --border-light: #e5e9e5;
  --border-soft: #eef0ec;
  --text-main: #1f2933;
  --text-secondary: #6b7280;
  --text-muted: #9aa3a0;
  --primary: #d96b5f;
  --primary-hover: #c95a4e;
  --primary-soft: #fbedea;
  --primary-border: #f3c7bf;
  --mint-bg: #eaf5f1;
  --mint-soft: #f3faf7;
  --mint-text: #506b63;
  --blue-soft: #eaf1fc;
  --blue: #5f7fcb;
  --green-soft: #e9f6ec;
  --green: #48a868;
  --yellow-soft: #fff3d8;
  --yellow: #d99a22;
  --purple-soft: #f0eafb;
  --purple: #8a6ed3;
}
```

明确禁止：

- 不用深绿色主导。
- 不用蓝紫 AI 渐变。
- 不用苹果式毛玻璃大卡片风格。
- 不做重复侧栏：左侧不出现邮箱文件夹，邮箱文件夹只在第二栏。
- 不把 Hermes 做成大聊天页。

## 页面清单

P0 必须先完整设计：

- 邮箱主工作台
- 添加邮箱
- Gmail / Outlook OAuth 队列
- 163 / QQ 授权码引导
- Proton Bridge 连接
- iCloud 邮箱：Apple app-specific password 引导
- 个人域名邮箱：通用 IMAP/SMTP 手动配置
- 同步中心
- 搜索页
- 写邮件 / 回复页
- 待办页
- 批量导入
- 账号转移
- 设置页
- 移动端单任务栈

## Hermes 前端定位

当前基线保留第一版底部长条 Hermes：

- 默认在每个页面底部可见。
- 输入框用于搜索邮件、写回复、整理收件箱。
- 快捷按钮：搜索邮件、写回复、整理收件箱。
- 写操作必须进入预览，不直接发送。
- Hermes 设置、memory、skills 管理放在 Hermes 页面或设置页，不挤占收件箱主界面。

后续如果重新讨论短小隐藏版，必须作为独立分支或独立设计稿，不覆盖当前第一版基线。

## 滚动规则

- 桌面端：整屏铺满，左侧全局栏固定。
- 邮箱主工作台：第二栏目录、邮件列表、阅读区各自可滚动。
- 非邮箱页面：主区域整体可滚动。
- 底部 Hermes 不应遮挡关键按钮，阅读区和列表底部要留出安全间距。
- 1440 桌面和 390 移动端不能出现横向溢出、文字重叠。

## Smart Inbox 展示规则

排序不能只显示 AI 结论，必须显示原因：

- 直接发给你
- 你常回复此发件人
- VIP / 客户规则
- 今天 17:00 截止
- Hermes 识别为需要回复
- 来自项目标签
- newsletter / bulk sender 扣分

页面上只展示 3-7 个主分类，避免信息过载。

## 验收标准

- 左侧全局栏只放全局功能。
- 第二栏完整包含邮箱目录和标签/项目。
- 底部 Hermes 是第一版长条输入，不是短小自动隐藏形态。
- 邮件列表点击后阅读区同步切换。
- 邮件阅读区显示“为什么排前面”。
- 页面能铺满桌面宽度。
- 主要内容区可以上下滚动。
- 颜色符合浅薄荷灰、低饱和珊瑚红、中性灰白。
- 通过 `npm test` 和 `npm run build`。
