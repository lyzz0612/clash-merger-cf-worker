/**
 * 将常见分享链接（vmess / ss / ssr / trojan / vless / hysteria2 等）解析为 Clash 单条 proxies 对象
 */

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function safeBase64ToBytes(str) {
  let s = str.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function safeBase64Decode(str) {
  const bytes = safeBase64ToBytes(str);
  return new TextDecoder().decode(bytes);
}

function extractHashName(uri) {
  const hashIdx = uri.indexOf('#');
  if (hashIdx < 0) return { rest: uri, name: '' };
  return {
    rest: uri.slice(0, hashIdx),
    name: decodeURIComponentSafe(uri.slice(hashIdx + 1)),
  };
}

function parseSS(uri) {
  let rest = uri.replace(/^ss:\/\//i, '');
  const { rest: noHash, name: hashName } = extractHashName(rest);
  rest = noHash.replace(/\s/g, '');

  const atIdx = rest.lastIndexOf('@');
  let server;
  let port;
  let method;
  let password;

  if (atIdx >= 0) {
    const userInfoB64 = rest.slice(0, atIdx);
    const hostPort = rest.slice(atIdx + 1);
    if (hostPort.includes('?')) {
      throw new Error('暂不支持带 plugin 等查询参数的 SS 链接');
    }
    const userDec = safeBase64Decode(userInfoB64);
    const um = userDec.match(/^([^:]+):(.+)$/);
    if (!um) throw new Error('无法解析 SS 加密方式与密码');
    method = um[1];
    password = um[2];
    const hpm = hostPort.match(/^\[([^\]]+)\]:(\d+)$|^([^:]+):(\d+)$/);
    if (!hpm) throw new Error('无法解析 SS 服务器地址');
    server = hpm[1] || hpm[3];
    port = parseInt(hpm[2] || hpm[4], 10);
  } else {
    const decoded = safeBase64Decode(rest);
    const m = decoded.match(/^([^:]+):(.+?)@\[([^\]]+)\]:(\d+)$/);
    if (m) {
      method = m[1];
      password = m[2];
      server = m[3];
      port = parseInt(m[4], 10);
    } else {
      const m2 = decoded.match(/^([^:]+):(.+?)@([^:]+):(\d+)$/);
      if (!m2) throw new Error('无法解析 SS 链接（请使用标准 ss:// 分享格式）');
      method = m2[1];
      password = m2[2];
      server = m2[3];
      port = parseInt(m2[4], 10);
    }
  }

  return {
    type: 'ss',
    name: hashName,
    server,
    port,
    cipher: method,
    password,
    udp: true,
  };
}

function parseSSR(uri) {
  let main = uri.replace(/^ssr:\/\//i, '');
  const { rest, name: hashName } = extractHashName(main);
  const decoded = safeBase64Decode(rest);
  const qIdx = decoded.indexOf('?');
  const queryStr = qIdx >= 0 ? decoded.slice(qIdx + 1) : '';
  const basePart = qIdx >= 0 ? decoded.slice(0, qIdx) : decoded;

  const slashPair = basePart.indexOf(':/');
  if (slashPair < 0) throw new Error('无法解析 SSR 链接格式');
  const head = basePart.slice(0, slashPair);
  const path = basePart.slice(slashPair + 2);

  const parts = head.split(':');
  if (parts.length < 6) throw new Error('SSR 字段不完整');

  const server = parts[0];
  const port = parseInt(parts[1], 10);
  const protocol = parts[2];
  const cipher = parts[3];
  const obfs = parts[4];
  const passwordB64 = parts.slice(5).join(':');

  let password = passwordB64;
  try {
    password = safeBase64Decode(passwordB64);
  } catch {
    // 部分节点密码为明文 base64 失败时保留原串
  }

  const qp = new URLSearchParams(queryStr);
  const obfsparam = qp.get('obfsparam') ? safeBase64Decode(qp.get('obfsparam')) : '';
  const protoparam = qp.get('protoparam') ? safeBase64Decode(qp.get('protoparam')) : '';
  const remarks = qp.get('remarks') ? safeBase64Decode(qp.get('remarks')) : '';

  return {
    type: 'ssr',
    name: hashName || remarks,
    server,
    port,
    cipher,
    password,
    protocol,
    obfs,
    'obfs-param': obfsparam,
    'protocol-param': protoparam,
    udp: true,
    ...(path && path !== '/' ? { path } : {}),
  };
}

function parseVmess(uri) {
  const b64 = uri.replace(/^vmess:\/\//i, '').split('#')[0].trim();
  const { name: hashName } = extractHashName(uri);
  let jsonStr;
  try {
    jsonStr = safeBase64Decode(b64);
  } catch {
    throw new Error('VMess 链接 Base64 无效');
  }
  let j;
  try {
    j = JSON.parse(jsonStr);
  } catch {
    throw new Error('VMess 解码后不是合法 JSON');
  }

  const ps = j.ps || j.remark || '';
  const server = j.add;
  const port = parseInt(String(j.port || 443), 10);
  const uuid = j.id;
  if (!server || !uuid) {
    throw new Error('VMess 缺少服务器地址或 UUID');
  }
  const alterId = parseInt(String(j.aid ?? j.alterId ?? 0), 10);
  const network = (j.net || 'tcp').toLowerCase();
  const tls = j.tls === 'tls' || j.tls === true || j.scy === 'tls';

  const proxy = {
    type: 'vmess',
    name: hashName || ps || server,
    server,
    port,
    uuid,
    alterId,
    cipher: j.scy || 'auto',
    udp: true,
    tls,
    'skip-cert-verify': !!(j.verify_cert === false || j.allowInsecure === 1),
  };

  if (tls && j.sni) {
    proxy.servername = j.sni;
  }

  if (network === 'ws') {
    proxy.network = 'ws';
    proxy['ws-opts'] = {
      path: j.path || '/',
      headers: {},
    };
    if (j.host) proxy['ws-opts'].headers.Host = j.host;
  } else if (network === 'grpc') {
    proxy.network = 'grpc';
    proxy['grpc-opts'] = {
      'grpc-service-name': j.path || j.serviceName || '',
    };
  } else if (network === 'h2') {
    proxy.network = 'h2';
    proxy['h2-opts'] = {
      host: j.host ? [j.host] : [],
      path: j.path || '/',
    };
  } else {
    proxy.network = 'tcp';
  }

  if (j.type && j.type !== 'none' && network === 'tcp') {
    proxy['tcp-opts'] = { header: { type: j.type } };
  }

  return proxy;
}

function parseTrojan(uri) {
  const u = new URL(uri.replace(/^trojan:\/\//i, 'trojan://'));
  const { name: hashName } = extractHashName(uri);
  const password = decodeURIComponent(u.username || '');
  const server = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const port = u.port ? parseInt(u.port, 10) : 443;
  const sni = u.searchParams.get('sni') || u.searchParams.get('peer') || '';
  const allowInsecure =
    u.searchParams.get('allowInsecure') === '1' ||
    u.searchParams.get('insecure') === '1';

  return {
    type: 'trojan',
    name: hashName,
    server,
    port,
    password,
    udp: true,
    sni: sni || server,
    'skip-cert-verify': allowInsecure,
  };
}

function parseVless(uri) {
  const u = new URL(uri.replace(/^vless:\/\//i, 'vless://'));
  const { name: hashName } = extractHashName(uri);
  const uuid = decodeURIComponent(u.username || '');
  const server = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const port = u.port ? parseInt(u.port, 10) : 443;
  const sp = u.searchParams;
  const security = (sp.get('security') || 'none').toLowerCase();
  const tls = security === 'tls' || security === 'reality';
  const sni = sp.get('sni') || sp.get('peer') || '';
  const fp = sp.get('fp') || '';
  const net = (sp.get('type') || 'tcp').toLowerCase();
  const allowInsecure = sp.get('allowInsecure') === '1' || sp.get('insecure') === '1';

  const proxy = {
    type: 'vless',
    name: hashName,
    server,
    port,
    uuid,
    encryption: 'none',
    udp: true,
    tls,
    'skip-cert-verify': allowInsecure,
  };

  if (tls) {
    if (sni) proxy.servername = sni;
    if (fp) proxy['client-fingerprint'] = fp;
  }

  if (net === 'ws') {
    proxy.network = 'ws';
    proxy['ws-opts'] = {
      path: sp.get('path') || '/',
      headers: {},
    };
    const host = sp.get('host');
    if (host) proxy['ws-opts'].headers.Host = host;
  } else if (net === 'grpc') {
    proxy.network = 'grpc';
    proxy['grpc-opts'] = {
      'grpc-service-name': sp.get('serviceName') || sp.get('mode') || '',
    };
  } else if (net === 'http' || net === 'h2') {
    proxy.network = 'h2';
    proxy['h2-opts'] = {
      path: sp.get('path') || '/',
      host: sp.get('host') ? [sp.get('host')] : [],
    };
  } else {
    proxy.network = 'tcp';
  }

  return proxy;
}

function parseHysteria2(uri) {
  const normalized = uri.replace(/^hy2:\/\//i, 'hysteria2://');
  const u = new URL(normalized);
  const { name: hashName } = extractHashName(uri);
  const password = decodeURIComponent(
    u.username || u.password || ''
  );
  const server = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const port = u.port ? parseInt(u.port, 10) : 443;
  const sp = u.searchParams;
  const sni = sp.get('sni') || '';
  const insecure = sp.get('insecure') === '1';

  return {
    type: 'hysteria2',
    name: hashName,
    server,
    port,
    password,
    sni: sni || server,
    'skip-cert-verify': insecure,
    udp: true,
  };
}

function parseSocks5(uri) {
  const u = new URL(uri.replace(/^socks5:\/\//i, 'socks5://'));
  const { name: hashName } = extractHashName(uri);
  const server = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const port = u.port ? parseInt(u.port, 10) : 1080;
  const user = decodeURIComponent(u.username || '');
  const pass = decodeURIComponent(u.password || '');

  const proxy = {
    type: 'socks5',
    name: hashName,
    server,
    port,
    udp: true,
  };
  if (user || pass) {
    proxy.username = user;
    proxy.password = pass;
  }
  return proxy;
}

/**
 * @param {string} uriString 单条分享链接
 * @returns {object} Clash proxy 对象（含 type、server、port 等，name 可能为空字符串）
 */
export function parseProxyUri(uriString) {
  const trimmed = String(uriString || '').trim();
  if (!trimmed) {
    throw new Error('链接为空');
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    throw new Error('这是网页链接，请粘贴 vmess://、ss://、trojan:// 等代理分享链接');
  }

  if (lower.startsWith('vmess://')) return parseVmess(trimmed);
  if (lower.startsWith('ss://')) return parseSS(trimmed);
  if (lower.startsWith('ssr://')) return parseSSR(trimmed);
  if (lower.startsWith('trojan://')) return parseTrojan(trimmed);
  if (lower.startsWith('vless://')) return parseVless(trimmed);
  if (lower.startsWith('hysteria2://') || lower.startsWith('hy2://')) {
    return parseHysteria2(trimmed);
  }
  if (lower.startsWith('socks5://') || lower.startsWith('socks://')) {
    return parseSocks5(trimmed);
  }

  throw new Error(
    '不支持的协议。支持：vmess、ss、ssr、trojan、vless、hysteria2(hy2)、socks5'
  );
}
