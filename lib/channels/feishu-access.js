/**
 * 飞书/Lark 入站准入：先拦截 bot 回环，再按群档位与群名单裁决。
 *
 * 纯函数、无副作用；调用方只负责把 allow 的消息送进原链路，其余静默丢弃，
 * 从而保证 ignore-* 分支零回复、零模型调用、零出站。
 */
/** 拆分手工群名单：逗号/中文逗号/空白/分号分隔，去重保序。 */
export function parseFeishuChatList(raw) {
    if (typeof raw !== 'string')
        return [];
    const result = [];
    for (const item of raw.split(/[\s,，;；]+/)) {
        const id = item.trim();
        if (id && !result.includes(id))
            result.push(id);
    }
    return result;
}
/** 把渠道配置（字符串键值）归一成准入配置；非法档位回退 mention。 */
export function resolveFeishuAccessConfig(raw) {
    return {
        groupPolicy: raw.groupPolicy === 'off' || raw.groupPolicy === 'allowlist' ? raw.groupPolicy : 'mention',
        groupAllowlist: parseFeishuChatList(raw.groupAllowlist),
        groupDenylist: parseFeishuChatList(raw.groupDenylist),
        allowBotSender: raw.allowBotSender === true || raw.allowBotSender === 'true',
    };
}
/**
 * 裁决一条入站消息是否进入 agent。
 * 规则短路顺序：bot 回环 > 私聊跳过 > denylist > 档位（off/allowlist）> @ 要求。
 * @param input - 发送者、会话与配置。
 * @returns allow 或具体的 ignore 原因。
 */
export function evaluateAccess(input) {
    // F2 最高优先：任何 bot 发送者默认拒绝，哪怕被 @；allowBotSender 只关闭这一层。
    if (input.senderIdType === 'app' || input.senderIdType === 'bot') {
        if (input.config.allowBotSender !== true) {
            return input.senderIdType === 'app' ? 'ignore-loop' : 'ignore-bot';
        }
    }
    const group = input.isGroup
        ?? (input.chatType !== undefined ? input.chatType === 'group' : true);
    // F3 只约束群聊；私聊继续走既有 engine.access 白名单逻辑。
    if (!group)
        return 'allow';
    const chatId = String(input.chatId);
    const deny = input.config.groupDenylist ?? [];
    if (deny.some((item) => item.trim() === chatId))
        return 'ignore-not-allowed';
    const policy = input.config.groupPolicy ?? 'mention';
    if (policy === 'off')
        return 'ignore-group-policy';
    if (policy === 'allowlist') {
        const allow = input.config.groupAllowlist ?? [];
        if (!allow.some((item) => item.trim() === chatId))
            return 'ignore-not-allowed';
    }
    if (!input.isBotMentioned)
        return 'ignore-group-policy';
    return 'allow';
}
//# sourceMappingURL=feishu-access.js.map