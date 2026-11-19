/**
 * 飞书/Lark 入站准入：先拦截 bot 回环，再按群档位与群名单裁决。
 *
 * 纯函数、无副作用；调用方只负责把 allow 的消息送进原链路，其余静默丢弃，
 * 从而保证 ignore-* 分支零回复、零模型调用、零出站。
 */

/** 准入结果；除 allow 外全部静默丢弃。 */
export type FeishuAccessDecision =
  | 'allow'
  | 'ignore-loop'
  | 'ignore-bot'
  | 'ignore-group-policy'
  | 'ignore-not-allowed'

/** 群档位：mention（默认，@ 才响应）/ off（群静默）/ allowlist（仅名单群，仍需 @）。 */
export type FeishuGroupPolicy = 'mention' | 'off' | 'allowlist'

/** 准入配置；群名单是 chat_id 精确匹配数组。 */
export interface FeishuAccessConfig {
  groupPolicy?: FeishuGroupPolicy
  groupAllowlist?: readonly string[]
  groupDenylist?: readonly string[]
  /** false（默认）时任何 bot 发送者一律 ignore-loop；true 只关闭回环拦截，仍走群档位。 */
  allowBotSender?: boolean
}

/** evaluateAccess 的输入。 */
export interface FeishuAccessInput {
  /** 飞书事件的 sender_type：'app' 表示 bot，'user' 表示真人。 */
  senderIdType?: string
  senderOpenId?: string
  chatId: string
  /** 群聊标记；缺省时用 chatType 推断，两者都缺省按群聊处理。 */
  isGroup?: boolean
  chatType?: string
  isBotMentioned: boolean
  config: FeishuAccessConfig
}

/** 拆分手工群名单：逗号/中文逗号/空白/分号分隔，去重保序。 */
export function parseFeishuChatList(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const result: string[] = []
  for (const item of raw.split(/[\s,，;；]+/)) {
    const id = item.trim()
    if (id && !result.includes(id)) result.push(id)
  }
  return result
}

/**
 * 解析出站 @ 注入映射：条目形如「名称=open_id」，逗号/中文逗号/空白/分号/换行分隔；
 * 同名条目后者覆盖前者。非法条目（缺 = 或两侧为空）直接跳过，不影响其余条目。
 */
export function parseMentionAliasList(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {}
  const result: Record<string, string> = {}
  for (const item of raw.split(/[\s,，;；]+/)) {
    const idx = item.indexOf('=')
    if (idx <= 0) continue
    const name = item.slice(0, idx).trim()
    const id = item.slice(idx + 1).trim()
    if (name && id) result[name] = id
  }
  return result
}

/** 把渠道配置（字符串键值）归一成准入配置；非法档位回退 mention。 */
export function resolveFeishuAccessConfig(raw: {
  groupPolicy?: unknown
  groupAllowlist?: unknown
  groupDenylist?: unknown
  allowBotSender?: unknown
}): { groupPolicy: FeishuGroupPolicy; groupAllowlist: string[]; groupDenylist: string[]; allowBotSender: boolean } {
  return {
    groupPolicy: raw.groupPolicy === 'off' || raw.groupPolicy === 'allowlist' ? raw.groupPolicy : 'mention',
    groupAllowlist: parseFeishuChatList(raw.groupAllowlist),
    groupDenylist: parseFeishuChatList(raw.groupDenylist),
    allowBotSender: raw.allowBotSender === true || raw.allowBotSender === 'true',
  }
}

/**
 * 裁决一条入站消息是否进入 agent。
 * 规则短路顺序：bot 回环 > 私聊跳过 > denylist > 档位（off/allowlist）> @ 要求。
 * @param input - 发送者、会话与配置。
 * @returns allow 或具体的 ignore 原因。
 */
export function evaluateAccess(input: FeishuAccessInput): FeishuAccessDecision {
  // F2 最高优先：任何 bot 发送者默认拒绝，哪怕被 @；allowBotSender 只关闭这一层。
  if (input.senderIdType === 'app' || input.senderIdType === 'bot') {
    if (input.config.allowBotSender !== true) {
      return input.senderIdType === 'app' ? 'ignore-loop' : 'ignore-bot'
    }
  }

  const group = input.isGroup
    ?? (input.chatType !== undefined ? input.chatType === 'group' : true)
  // F3 只约束群聊；私聊继续走既有 engine.access 白名单逻辑。
  if (!group) return 'allow'

  const chatId = String(input.chatId)
  const deny = input.config.groupDenylist ?? []
  if (deny.some((item) => item.trim() === chatId)) return 'ignore-not-allowed'

  const policy = input.config.groupPolicy ?? 'mention'
  if (policy === 'off') return 'ignore-group-policy'
  if (policy === 'allowlist') {
    const allow = input.config.groupAllowlist ?? []
    if (!allow.some((item) => item.trim() === chatId)) return 'ignore-not-allowed'
  }
  if (!input.isBotMentioned) return 'ignore-group-policy'
  return 'allow'
}

/** 拒绝后的用户可见反馈类型；none 表示保持静默。 */
export type FeishuAccessNotice = 'none' | 'group-disabled'

/** 从群/私聊判定中取群聊标记，与 evaluateAccess 保持同一口径。 */
function isGroupInput(input: FeishuAccessInput): boolean {
  return input.isGroup ?? (input.chatType !== undefined ? input.chatType === 'group' : true)
}

/**
 * 按 M3 判定结果给分级反馈：
 * - ignore-loop / ignore-bot：永远静默（回复即回环）；
 * - 私聊：不新增提示，保留既有 engine 引导文案；
 * - denylist 群：静默（有意屏蔽，不打扰）；
 * - groupPolicy=off 或 allowlist 名单外且被 @：提示「本群未启用该服务」；
 * - 仅未 @ 的群消息：静默（避免刷屏）。
 * @param input - 与 evaluateAccess 相同的输入。
 * @param decision - evaluateAccess 的返回值。
 * @returns 需要发送的提示类型。
 */
export function accessNotice(input: FeishuAccessInput, decision: FeishuAccessDecision): FeishuAccessNotice {
  if (decision === 'ignore-loop' || decision === 'ignore-bot') return 'none'
  if (!isGroupInput(input)) return 'none'
  if (!input.isBotMentioned) return 'none'
  const chatId = String(input.chatId)
  const denied = (input.config.groupDenylist ?? []).some((item) => item.trim() === chatId)
  if (denied) return 'none'
  if (decision === 'ignore-not-allowed') return 'group-disabled'
  if (decision === 'ignore-group-policy' && input.config.groupPolicy === 'off') return 'group-disabled'
  return 'none'
}
