/**
 * 飞书/Lark 入站准入：先拦截 bot 回环，再按群档位与群名单裁决。
 *
 * 纯函数、无副作用；调用方只负责把 allow 的消息送进原链路，其余静默丢弃，
 * 从而保证 ignore-* 分支零回复、零模型调用、零出站。
 */
/** 准入结果；除 allow 外全部静默丢弃。 */
export type FeishuAccessDecision = 'allow' | 'ignore-loop' | 'ignore-bot' | 'ignore-group-policy' | 'ignore-not-allowed';
/** 群档位：mention（默认，@ 才响应）/ off（群静默）/ allowlist（仅名单群，仍需 @）。 */
export type FeishuGroupPolicy = 'mention' | 'off' | 'allowlist';
/** 准入配置；群名单是 chat_id 精确匹配数组。 */
export interface FeishuAccessConfig {
    groupPolicy?: FeishuGroupPolicy;
    groupAllowlist?: readonly string[];
    groupDenylist?: readonly string[];
    /** false（默认）时任何 bot 发送者一律 ignore-loop；true 只关闭回环拦截，仍走群档位。 */
    allowBotSender?: boolean;
}
/** evaluateAccess 的输入。 */
export interface FeishuAccessInput {
    /** 飞书事件的 sender_type：'app' 表示 bot，'user' 表示真人。 */
    senderIdType?: string;
    senderOpenId?: string;
    chatId: string;
    /** 群聊标记；缺省时用 chatType 推断，两者都缺省按群聊处理。 */
    isGroup?: boolean;
    chatType?: string;
    isBotMentioned: boolean;
    config: FeishuAccessConfig;
}
/** 拆分手工群名单：逗号/中文逗号/空白/分号分隔，去重保序。 */
export declare function parseFeishuChatList(raw: unknown): string[];
/** 把渠道配置（字符串键值）归一成准入配置；非法档位回退 mention。 */
export declare function resolveFeishuAccessConfig(raw: {
    groupPolicy?: unknown;
    groupAllowlist?: unknown;
    groupDenylist?: unknown;
    allowBotSender?: unknown;
}): {
    groupPolicy: FeishuGroupPolicy;
    groupAllowlist: string[];
    groupDenylist: string[];
    allowBotSender: boolean;
};
/**
 * 裁决一条入站消息是否进入 agent。
 * 规则短路顺序：bot 回环 > 私聊跳过 > denylist > 档位（off/allowlist）> @ 要求。
 * @param input - 发送者、会话与配置。
 * @returns allow 或具体的 ignore 原因。
 */
export declare function evaluateAccess(input: FeishuAccessInput): FeishuAccessDecision;
//# sourceMappingURL=feishu-access.d.ts.map