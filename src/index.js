import { Logger } from './logger.js';
import { getSubscription, refreshCache, getCacheStatus, getSubStats } from './subscription-cache.js';
import { parseProxyUri } from './proxy-uri-parser.js';
import loginHtml from './login.html';
import adminHtml from './admin.html';

/**
 * 获取有效 Token：优先从环境变量读取，回退到 KV
 */
async function getValidToken(env, kv) {
  if (env.TOKEN) {
    return env.TOKEN;
  }
  return await kv.get('TOKEN');
}

/**
 * Token 验证
 */
async function tokenCheck(token, env, kv) {
  const validToken = await getValidToken(env, kv);
  if (!validToken || token !== validToken) {
    throw new Error('Invalid token');
  }
}

/**
 * 验证请求中的 Authorization 头
 */
async function verifyAuth(request, env, kv) {
  const authToken = request.headers.get('Authorization');
  if (!authToken) {
    return false;
  }

  const validToken = await getValidToken(env, kv);
  return authToken === validToken;
}

/**
 * 返回 JSON 响应
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

/**
 * 返回 HTML 响应
 */
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

/**
 * 处理登录请求
 */
async function handleLogin(request, env, kv, logger) {
  const body = await request.json();
  const { token } = body;

  logger.info('登录请求', { token_length: token?.length });

  const validToken = await getValidToken(env, kv);
  if (token === validToken) {
    logger.info('登录成功');
    return jsonResponse({ success: true, message: '登录成功' });
  } else {
    logger.warn('登录失败：令牌无效');
    return jsonResponse({ success: false, error: '令牌无效' }, 401);
  }
}

/**
 * 处理获取订阅列表请求
 */
async function handleGetSubs(request, env, kv, logger) {
  const isAuthed = await verifyAuth(request, env, kv);
  if (!isAuthed) {
    logger.warn('获取订阅列表失败：未授权');
    return jsonResponse({ error: '未授权' }, 401);
  }

  const subsJson = await kv.get('SUBS');
  const subs = subsJson ? JSON.parse(subsJson) : [];
  const stats = await getSubStats(kv);

  logger.info('获取订阅列表成功', { count: subs.length });
  return jsonResponse({ subs, stats });
}

/**
 * 处理更新订阅列表请求
 */
async function handleUpdateSubs(request, env, kv, logger) {
  const isAuthed = await verifyAuth(request, env, kv);
  if (!isAuthed) {
    logger.warn('更新订阅列表失败：未授权');
    return jsonResponse({ error: '未授权' }, 401);
  }

  const body = await request.json();
  const { subs } = body;

  logger.info('更新订阅列表', { count: subs.length });
  await kv.put('SUBS', JSON.stringify(subs));

  logger.info('订阅列表保存成功');
  return jsonResponse({ success: true, message: '保存成功' });
}

/**
 * 处理获取自定义代理列表请求
 */
async function handleGetCustomProxies(request, env, kv, logger) {
  const isAuthed = await verifyAuth(request, env, kv);
  if (!isAuthed) {
    logger.warn('获取自定义代理列表失败：未授权');
    return jsonResponse({ error: '未授权' }, 401);
  }

  const customProxiesJson = await kv.get('CUSTOM_PROXIES');
  const customProxies = customProxiesJson ? JSON.parse(customProxiesJson) : [];

  logger.info('获取自定义代理列表成功', { count: customProxies.length });
  return jsonResponse({ customProxies });
}

/**
 * 处理更新自定义代理列表请求
 */
async function handleUpdateCustomProxies(request, env, kv, logger) {
  const isAuthed = await verifyAuth(request, env, kv);
  if (!isAuthed) {
    logger.warn('更新自定义代理列表失败：未授权');
    return jsonResponse({ error: '未授权' }, 401);
  }

  const body = await request.json();
  const { customProxies } = body;

  logger.info('更新自定义代理列表', { count: customProxies.length });
  await kv.put('CUSTOM_PROXIES', JSON.stringify(customProxies));

  logger.info('自定义代理列表保存成功');
  return jsonResponse({ success: true, message: '保存成功' });
}

/**
 * 将分享链接解析为 Clash 代理对象（供管理页使用）
 */
async function handleParseProxyUri(request, env, kv, logger) {
  const isAuthed = await verifyAuth(request, env, kv);
  if (!isAuthed) {
    logger.warn('解析代理链接失败：未授权');
    return jsonResponse({ error: '未授权' }, 401);
  }

  try {
    const body = await request.json();
    const { uri } = body;
    const proxy = parseProxyUri(uri);
    logger.info('解析代理链接成功', { type: proxy.type });
    return jsonResponse({ proxy });
  } catch (err) {
    logger.warn('解析代理链接失败', { message: err.message });
    return jsonResponse({ error: err.message || '解析失败' }, 400);
  }
}

/**
 * 后台刷新订阅缓存（订阅或自定义代理变更后调用，不阻塞响应）
 */
function scheduleCacheRefresh(ctx, kv, logger) {
  ctx.waitUntil(
    refreshCache(kv, logger).catch(err => {
      logger.error('后台刷新订阅缓存失败', { error: err.message });
    })
  );
}

/**
 * 处理获取缓存状态请求
 */
async function handleGetCacheStatus(request, env, kv, logger) {
  const isAuthed = await verifyAuth(request, env, kv);
  if (!isAuthed) {
    logger.warn('获取缓存状态失败：未授权');
    return jsonResponse({ error: '未授权' }, 401);
  }

  return jsonResponse(await getCacheStatus(kv));
}

/**
 * 处理手动刷新订阅缓存请求
 */
async function handleRefresh(request, env, kv, logger) {
  const isAuthed = await verifyAuth(request, env, kv);
  if (!isAuthed) {
    logger.warn('刷新订阅缓存失败：未授权');
    return jsonResponse({ error: '未授权' }, 401);
  }

  logger.info('手动刷新订阅缓存');
  const result = await refreshCache(kv, logger);
  return jsonResponse({
    success: result.refreshed,
    message: result.refreshed ? '刷新成功' : '所有订阅源获取失败，已保留旧缓存',
    updatedAt: result.updatedAt,
    sources: result.sources,
    succeeded: result.succeeded,
  });
}

/**
 * 处理订阅请求：默认返回缓存，forceRefresh 时实时重新生成
 */
async function handleSubscription(token, env, kv, logger, forceRefresh) {
  logger.info('订阅请求', { token_prefix: token.substring(0, 8) + '...', force_refresh: forceRefresh });
  await tokenCheck(token, env, kv);
  return await getSubscription(kv, logger, { forceRefresh });
}

/**
 * Worker 主入口
 */
export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 创建日志记录器
    const logger = new Logger({
      request_id: crypto.randomUUID(),
      method,
      path,
      user_agent: request.headers.get('User-Agent'),
      cf_ray: request.headers.get('CF-Ray'),
      cf_country: request.cf?.country,
      cf_colo: request.cf?.colo
    });

    logger.info('请求开始');

    try {
      let response;

      // 路由: 健康检查
      if (path === '/health') {
        logger.info('健康检查');
        response = jsonResponse({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        });
      }
      // 路由: 登录页面
      else if (path === '/login' || path === '/') {
        logger.info('返回登录页面');
        response = htmlResponse(loginHtml);
      }
      // 路由: 管理页面
      else if (path === '/admin') {
        logger.info('返回管理页面');
        response = htmlResponse(adminHtml);
      }
      // 路由: 登录 API
      else if (path === '/api/login' && method === 'POST') {
        response = await handleLogin(request, env, env.CLASH_KV, logger);
      }
      // 路由: 获取订阅列表 API
      else if (path === '/api/subs' && method === 'GET') {
        response = await handleGetSubs(request, env, env.CLASH_KV, logger);
      }
      // 路由: 更新订阅列表 API
      else if (path === '/api/subs' && method === 'PUT') {
        response = await handleUpdateSubs(request, env, env.CLASH_KV, logger);
        if (response.ok) scheduleCacheRefresh(ctx, env.CLASH_KV, logger);
      }
      // 路由: 获取自定义代理列表 API
      else if (path === '/api/custom-proxies' && method === 'GET') {
        response = await handleGetCustomProxies(request, env, env.CLASH_KV, logger);
      }
      // 路由: 更新自定义代理列表 API
      else if (path === '/api/custom-proxies' && method === 'PUT') {
        response = await handleUpdateCustomProxies(request, env, env.CLASH_KV, logger);
        if (response.ok) scheduleCacheRefresh(ctx, env.CLASH_KV, logger);
      }
      // 路由: 获取订阅缓存状态 API
      else if (path === '/api/cache' && method === 'GET') {
        response = await handleGetCacheStatus(request, env, env.CLASH_KV, logger);
      }
      // 路由: 手动刷新订阅缓存 API
      else if (path === '/api/refresh' && method === 'POST') {
        response = await handleRefresh(request, env, env.CLASH_KV, logger);
      }
      // 路由: 解析代理分享链接
      else if (path === '/api/parse-proxy-uri' && method === 'POST') {
        response = await handleParseProxyUri(request, env, env.CLASH_KV, logger);
      }
      // 路由: /subs/<token>
      else {
        const match = path.match(/^\/subs\/([^\/]+)$/);
        if (match) {
          const token = match[1];
          const forceRefresh = ['1', 'true'].includes(url.searchParams.get('refresh'));
          const result = await handleSubscription(token, env, env.CLASH_KV, logger, forceRefresh);

          // text/plain + inline：浏览器直接展示原始 YAML，避免被当作附件下载
          response = new Response(result.yaml, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Disposition': 'inline',
              'Cache-Control': 'no-store',
              'X-Cache': result.cache,
              'X-Cache-Updated-At': result.updatedAt || '',
            },
          });
        } else {
          logger.warn('路由未找到');
          response = new Response('Not Found', { status: 404 });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('请求完成', {
        status: response.status,
        duration_ms: duration
      });

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('请求失败', {
        error: error.message,
        stack: error.stack,
        duration_ms: duration
      });

      return new Response(`处理失败: ${error.message}`, { status: 500 });
    }
  },

  /**
   * 定时任务入口：按 wrangler.toml 中的 crons 刷新订阅缓存
   */
  async scheduled(event, env, ctx) {
    const logger = new Logger({
      trigger: 'cron',
      cron: event.cron,
      scheduled_time: new Date(event.scheduledTime).toISOString()
    });

    logger.info('定时刷新订阅缓存');
    ctx.waitUntil(
      refreshCache(env.CLASH_KV, logger).catch(err => {
        logger.error('定时刷新订阅缓存失败', { error: err.message, stack: err.stack });
      })
    );
  },
};
