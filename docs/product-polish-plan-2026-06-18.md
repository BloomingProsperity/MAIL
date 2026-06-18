# Email Hub Product Polish Plan

Date: 2026-06-18

This document records the current product decisions for the technical internal
test milestone. Implementation should proceed in small reviewed slices. Before
changing a workflow or hiding an existing surface, ask the user to confirm the
specific behavior unless it is already listed here.

## Fixed Product Decisions

- Left navigation order: 邮箱, 添加邮箱, 搜索, Hermes, 配置域名, 设置.
- Search is a top-bar experience. Do not put mailbox search controls in the
  left sidebar.
- Mail folders should align with Outlook-like folder expectations. Do not keep
  Smart Inbox or 今日优先 as fixed mailbox folders.
- There is no standalone 待办 workspace. Follow-up work is represented on mail
  through Outlook-style flags, reminders, reply-needed state, and message
  filters.
- New compose follows Outlook-style floating compose and must not push the
  three-column mailbox down. The floating window should have a polished
  scale/transition effect.
- Reply and forward can open as editable modules inside the right reading pane.
- Mobile is browser responsive Email Hub, not a separate mobile app. Domain/IP
  browser access should keep the full core experience.
- Hermes is the only AI entry. The ordinary Hermes page shows only editable
  assistant name, LLM provider, API key, and test connection.
- Hermes provider defaults should include mainstream providers, NVIDIA, and a
  custom/OpenAI-compatible provider.
- Hermes internals such as skills, rules, memories, audit logs, resource
  budgets, and system prompts are system-owned and hidden from ordinary UI.
- Settings may include an administrator section. It does not require a second
  password, but it should be grouped/collapsed instead of shown as a wall of
  system controls.
- Domain setup is a first-class left-navigation area named 配置域名.
- Domain setup supports manual DNS instructions, DNS verification, and
  Cloudflare-assisted setup.
- CSV bulk import is for enterprise/domain/app-password/authorization-code/
  bridge style accounts. Gmail and Outlook bulk import can only create
  per-account official authorization tasks.
- Native/Core self-developed work must be isolated from the EmailEngine-first
  production path and must not appear in the launch UI or deployment path.
- Internal testing should cover all supported onboarding paths when the product
  reaches that stage; the user will be asked for the needed provider/domain
  credentials and DNS access at that time.

## Implementation Slices

1. Native/Core isolation audit and production-path cleanup.
   - Confirm which compatibility database fields remain as neutral provider
     metadata.
   - Move or isolate self-developed Native/Core code outside the default launch
     build path.
   - Keep EmailEngine-first Docker free of Native runtime toggles and UI labels.

2. Frontend information architecture.
   - Update left navigation order and labels.
   - Remove standalone 待办 from navigation and pages.
   - Move search to top-bar primary interaction.
   - Align mailbox second column to Outlook-like folders.

3. Compose and reply experience.
   - Keep new compose as floating window with scale transition.
   - Add or preserve right-pane reply/forward editor behavior.
   - Ensure the three-column mailbox does not shift vertically.

4. Hermes ordinary page simplification.
   - Keep only assistant display name, provider, API key, and test connection.
   - Hide rule/memory/skill/audit/resource controls from ordinary UI.
   - Keep backend-owned Hermes capabilities wired internally.

5. Add mailbox polish.
   - Gmail and Outlook use official login only.
   - iCloud uses app-specific password.
   - 163/QQ use authorization code wording.
   - Proton uses Bridge setup.
   - Enterprise/domain mail uses IMAP/SMTP username and password/app password.

6. Domain setup and Cloudflare.
   - Build a clean 配置域名 workspace.
   - Support manual DNS record copy and automatic DNS verification.
   - Add Cloudflare-assisted setup with explicit token permission guidance.

7. Administrator settings cleanup.
   - Keep ordinary settings simple.
   - Group system status, data maintenance, logs, and advanced configuration in
     collapsed administrator sections.

8. Verification rhythm.
   - Use focused tests for each slice.
   - Run file-size guard after moving or adding handwritten files.
   - Run build and broader gates only after several related slices or when a
     shared boundary changes.
   - Run Docker/EmailEngine verification before asking for full internal test.

