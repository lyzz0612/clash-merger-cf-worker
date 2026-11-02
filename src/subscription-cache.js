import { ConfigLoader } from './config-loader.js';
import { ProxyProvider } from './proxy-provider.js';
import { ClashMerger } from './clash-merger.js';
import { BASE_CONFIG } from './base-config.js';

const CACHE_KEY = 'CACHE_YAML';

/**
 * 实时获取所有订阅源并合并，返回 YAML 与统计信息
 */
async function buildSubscription(kv, logger) {
  const configLoader = new ConfigLoader(kv);
  await configLoader.loadSubs('SUBS');

  const subs = configLoader.getSubs();
  if (!subs || subs.length === 0) {
    logger.error('未找到订阅配置');
    throw new Error('未找到订阅配置');
  }

  logger.info('开始合并订阅', { sources: subs.length });

  const providers = subs.map(sub => new ProxyProvider(sub.name, sub.url));
  const merger = new ClashMerger(providers, BASE_CONFIG, kv);
  await merger.merge();

  const succeeded = providers.filter(p => p.getProxies().length > 0).length;
  logger.info('订阅合并完成', { sources: subs.length, succeeded });

  return { yaml: merger.dump(), sources: subs.length, succeeded };
}

/**
 * 重新生成合并订阅并写入 KV 缓存
 * 若所有订阅源都获取失败且已有缓存，则保留旧缓存，避免把空配置写进去
 */
export async function refreshCache(kv, logger) {
  const result = await buildSubscription(kv, logger);
  const updatedAt = new Date().toISOString();

  if (result.succeeded === 0) {
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
