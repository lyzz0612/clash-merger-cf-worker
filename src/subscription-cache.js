import { ConfigLoader } from './config-loader.js';
import { ProxyProvider } from './proxy-provider.js';
import { ClashMerger } from './clash-merger.js';
import { BASE_CONFIG } from './base-config.js';

const CACHE_KEY = 'CACHE_YAML';
const STATS_KEY = 'SUB_STATS';

/**
 * 订阅是否启用（未设置 enabled 视为启用）
 */
export function isSubEnabled(sub) {
  return sub.enabled !== false;
}

/**
 * 读取各订阅源的节点统计，结构：{ [url]: { count, ok, updatedAt } }
 */
export async function getSubStats(kv) {
  const json = await kv.get(STATS_KEY);
  return json ? JSON.parse(json) : {};
}

/**
 * 实时获取所有启用的订阅源并合并，返回 YAML 与统计信息
 */
async function buildSubscription(kv, logger) {
  const configLoader = new ConfigLoader(kv);
  await configLoader.loadSubs('SUBS');

  const subs = configLoader.getSubs();
  if (!subs || subs.length === 0) {
    logger.error('未找到订阅配置');
    throw new Error('未找到订阅配置');
  }

  const enabledSubs = subs.filter(isSubEnabled);
  logger.info('开始合并订阅', { sources: subs.length, enabled: enabledSubs.length });

  const providers = enabledSubs.map(sub => new ProxyProvider(sub.name, sub.url));
  const merger = new ClashMerger(providers, BASE_CONFIG, kv);
  await merger.merge();

  const succeeded = providers.filter(p => p.getProxies().length > 0).length;
  logger.info('订阅合并完成', { sources: enabledSubs.length, succeeded });

  // 记录本次拉取的节点数；禁用的订阅源保留上次的统计，已删除的订阅源丢弃
  const updatedAt = new Date().toISOString();
  const oldStats = await getSubStats(kv);
  const stats = {};
  for (const sub of subs) {
    if (oldStats[sub.url]) stats[sub.url] = oldStats[sub.url];
  }
  for (const provider of providers) {
    stats[provider.url] = {
      count: provider.getProxies().length,
      ok: provider.ok,
      ...(provider.error && { error: provider.error }),
      updatedAt,
    };
  }

  return { yaml: merger.dump(), sources: enabledSubs.length, succeeded, stats };
}

/**
 * 重新生成合并订阅并写入 KV 缓存
 * 若所有订阅源都获取失败且已有缓存，则保留旧缓存，避免把空配置写进去
 */
export async function refreshCache(kv, logger) {
  const result = await buildSubscription(kv, logger);
  const updatedAt = new Date().toISOString();

  // 节点统计无论成败都记录，便于管理页显示失败的订阅源
  await kv.put(STATS_KEY, JSON.stringify(result.stats));

  // 仅在有启用的订阅源但全部失败时保留旧缓存；全部禁用时应输出不含订阅节点的新配置
  if (result.sources > 0 && result.succeeded === 0) {
    const old = await kv.getWithMetadata(CACHE_KEY);
    if (old.value) {
      logger.warn('所有订阅源获取失败，保留旧缓存', { cached_at: old.metadata?.updatedAt });
      return {
        yaml: old.value,
        updatedAt: old.metadata?.updatedAt || null,
        refreshed: false,
        sources: result.sources,
        succeeded: 0,
      };
    }
  }

  await kv.put(CACHE_KEY, result.yaml, {
    metadata: { updatedAt, sources: result.sources, succeeded: result.succeeded },
  });
  logger.info('订阅缓存已更新', { updated_at: updatedAt });

  return { ...result, updatedAt, refreshed: true };
}

/**
 * 读取合并订阅：优先使用缓存，无缓存时实时生成并写入
 */
export async function getSubscription(kv, logger, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await kv.getWithMetadata(CACHE_KEY);
    if (cached.value) {
      logger.info('命中订阅缓存', { updated_at: cached.metadata?.updatedAt });
      return { yaml: cached.value, updatedAt: cached.metadata?.updatedAt || null, cache: 'HIT' };
    }
  }

  const result = await refreshCache(kv, logger);
  return { yaml: result.yaml, updatedAt: result.updatedAt, cache: forceRefresh ? 'REFRESH' : 'MISS' };
}

/**
 * 读取缓存状态（不含 YAML 内容）
 */
export async function getCacheStatus(kv) {
  const { metadata } = await kv.getWithMetadata(CACHE_KEY);
  return {
    cached: !!metadata,
    updatedAt: metadata?.updatedAt || null,
    sources: metadata?.sources ?? null,
    succeeded: metadata?.succeeded ?? null,
  };
}
