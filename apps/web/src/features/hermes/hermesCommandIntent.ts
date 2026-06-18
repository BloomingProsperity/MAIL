export type HermesReaderCommandAction =
  | "summarize_message"
  | "translate_message"
  | "draft_reply";

export type HermesCommandIntent =
  | { kind: "reader"; action: HermesReaderCommandAction }
  | { kind: "rule" }
  | { kind: "search" };

export function detectHermesCommandIntent(value: string): HermesCommandIntent {
  const command = value.trim();
  if (!command) {
    return { kind: "search" };
  }

  if (isHermesSearchCommand(command) && !isHermesAutomationCommand(command)) {
    return { kind: "search" };
  }

  if (isHermesAutomationCommand(command)) {
    return { kind: "rule" };
  }

  const readerAction = detectReaderCommandAction(command);
  if (readerAction) {
    return { kind: "reader", action: readerAction };
  }

  return { kind: "search" };
}

export function hermesReaderCommandNotice(
  action: HermesReaderCommandAction,
): string {
  if (action === "summarize_message") {
    return "Hermes 正在总结当前邮件...";
  }
  if (action === "translate_message") {
    return "Hermes 正在翻译当前邮件...";
  }

  return "Hermes 正在准备当前邮件的回复草稿...";
}

export function isHermesSearchCommand(value: string): boolean {
  return /搜索|查找|查询|寻找|找一下|找出|找找|搜一下|有哪些|哪些|有没有|在哪里|在哪|search|find|show|list|filter/i.test(
    value,
  );
}

export function isHermesAutomationCommand(value: string): boolean {
  return (
    /(?:create|add|set up|setup|make|build|enable).*(?:rule|filter|label|folder|category)/i.test(
      value,
    ) ||
    /(?:auto|automatically|always).*(?:rule|filter|label|move|categorize|classify)/i.test(
      value,
    ) ||
    /(?:创建|新增|添加|新建|设置|建立|启用|生成).*(?:规则|分组|分类|标签|filter|rule)/iu.test(
      value,
    ) ||
    /(?:自动|以后|今后|每次|总是|一律|都).*(?:规则|分组|分类|标签|归类|移动到|移到|放到|放进|归到|归入|整理到|分配到)/u.test(
      value,
    ) ||
    /(?:把|将).*(?:邮件|邮箱|收件箱).*(?:放到|放进|归到|归入|归类|移动到|移到|整理到|分配到).*(?:分组|分类|标签|左侧|文件夹)/u.test(
      value,
    ) ||
    /(?:邮件|邮箱|收件箱).*(?:加|打|应用).*(?:标签|分类|分组)/u.test(
      value,
    ) ||
    /(?:创建|新增|添加|新建|加|放到|放进|归到|归入|归类|移动到|移到|整理到|分配到|自动).*(?:邮件|邮箱|收件箱|左侧)/u.test(
      value,
    )
  );
}

function detectReaderCommandAction(
  command: string,
): HermesReaderCommandAction | undefined {
  if (
    /(?:summari[sz]e|recap|tl;?dr).*(?:email|mail|message|thread|this)/i.test(
      command,
    ) ||
    /(?:总结|概括|摘要|提炼|归纳).*(?:这封|当前|邮件|正文|线程|内容)?/u.test(
      command,
    )
  ) {
    return "summarize_message";
  }

  if (
    /(?:translate|translation).*(?:email|mail|message|thread|this|to)/i.test(
      command,
    ) ||
    /(?:翻译|译成|译为|翻成).*(?:这封|当前|邮件|正文|内容|英文|中文|英语)?/u.test(
      command,
    )
  ) {
    return "translate_message";
  }

  if (
    /(?:draft|write|compose|generate).*(?:reply|response|answer)/i.test(
      command,
    ) ||
    /(?:reply|respond).*(?:email|mail|message|thread|this)/i.test(command) ||
    /(?:回复|回信|写回信|写回复|帮我回|帮我回复|生成回复|起草回复|草拟回复)/u.test(
      command,
    )
  ) {
    return "draft_reply";
  }

  return undefined;
}
