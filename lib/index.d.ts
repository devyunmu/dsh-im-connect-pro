/**
 * dsh-im-connect Host：IM 助理。
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { EngineConfig } from './engine/types.js';
import type { TopicMode } from './engine/topic-title.js';
export declare const name = "dsh-im-connect-pro";
export declare const inject: string[];
export interface PluginConfig {
    stateDir: string;
    cwd: string;
    provider: string;
    model: string;
    agentPreset: string;
    mergeTimeoutSecs: number;
    topicNaming: TopicMode;
    /** 打开后助手按标记把一次回复拆成多条消息。 */
    segmentReply?: boolean;
    /** 分段回复的标记，必须独占一行。 */
    segmentMarker?: string;
    /** 相邻两条分段消息之间随机间隔的下界（秒）。 */
    segmentDelayMinSecs?: number;
    /** 相邻两条分段消息之间随机间隔的上界（秒）。 */
    segmentDelayMaxSecs?: number;
    /** 思考过程折叠消息；缺省关闭，只有渠道实现 sendThinking 时才生效。 */
    thinkingDisplay?: EngineConfig['thinkingDisplay'];
    /** 飞书/Lark 群聊档位：mention（默认，@ 才响应）/ off（群静默）/ allowlist（仅名单群，仍需 @）。 */
    groupPolicy?: 'mention' | 'off' | 'allowlist';
    /** allowlist 档位允许响应的群 chat_id，逗号/空白/分号分隔。 */
    groupAllowlist?: string;
    /** 群 deny 名单；优先于 allowlist，命中的群无条件静默。 */
    groupDenylist?: string;
    /** 是否放行 bot 发送者；默认 false，防止群内多 bot 互 @ 烧 token。 */
    allowBotSender?: boolean;
    /** 飞书/Lark 是否查询发送者展示名（contact API + TTL 缓存）；默认 true。 */
    senderNameLookup?: boolean;
    /** 飞书/Lark 是否把合并转发压成可读摘要；默认 true。 */
    richSummary?: boolean;
}
export declare const Config: Schema<PluginConfig>;
export declare function apply(ctx: Context, config: PluginConfig): void;
export { CHANNEL_META, CHANNEL_ORDER, listChannelMeta } from './channels/meta.js';
export { IM_ORIGIN, IM_SESSION_PREFIX, IM_SESSION_PREFIX_LEGACY, createImSessionId, isImOrigin, isImSessionId, isTaskSession, sessionKeyOf, } from './engine/session-id.js';
export { splitText } from './engine/split.js';
//# sourceMappingURL=index.d.ts.map