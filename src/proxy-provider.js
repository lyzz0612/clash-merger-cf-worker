import yaml from 'js-yaml';
import { parseProxyUri } from './proxy-uri-parser.js';

/**
 * 解析订阅内容：优先按 Clash YAML，失败时按 base64 编码的分享链接列表解析
 */
function parseSubscription(text) {
  let config = null;
  try {
    config = yaml.load(text);
  } catch {
    // 非 YAML，继续尝试 base64
  }
  if (config && typeof config === 'object' && Array.isArray(config.proxies)) {
    return { format: 'yaml', proxies: config.proxies };
  }

  let decoded = text.trim();
  if (!/:\/\//.test(decoded)) {
    const b64 = decoded.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    decoded = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  const proxies = [];
  for (const line of decoded.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    try {
      const proxy = parseProxyUri(line);
      if (!proxy.name) proxy.name = `${proxy.type}-${proxy.server}:${proxy.port}`;
      proxies.push(proxy);
    } catch {
      // 跳过无法识别的行
    }
  }
  return { format: 'base64', proxies };
}

/**
 * 代理提供者 - 从远程 URL 获取订阅配置
 */
export class ProxyProvider {
  constructor(name, url) {
    this.name = name;
    this.url = url;
    this.proxies = [];
    this.ok = false;
  }

  /**
   * 获取订阅内容
   */
  async fetchProxies() {
    const startTime = Date.now();
    try {
      console.log(JSON.stringify({
        level: 'INFO',
        message: '开始获取订阅',
        provider: this.name,
        url: this.url
      }));

      const response = await fetch(this.url, {
        headers: {
          'User-Agent': 'clash-verge/v2.2.3'
        }
      });

      if (!response.ok) {
        console.error(JSON.stringify({
          level: 'ERROR',
          message: '获取订阅失败',
          provider: this.name,
          url: this.url,
          status: response.status,
          duration_ms: Date.now() - startTime
        }));
        return;
      }

      const text = await response.text();
      const { format, proxies } = parseSubscription(text);
      this.proxies = proxies;
      this.ok = true;

      console.log(JSON.stringify({
        level: 'INFO',
        message: '订阅获取成功',
        provider: this.name,
        format,
        proxy_count: this.proxies.length,
        duration_ms: Date.now() - startTime
      }));

    } catch (error) {
      console.error(JSON.stringify({
        level: 'ERROR',
        message: '获取订阅异常',
        provider: this.name,
        error: error.message,
        duration_ms: Date.now() - startTime
      }));
    }
  }

  getProxies() {
    return this.proxies;
  }

  getName() {
    return this.name;
  }
}
