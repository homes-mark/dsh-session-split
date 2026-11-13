# 会话分屏

在 DeepSeek Harness 左侧会话列表中，把任意对话打开到右侧，并继续原来的任务。

## 安装

1. 下载或克隆本仓库：`git clone https://github.com/homes-mark/dsh-session-split.git`
2. 在 DSH 中打开 **Plugins → Add plugin**。
3. 选择本仓库目录，安装并启用 **“会话分屏”**。

本仓库提供源码，安装到当前 DSH profile 后生效；不需要额外构建，也不需要配置模型或工作区。

## 使用

1. 在左侧会话列表中右键一个对话。
2. 选择 **“在右侧打开”**。
3. 右侧会出现该会话的完整原生对话界面，左侧仍保持打开前的当前对话。

右侧与左侧使用同一个 Session 身份：历史消息、工作目录、模型选择、运行状态、草稿、工具过程、附件和审批都由 Harness 的原生会话系统提供。插件不会 fork 或新建会话，不会修改模型，也不会自动发送续跑指令。

如果原会话仍在运行，右侧会直接同步当前进度；之后可以通过原生输入框手动发送、排队或停止。右栏的宽度调整、分屏、浮动和全屏操作与其他原生页签一致。

## 实现

右键操作通过 `openTab` 的 `params.targetSessionId` 传递原 Session ID。右侧页签直接 `sessions.retain` 保留该会话，并通过插件独有的 session 级子 Slot 获得 `SessionProvider`，再由官方 `conversation.content` Factory 渲染完整原生界面。消息显示和会话操作没有自定义替代实现。

## 许可证

[MIT](./LICENSE)
