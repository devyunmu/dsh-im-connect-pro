/**
 * 飞书合并转发 / 嵌套富文本摘要。
 *
 * merge_forward 的 content 可能是 `{ title, message_list }`、`{ messages }`、
 * `{ items }` 或直接数组；每条子消息再按 text/post/merge_forward 展开。
 * 输出每行 `发送者: 文本摘要`，总长度不超过 2000 字符（可配置上限，硬顶 2000）。
 * 任何结构解析失败返回 null，由 resolveFeishuContent 维持原错误。
 */
/** 把 post 的任意国际化/嵌套结构摊平成一行文本。 */
export declare function extractPostText(content: unknown, depth?: number): string;
/**
 * 把一条 merge_forward content 压成可读摘要。
 * @param content - 事件里的 content 字符串或已解析对象。
 * @param options.maxChars - 总长度上限，默认 2000；超过 2000 按 2000 硬顶。
 * @returns 摘要文本；无法识别结构时返回 null。
 */
export declare function summarizeMergeForward(content: unknown, options?: {
    maxChars?: number;
}): string | null;
//# sourceMappingURL=feishu-rich.d.ts.map