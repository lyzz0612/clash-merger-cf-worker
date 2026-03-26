# Clash Merger - Cloudflare Worker 版本

这是 Clash 订阅合并工具的 Cloudflare Worker 版本，使用 KV 数据库存储配置。

## 一键部署

点击下方按钮，即可将本项目部署到你的 Cloudflare 账号，**KV 命名空间会自动创建**，无需手动配置：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lyzz0612/clash-merger-cf-worker)

> Fork 用户：将上面链接中的 `lyzz0612` 替换为你自己的 GitHub 用户名即可部署你 fork 的仓库。

部署过程中会要求你设置以下内容：

| 配置项 | 说明 |
|--------|------|
| **TOKEN** | 访问令牌，用于订阅接口鉴权和管理界面登录。建议使用 `openssl rand -hex 16` 生成随机字符串 |
| **CLASH_KV** | KV 命名空间，自动创建，无需手动配置 |

部署完成后，直接访问 Worker URL 即可进入管理界面，使用你设置的 TOKEN 登录。

## 运行截图
![1.png](./img/1.png)
![2.png](./img/2.png)
![3.png](./img/3.png)

## 功能特点

- ✅ **一键部署**，KV 自动创建，开箱即用
- ✅ 运行在 Cloudflare Workers 上，无需服务器
- ✅ 使用 KV 数据库存储 Token 和订阅配置
- ✅ 支持多个订阅源合并
- ✅ **支持自定义代理服务器**（Hysteria2、VMess、Trojan 等）
- ✅ **Web 管理界面**，可视化管理订阅和自定义代理
- ✅ 自动创建代理组（AUTO 自动选择、PROXY 手动选择、Custom 自定义代理组）
- ✅ 基于 Loyalsoldier/clash-rules 的智能分流规则

## 项目结构

```
clash-merger-cf-worker/
├── src/
│   ├── index.js           # Worker 主入口
│   ├── config-loader.js   # KV 配置加载器
│   ├── proxy-provider.js  # 订阅获取模块
│   ├── clash-merger.js    # 配置合并逻辑
│   └── base-config.js     # 基础 Clash 配置
├── package.json
├── wrangler.toml          # Wrangler 配置文件
└── README.md
```

## 使用方法

### Web 管理界面

访问 Worker URL 的根路径即可进入管理界面：

```
https://your-worker-url.workers.dev/
```

**功能**：
- 📝 **订阅管理**：添加、编辑、删除订阅源
- 🔧 **自定义代理**：添加自己的代理服务器（Hysteria2、VMess、Trojan 等）
- 🔐 **Token 登录**：使用 KV 中设置的 TOKEN 登录

**使用步骤**：
1. 访问管理页面
2. 输入你在 KV 中设置的 TOKEN
3. 登录后可以管理订阅列表和自定义代理

#### 添加自定义代理

在管理界面的"自定义代理"区域：

1. 点击"➕ 添加代理"
2. 输入代理名称（例如：My Hysteria2）
3. 输入 JSON 格式的代理配置：

```json
{
  "name": "My Hysteria2",
  "type": "hysteria2",
  "server": "example.com",
  "port": 443,
  "password": "your-password",
  "sni": "example.com"
}
```

4. 点击保存

**支持的代理类型**：所有 Clash 支持的协议（ss、ssr、vmess、vless、trojan、hysteria、hysteria2 等）

### 订阅地址格式

```
https://your-worker-url.workers.dev/subs/<your-token>
```

例如：
```
https://clash-merger-cf-worker.your-subdomain.workers.dev/subs/your-secret-token-here
```

将此地址添加到你的 Clash 客户端即可。

## 生成的配置说明

Worker 会自动生成以下代理组：

1. **PROXY** - 主代理组（手动选择），包含所有其他组
2. **订阅源名称** - 每个订阅源会生成一个独立的选择组
3. **Custom** - 自定义代理组（如果有自定义代理），包含所有自定义代理
4. **AUTO** - 自动选择组（URL 测试），包含所有代理节点

**代理组层级结构**：
```
PROXY (主选择器)
├── 订阅1 (包含订阅1的所有节点)
├── 订阅2 (包含订阅2的所有节点)
├── Custom (包含所有自定义代理) ← 新增
└── AUTO (包含所有节点，自动选择最快)
```

**使用场景**：
- 想用特定订阅源的节点 → 选择对应的订阅组
- 想用自己的代理服务器 → 选择 Custom 组
- 让系统自动选择最快节点 → 选择 AUTO 组

## 注意事项

1. **Token 安全**: 请使用强随机字符串作为 TOKEN，不要使用简单密码
2. **订阅 URL**: 确保订阅 URL 返回的是标准的 Clash YAML 格式
3. **KV 限制**: Cloudflare KV 免费版有读写次数限制，请注意使用频率
4. **Worker 限制**: 免费版 Worker 每天有 100,000 次请求限制

## 许可证

MIT License

