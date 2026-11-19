/**
 * 飞书发送者展示名：contact v3 查询 + 进程内 TTL/LRU 缓存。
 *
 * 缓存预算（≥10 分钟、≥2000 条）保证每条消息不重复打通讯录接口；
 * 接口缺失、无权限、超时或异常一律降级为 undefined，由调用方只传 open_id。
 */
/** contact API 的最小结构；真实 SDK 与测试伪实现都满足。 */
export interface FeishuContactClient {
    contact?: {
        user?: {
            get(payload: {
                path: {
                    user_id: string;
                };
                params?: {
                    user_id_type?: 'open_id' | 'user_id' | 'union_id';
                };
            }): Promise<{
                data?: {
                    user?: {
                        name?: string;
                        en_name?: string;
                        nickname?: string;
                    };
                };
            } | undefined>;
        };
    };
}
export interface OperatorNameCacheOptions {
    capacity?: number;
    ttlMs?: number;
    now?: () => number;
}
/** Map 的插入顺序即 LRU 顺序：命中时 delete+set 刷新，写入超出容量时淘汰最旧。 */
export declare class OperatorNameCache {
    private readonly entries;
    private readonly capacity;
    private readonly ttlMs;
    private readonly now;
    constructor(options?: OperatorNameCacheOptions);
    get size(): number;
    clear(): void;
    get(openId: string): string | undefined;
    set(openId: string, name: string): void;
}
/** 进程内共享缓存；测试可注入独立实例。 */
export declare const operatorNameCache: OperatorNameCache;
/**
 * 查询 sender open_id 的展示名。
 * @param client - 飞书 SDK Client（contact 能力可缺失）。
 * @param openId - 发送者 open_id。
 * @param signal - 取消/超时信号；触发时返回 undefined。
 * @param cache - 缓存实例，默认进程内共享。
 * @returns 展示名；任何失败都返回 undefined。
 */
export declare function resolveOperatorName(client: FeishuContactClient, openId: string | undefined, signal?: AbortSignal, cache?: OperatorNameCache): Promise<string | undefined>;
//# sourceMappingURL=feishu-operator.d.ts.map