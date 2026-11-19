/**
 * 飞书发送者展示名：contact v3 查询 + 进程内 TTL/LRU 缓存。
 *
 * 缓存预算（≥10 分钟、≥2000 条）保证每条消息不重复打通讯录接口；
 * 接口缺失、无权限、超时或异常一律降级为 undefined，由调用方只传 open_id。
 */
const DEFAULT_CAPACITY = 2048;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
/** Map 的插入顺序即 LRU 顺序：命中时 delete+set 刷新，写入超出容量时淘汰最旧。 */
export class OperatorNameCache {
    entries = new Map();
    capacity;
    ttlMs;
    now;
    constructor(options = {}) {
        this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY));
        this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS));
        this.now = options.now ?? Date.now;
    }
    get size() {
        return this.entries.size;
    }
    clear() {
        this.entries.clear();
    }
    get(openId) {
        const entry = this.entries.get(openId);
        if (entry === undefined)
            return undefined;
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(openId);
            return undefined;
        }
        // 命中刷新为最新，保证淘汰的是最久未用。
        this.entries.delete(openId);
        this.entries.set(openId, entry);
        return entry.name;
    }
    set(openId, name) {
        if (!openId || !name)
            return;
        this.entries.delete(openId);
        this.entries.set(openId, { name, expiresAt: this.now() + this.ttlMs });
        while (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined)
                break;
            this.entries.delete(oldest);
        }
    }
}
/** 进程内共享缓存；测试可注入独立实例。 */
export const operatorNameCache = new OperatorNameCache();
/** signal 取消/超时时让查询尽快返回 undefined，不拖住主消息。 */
function raceAbort(promise, signal) {
    if (signal === undefined)
        return promise;
    if (signal.aborted) {
        void promise.catch(() => undefined);
        return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => { cleanup(); void promise.catch(() => undefined); resolve(undefined); };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(value => { cleanup(); resolve(value); }, () => { cleanup(); resolve(undefined); });
    });
}
/**
 * 查询 sender open_id 的展示名。
 * @param client - 飞书 SDK Client（contact 能力可缺失）。
 * @param openId - 发送者 open_id。
 * @param signal - 取消/超时信号；触发时返回 undefined。
 * @param cache - 缓存实例，默认进程内共享。
 * @returns 展示名；任何失败都返回 undefined。
 */
export async function resolveOperatorName(client, openId, signal, cache = operatorNameCache) {
    const id = typeof openId === 'string' ? openId.trim() : '';
    if (!id)
        return undefined;
    const cached = cache.get(id);
    if (cached !== undefined)
        return cached;
    const userApi = client.contact?.user;
    if (userApi === undefined || typeof userApi.get !== 'function')
        return undefined;
    try {
        const response = await raceAbort(userApi.get({ path: { user_id: id }, params: { user_id_type: 'open_id' } }), signal);
        const user = response?.data?.user;
        const name = [user?.name, user?.en_name, user?.nickname]
            .find((value) => typeof value === 'string' && value.trim() !== '')
            ?.trim();
        if (!name)
            return undefined;
        cache.set(id, name);
        return name;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=feishu-operator.js.map