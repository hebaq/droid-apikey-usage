// main.ts - Optimized by Apple Senior Engineer
import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import { format } from "https://deno.land/std@0.182.0/datetime/mod.ts";
import { setCookie, getCookies } from "https://deno.land/std@0.182.0/http/cookie.ts";

// Initialize Deno KV
const kv = await Deno.openKv();

// Get admin password from environment variable
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD");

// Get port from environment variable, default to 8000
const PORT = parseInt(Deno.env.get("PORT") || "8100");

console.log(`🔒 Password Protection: ${ADMIN_PASSWORD ? 'ENABLED' : 'DISABLED'}`);

// Session Management
interface Session {
  id: string;
  createdAt: number;
  expiresAt: number;
}

async function createSession(): Promise<string> {
  const sessionId = crypto.randomUUID();
  const session: Session = {
    id: sessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
  };
  await kv.set(["sessions", sessionId], session);
  return sessionId;
}

async function validateSession(sessionId: string): Promise<boolean> {
  const result = await kv.get<Session>(["sessions", sessionId]);
  if (!result.value) return false;

  const session = result.value;
  if (Date.now() > session.expiresAt) {
    await kv.delete(["sessions", sessionId]);
    return false;
  }

  return true;
}

async function isAuthenticated(req: Request): Promise<boolean> {
  // If no password is set, allow access
  if (!ADMIN_PASSWORD) return true;

  const cookies = getCookies(req.headers);
  const sessionId = cookies.session;

  if (!sessionId) return false;

  return await validateSession(sessionId);
}

// KV Storage Interface
interface ApiKeyEntry {
  id: string;
  key: string;
  name?: string;
  createdAt: number;
}

// KV Database Functions
async function saveApiKey(id: string, key: string, name?: string): Promise<void> {
  const entry: ApiKeyEntry = {
    id,
    key,
    name: name || `Key ${id}`,
    createdAt: Date.now(),
  };
  await kv.set(["apikeys", id], entry);
}

async function getApiKey(id: string): Promise<ApiKeyEntry | null> {
  const result = await kv.get<ApiKeyEntry>(["apikeys", id]);
  return result.value;
}

async function getAllApiKeys(): Promise<ApiKeyEntry[]> {
  const entries: ApiKeyEntry[] = [];
  const iter = kv.list<ApiKeyEntry>({ prefix: ["apikeys"] });
  for await (const entry of iter) {
    entries.push(entry.value);
  }
  return entries;
}

async function deleteApiKey(id: string): Promise<void> {
  await kv.delete(["apikeys", id]);
}

async function checkDuplicateKey(key: string): Promise<boolean> {
  const allKeys = await getAllApiKeys();
  return allKeys.some(entry => entry.key === key);
}

// Find duplicate keys in existing database
async function findDuplicateKeys(): Promise<{ duplicates: Array<{ key: string; ids: string[]; count: number }> }> {
  const allKeys = await getAllApiKeys();
  const keyMap = new Map<string, string[]>();

  // Group keys by their value
  for (const entry of allKeys) {
    const existing = keyMap.get(entry.key) || [];
    existing.push(entry.id);
    keyMap.set(entry.key, existing);
  }

  // Find duplicates (keys that appear more than once)
  const duplicates: Array<{ key: string; ids: string[]; count: number }> = [];
  for (const [key, ids] of keyMap.entries()) {
    if (ids.length > 1) {
      duplicates.push({
        key: `${key.substring(0, 4)}...${key.substring(key.length - 4)}`,
        ids,
        count: ids.length
      });
    }
  }

  return { duplicates };
}

async function batchImportKeys(keys: string[]): Promise<{ success: number; failed: number; duplicates: number; duplicateKeys: string[] }> {
  let success = 0;
  let failed = 0;
  let duplicates = 0;
  const duplicateKeys: string[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].trim();
    if (key.length > 0) {
      try {
        // Check for duplicate
        const isDuplicate = await checkDuplicateKey(key);
        if (isDuplicate) {
          duplicates++;
          duplicateKeys.push(`${key.substring(0, 4)}...${key.substring(key.length - 4)}`);
          console.log(`Skipped duplicate key: ${key.substring(0, 4)}...`);
          continue;
        }

        const id = `key-${Date.now()}-${i}`;
        await saveApiKey(id, key);
        success++;
      } catch (error) {
        failed++;
        console.error(`Failed to import key ${i}:`, error);
      }
    }
  }

  return { success, failed, duplicates, duplicateKeys };
}

// Login Page HTML
const LOGIN_PAGE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录 - API 余额监控看板</title>
    <script src="https://cdn.jsdelivr.net/npm/iconify-icon@2.1.0/dist/iconify-icon.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
            --background: 0 0% 100%;
            --foreground: 0 0% 20%;
            --card: 0 0% 100%;
            --card-foreground: 0 0% 20%;
            --popover: 0 0% 100%;
            --popover-foreground: 0 0% 20%;
            --primary: 0 0% 30%;
            --primary-foreground: 0 0% 98%;
            --secondary: 0 0% 96.1%;
            --secondary-foreground: 0 0% 30%;
            --muted: 0 0% 96.1%;
            --muted-foreground: 0 0% 55%;
            --accent: 0 0% 96.1%;
            --accent-foreground: 0 0% 30%;
            --destructive: 0 72% 65%;
            --destructive-foreground: 0 0% 98%;
            --border: 0 0% 92%;
            --input: 0 0% 92%;
            --ring: 0 0% 60%;
            --radius: 0.5rem;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            background: hsl(0 0% 99%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        .login-container {
            background: hsl(var(--card));
            border: 1px solid hsl(var(--border));
            border-radius: calc(var(--radius) * 2);
            padding: 48px;
            box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
            max-width: 400px;
            width: 100%;
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .login-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 64px;
            height: 64px;
            margin: 0 auto 24px;
            background: hsl(var(--primary));
            border-radius: var(--radius);
        }

        .login-icon iconify-icon {
            font-size: 32px;
            color: hsl(var(--primary-foreground));
        }

        h1 {
            font-size: 24px;
            font-weight: 600;
            text-align: center;
            color: hsl(var(--foreground));
            margin-bottom: 8px;
            letter-spacing: -0.03em;
        }

        p {
            text-align: center;
            color: hsl(var(--muted-foreground));
            margin-bottom: 32px;
            font-size: 14px;
        }

        .form-group {
            margin-bottom: 16px;
        }

        label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            color: hsl(var(--foreground));
            margin-bottom: 8px;
        }

        input[type="password"] {
            width: 100%;
            padding: 10px 12px;
            background: hsl(var(--background));
            border: 1px solid hsl(var(--input));
            border-radius: var(--radius);
            font-size: 14px;
            transition: all 0.2s;
            color: hsl(var(--foreground));
        }

        input[type="password"]:focus {
            outline: none;
            border-color: hsl(var(--ring));
            box-shadow: 0 0 0 3px hsl(var(--ring) / 0.1);
        }

        .login-btn {
            width: 100%;
            padding: 12px 16px;
            background: hsl(0 0% 40%);
            color: hsl(var(--background));
            border: none;
            border-radius: var(--radius);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .login-btn:hover {
            background: hsl(0 0% 35%);
        }

        .login-btn:active {
            transform: scale(0.98);
        }

        .error-message {
            background: hsl(var(--destructive) / 0.1);
            color: hsl(var(--destructive));
            padding: 12px 16px;
            border-radius: var(--radius);
            font-size: 14px;
            margin-bottom: 16px;
            border: 1px solid hsl(var(--destructive) / 0.2);
            display: none;
            align-items: center;
            gap: 8px;
        }

        .error-message.show {
            display: flex;
            animation: shake 0.4s;
        }

        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-icon">
            <iconify-icon icon="lucide:lock-keyhole"></iconify-icon>
        </div>
        <h1>欢迎回来</h1>
        <p>请输入管理员密码以访问系统</p>

        <div class="error-message" id="errorMessage">
            <iconify-icon icon="lucide:alert-circle"></iconify-icon>
            <span>密码错误,请重试</span>
        </div>

        <form onsubmit="handleLogin(event)">
            <div class="form-group">
                <label for="password">密码</label>
                <input
                    type="password"
                    id="password"
                    placeholder="输入密码"
                    autocomplete="current-password"
                    required
                >
            </div>

            <button type="submit" class="login-btn">
                登录
            </button>
        </form>
    </div>

    <script>
        async function handleLogin(event) {
            event.preventDefault();

            const password = document.getElementById('password').value;
            const errorMessage = document.getElementById('errorMessage');

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password }),
                });

                if (response.ok) {
                    window.location.href = '/';
                } else {
                    errorMessage.classList.add('show');
                    document.getElementById('password').value = '';
                    document.getElementById('password').focus();

                    setTimeout(() => {
                        errorMessage.classList.remove('show');
                    }, 3000);
                }
            } catch (error) {
                alert('登录失败: ' + error.message);
            }
        }
    </script>
</body>
</html>
`;

// Main Application HTML (continued in next message due to length)
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Droid API 余额监控看板</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/iconify-icon@2.1.0/dist/iconify-icon.min.js"></script>
    <style>
        :root {
            --background: 0 0% 100%;
            --foreground: 222.2 84% 4.9%;
            --card: 0 0% 100%;
            --card-foreground: 222.2 84% 4.9%;
            --popover: 0 0% 100%;
            --popover-foreground: 222.2 84% 4.9%;
            --primary: 221.2 83.2% 53.3%;
            --primary-foreground: 210 40% 98%;
            --secondary: 210 40% 96.1%;
            --secondary-foreground: 222.2 47.4% 11.2%;
            --muted: 210 40% 96.1%;
            --muted-foreground: 215.4 16.3% 46.9%;
            --accent: 210 40% 96.1%;
            --accent-foreground: 222.2 47.4% 11.2%;
            --destructive: 0 84.2% 60.2%;
            --destructive-foreground: 210 40% 98%;
            --border: 214.3 31.8% 91.4%;
            --input: 214.3 31.8% 91.4%;
            --ring: 221.2 83.2% 53.3%;
            --radius: 0.5rem;
            --success: 142 71% 45%;
            --success-foreground: 0 0% 100%;
            --warning: 38 92% 50%;
            --warning-foreground: 0 0% 100%;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background-color: hsl(var(--background));
            color: hsl(var(--foreground));
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            padding: 1.5rem;
        }

        /* FiraCode for code/numbers - Scale 1.25x and anti-aliasing */
        .code-font, .key-cell, td.number, .key-masked, #importKeys {
            font-family: 'Fira Code', 'SF Mono', 'Monaco', 'Courier New', monospace;
            font-feature-settings: "liga" 1, "calt" 1;
            -webkit-font-smoothing: subpixel-antialiased;
            -moz-osx-font-smoothing: auto;
            text-rendering: optimizeLegibility;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: hsl(var(--card));
            border: 1px solid hsl(var(--border));
            border-radius: calc(var(--radius) + 2px);
            box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            overflow: hidden;
        }

        .header {
            position: relative;
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
            padding: 1.5rem 2rem;
            text-align: center;
            border-bottom: 1px solid hsl(var(--border));
        }

        .header h1 {
            font-size: 1.5rem;
            font-weight: 600;
            line-height: 1;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }

        .header .update-time {
            font-size: 0.875rem;
            opacity: 0.9;
            font-weight: 400;
        }

        .stats-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            padding: 1.5rem;
            background: transparent;
        }

        .stat-card {
            background: hsl(var(--card));
            border: 1px solid hsl(var(--border));
            border-radius: var(--radius);
            padding: 1.5rem;
            text-align: center;
            transition: all 0.15s;
            box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        }

        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            border-color: hsl(var(--ring) / 0.5);
        }

        .stat-card .label {
            font-size: 0.875rem;
            color: hsl(var(--muted-foreground));
            margin-bottom: 0.75rem;
            font-weight: 500;
            letter-spacing: 0.025em;
            text-transform: uppercase;
        }

        .stat-card .value {
            font-size: 2rem;
            font-weight: 600;
            color: hsl(var(--primary));
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.02em;
        }

        .table-container {
            padding: 0 32px 32px;
            overflow-x: visible;
        }

        table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: hsl(var(--card));
            border-radius: var(--radius);
            overflow: visible;
            border: 1px solid hsl(var(--border));
            margin-bottom: 32px;
            table-layout: fixed;
            box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        }

        thead {
            background: hsl(var(--muted));
            color: hsl(var(--foreground));
        }

        th {
            padding: 1rem;
            text-align: left;
            font-weight: 600;
            font-size: 0.75rem;
            white-space: nowrap;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            border-bottom: 1px solid hsl(var(--border));
            color: hsl(var(--muted-foreground));
        }

        th.number { text-align: right; }

        /* 调整列宽 */
        th:nth-child(1) { width: 5%; } /* ID */
        th:nth-child(2) { width: 10%; } /* API Key */
        th:nth-child(3) { width: 10%; } /* 开始时间 */
        th:nth-child(4) { width: 10%; } /* 结束时间 */
        th:nth-child(5) { width: 13%; } /* 总计额度 */
        th:nth-child(6) { width: 13%; } /* 已使用 */
        th:nth-child(7) { width: 13%; } /* 剩余额度 */
        th:nth-child(8) { width: 11%; } /* 使用百分比 */
        th:nth-child(9) { width: 8%; } /* 操作 */

        td {
            padding: 16px;
            border-bottom: 1px solid hsl(var(--border));
            font-size: 14px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        td.number {
            text-align: right;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        td.error-row { color: hsl(var(--destructive)); }

        tbody tr { transition: background-color 0.15s ease; }
        tbody tr:hover { background-color: hsl(var(--muted) / 0.5); }
        tbody tr:last-child td { border-bottom: none; }

        /* 总计行样式 */
        .total-row {
            background: hsl(var(--accent));
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            border-bottom: 2px solid hsl(var(--primary)) !important;
        }

        .total-row td {
            padding: 1.25rem 1rem;
            font-size: 0.9375rem;
            color: hsl(var(--primary));
            border-bottom: 2px solid hsl(var(--primary)) !important;
            font-weight: 600;
        }

        /* 删除按钮样式 */
        .table-delete-btn {
            background: hsl(var(--destructive));
            color: hsl(var(--destructive-foreground));
            border: none;
            border-radius: calc(var(--radius) * 0.75);
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .table-delete-btn:hover {
            background: hsl(var(--destructive) / 0.9);
            transform: scale(1.05);
        }

        .table-delete-btn:active {
            transform: scale(0.98);
        }

        .key-cell {
            font-size: 14px;
            color: hsl(var(--muted-foreground));
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .refresh-btn {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
            border: none;
            border-radius: calc(var(--radius) * 10);
            padding: 0.75rem 1.5rem;
            font-size: 0.875rem;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            z-index: 100;
        }

        .refresh-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
            background: hsl(var(--primary) / 0.9);
        }

        .refresh-btn:active {
            transform: translateY(0);
        }

        .export-zero-btn {
            position: fixed;
            bottom: calc(2rem + 4rem);
            right: 2rem;
            background: hsl(var(--warning));
            color: hsl(var(--warning-foreground));
            border: none;
            border-radius: calc(var(--radius) * 10);
            padding: 0.75rem 1.5rem;
            font-size: 0.875rem;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            z-index: 100;
        }

        .export-zero-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
            background: hsl(var(--warning) / 0.9);
        }

        .export-zero-btn:active {
            transform: translateY(0);
        }

        .export-valid-btn {
            position: fixed;
            bottom: calc(2rem + 8rem);
            right: 2rem;
            background: hsl(var(--success));
            color: hsl(var(--success-foreground));
            border: none;
            border-radius: calc(var(--radius) * 10);
            padding: 0.75rem 1.5rem;
            font-size: 0.875rem;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            z-index: 100;
        }

        .export-valid-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
            background: hsl(var(--success) / 0.9);
        }

        .export-valid-btn:active {
            transform: translateY(0);
        }

        /* 导出零额度弹窗 */
        .export-zero-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgb(0 0 0 / 0.5);
            backdrop-filter: blur(10px);
            z-index: 1001;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            animation: fadeIn 0.3s ease;
        }

        .export-zero-content {
            background: hsl(var(--card));
            border: 1px solid hsl(var(--border));
            border-radius: calc(var(--radius) * 2);
            max-width: 700px;
            width: 100%;
            max-height: 85vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }

        .export-zero-header {
            background: hsl(var(--warning));
            color: hsl(var(--warning-foreground));
            padding: 1.5rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid hsl(var(--border));
        }

        .export-zero-header h2 {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 600;
            letter-spacing: -0.025em;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .export-zero-body {
            padding: 24px 32px;
            overflow-y: auto;
            flex: 1;
        }

        .export-zero-textarea {
            width: 100%;
            padding: 12px;
            background: hsl(var(--muted) / 0.3);
            border: 1px solid hsl(var(--border));
            border-radius: var(--radius);
            font-size: 13px;
            font-family: 'Fira Code', 'Monaco', 'Courier New', monospace;
            resize: vertical;
            min-height: 300px;
            color: hsl(var(--foreground));
            line-height: 1.8;
        }

        .export-zero-textarea:focus {
            outline: none;
            border-color: hsl(var(--ring));
            box-shadow: 0 0 0 3px hsl(var(--ring) / 0.1);
        }

        .export-zero-actions {
            padding: 16px 32px 24px;
            display: flex;
            gap: 12px;
            border-top: 1px solid hsl(var(--border));
        }

        .export-action-btn {
            flex: 1;
            padding: 10px 20px;
            border: none;
            border-radius: var(--radius);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .export-action-btn.copy {
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
        }

        .export-action-btn.copy:hover {
            background: hsl(var(--primary) / 0.9);
        }

        .export-action-btn.clear {
            background: hsl(var(--destructive));
            color: hsl(var(--destructive-foreground));
        }

        .export-action-btn.clear:hover {
            background: hsl(var(--destructive) / 0.9);
        }

        .export-action-btn:active {
            transform: scale(0.98);
        }

        .export-zero-info {
            color: hsl(var(--muted-foreground));
            font-size: 14px;
            margin-bottom: 16px;
            padding: 12px 16px;
            background: hsl(var(--muted) / 0.5);
            border-radius: var(--radius);
            border: 1px solid hsl(var(--border));
        }

        .loading {
            text-align: center;
            padding: 60px 20px;
            color: hsl(var(--muted-foreground));
            font-size: 14px;
        }

        .error {
            text-align: center;
            padding: 60px 20px;
            color: hsl(var(--destructive));
            font-size: 14px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid currentColor;
            border-radius: 50%;
            border-top-color: transparent;
            animation: spin 0.8s linear infinite;
        }

        .manage-btn {
            position: absolute;
            top: 1.5rem;
            right: 1.5rem;
            background: hsl(var(--primary-foreground) / 0.1);
            backdrop-filter: blur(10px);
            color: hsl(var(--primary-foreground));
            border: 1px solid hsl(var(--primary-foreground) / 0.2);
            border-radius: var(--radius);
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }

        .manage-btn:hover {
            background: hsl(var(--primary-foreground) / 0.2);
            transform: scale(1.02);
        }

        .manage-panel {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgb(0 0 0 / 0.5);
            backdrop-filter: blur(10px);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .manage-content {
            background: hsl(var(--card));
            border: 1px solid hsl(var(--border));
            border-radius: calc(var(--radius) * 2);
            max-width: 1000px;
            width: 100%;
            max-height: 85vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
            animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .manage-header {
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
            padding: 1.5rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid hsl(var(--border));
        }

        .manage-header h2 {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 600;
            letter-spacing: -0.025em;
        }

        .close-btn {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: hsl(var(--primary-foreground) / 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid hsl(var(--primary-foreground) / 0.2);
            color: hsl(var(--primary-foreground));
            font-size: 1.25rem;
            cursor: pointer;
            border-radius: 50%;
            width: 2rem;
            height: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
            z-index: 10;
        }

        .close-btn:hover {
            background: hsl(var(--primary-foreground) / 0.2);
            transform: rotate(90deg);
        }

        .manage-body {
            padding: 32px;
            overflow-y: auto;
            flex: 1;
        }

        .import-section {
            margin-bottom: 0;
        }

        .import-section h3 {
            margin: 0 0 16px 0;
            font-size: 18px;
            font-weight: 600;
            color: hsl(var(--foreground));
            letter-spacing: -0.025em;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        #importKeys {
            width: 100%;
            padding: 12px;
            background: hsl(var(--background));
            border: 1px solid hsl(var(--input));
            border-radius: var(--radius);
            font-size: 14px;
            resize: vertical;
            transition: all 0.2s;
            line-height: 1.6;
            min-height: 150px;
            color: hsl(var(--foreground));
        }

        #importKeys:focus {
            outline: none;
            border-color: hsl(var(--ring));
            box-shadow: 0 0 0 3px hsl(var(--ring) / 0.1);
        }

        .import-btn {
            margin-top: 1rem;
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
            border: none;
            border-radius: var(--radius);
            padding: 0.625rem 1.25rem;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }

        .import-btn:hover {
            background: hsl(var(--primary) / 0.9);
            transform: translateY(-1px);
        }

        .import-btn:active {
            transform: translateY(0);
        }

        .import-result {
            margin-top: 16px;
            padding: 12px 16px;
            border-radius: var(--radius);
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .import-result.success {
            background: hsl(var(--success) / 0.1);
            color: hsl(var(--success));
            border: 1px solid hsl(var(--success) / 0.2);
        }

        .import-result.error {
            background: hsl(var(--destructive) / 0.1);
            color: hsl(var(--destructive));
            border: 1px solid hsl(var(--destructive) / 0.2);
        }

        .keys-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .keys-list::-webkit-scrollbar {
            width: 8px;
        }

        .keys-list::-webkit-scrollbar-track {
            background: transparent;
        }

        .keys-list::-webkit-scrollbar-thumb {
            background: hsl(var(--border));
            border-radius: 100px;
        }

        .keys-list::-webkit-scrollbar-thumb:hover {
            background: hsl(var(--muted-foreground));
        }

        /* 分页样式 */
        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 12px;
            margin-top: 24px;
            padding: 24px 0;
            flex-wrap: wrap;
        }

        .pagination-btn {
            background: hsl(var(--card));
            color: hsl(var(--foreground));
            border: 1px solid hsl(var(--border));
            border-radius: var(--radius);
            padding: 10px 16px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            min-width: 40px;
        }

        .pagination-btn:hover:not(:disabled) {
            background: hsl(0 0% 40%);
            color: hsl(var(--background));
            border-color: hsl(0 0% 40%);
            transform: translateY(-1px);
        }

        .pagination-btn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
        }

        .pagination-btn.active {
            background: hsl(0 0% 40%);
            color: hsl(var(--background));
            border-color: hsl(0 0% 40%);
        }

        .pagination-info {
            font-size: 14px;
            color: hsl(var(--muted-foreground));
            font-weight: 500;
            padding: 0 16px;
        }

        .pagination-controls {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .pagination-select {
            padding: 8px 12px;
            background: hsl(var(--background));
            border: 1px solid hsl(var(--border));
            border-radius: var(--radius);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            color: hsl(var(--foreground));
            transition: all 0.2s;
        }

        .pagination-select:hover {
            border-color: hsl(var(--ring));
        }

        .pagination-select:focus {
            outline: none;
            border-color: hsl(var(--ring));
            box-shadow: 0 0 0 3px hsl(var(--ring) / 0.1);
        }

        .pagination-jump {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .pagination-jump input {
            width: 60px;
            padding: 8px 12px;
            background: hsl(var(--background));
            border: 1px solid hsl(var(--border));
            border-radius: var(--radius);
            font-size: 14px;
            text-align: center;
            color: hsl(var(--foreground));
            font-family: 'Fira Code', monospace;
        }

        .pagination-jump input:focus {
            outline: none;
            border-color: hsl(var(--ring));
            box-shadow: 0 0 0 3px hsl(var(--ring) / 0.1);
        }

        .pagination-jump button {
            padding: 8px 16px;
            background: hsl(var(--primary));
            color: hsl(var(--primary-foreground));
            border: none;
            border-radius: var(--radius);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .pagination-jump button:hover {
            background: hsl(var(--primary) / 0.9);
        }

        .key-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            background: hsl(var(--muted) / 0.5);
            border-radius: var(--radius);
            margin-bottom: 12px;
            transition: all 0.2s;
            border: 1px solid transparent;
        }

        .key-item:hover {
            background: hsl(var(--muted));
            border-color: hsl(var(--border));
        }

        .key-info { flex: 1; }

        .key-id {
            font-weight: 600;
            color: hsl(var(--foreground));
            font-size: 14px;
            margin-bottom: 6px;
        }

        .key-masked {
            color: hsl(var(--muted-foreground));
            font-size: 13px;
        }

        .delete-btn {
            background: hsl(var(--destructive));
            color: hsl(var(--destructive-foreground));
            border: none;
            border-radius: var(--radius);
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }

        .delete-btn:hover {
            background: hsl(var(--destructive) / 0.9);
            transform: scale(1.05);
        }

        .delete-btn:active {
            transform: scale(0.98);
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            body { padding: 12px; }
            .header { padding: 24px; }
            .header h1 { font-size: 24px; }
            .stats-cards {
                grid-template-columns: 1fr;
                padding: 24px;
            }
            .table-container {
                padding: 0 16px 24px;
                overflow-x: scroll;
            }
            table {
                transform: scale(1);
                margin-bottom: 24px;
            }
            .manage-btn {
                position: static;
                margin-top: 16px;
                width: 100%;
            }
            .refresh-btn {
                bottom: 16px;
                right: 16px;
                padding: 10px 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>
                <iconify-icon icon="lucide:rocket"></iconify-icon>
                Droid API 余额监控看板
            </h1>
            <div class="update-time" id="updateTime">正在加载...</div>
            <div style="margin-top: 8px; font-size: 14px; opacity: 0.85;">
                <span id="autoRefreshStatus">自动刷新: 启用中 | 下次刷新: <span id="headerNextRefresh">计算中...</span></span>
            </div>
            <button class="manage-btn" onclick="toggleManagePanel()">
                <iconify-icon icon="lucide:settings"></iconify-icon>
                管理密钥
            </button>
        </div>

        <!-- Management Panel -->
        <div class="manage-panel" id="managePanel" style="display: none;">
            <div class="manage-content">
                <button class="close-btn" onclick="toggleManagePanel()">
                    <iconify-icon icon="lucide:x"></iconify-icon>
                </button>
                <div class="manage-header">
                    <h2>批量导入密钥</h2>
                </div>
                <div class="manage-body">
                    <div class="import-section">
                        <h3>
                            <iconify-icon icon="lucide:package"></iconify-icon>
                            添加 API Key
                        </h3>
                        <p style="color: hsl(var(--muted-foreground)); font-size: 14px; margin-bottom: 16px;">
                            每行粘贴一个 API Key，支持批量导入数百个密钥
                        </p>
                        <textarea id="importKeys" placeholder="每行粘贴一个 API Key&#10;fk-xxxxx&#10;fk-yyyyy&#10;fk-zzzzz" rows="10"></textarea>
                        <button class="import-btn" onclick="importKeys()">
                            <span id="importSpinner" style="display: none;" class="spinner"></span>
                            <iconify-icon icon="lucide:upload" id="importIcon"></iconify-icon>
                            <span id="importText">导入密钥</span>
                        </button>
                        <div id="importResult" class="import-result"></div>
                    </div>

                    <div class="import-section" style="margin-top: 32px; padding-top: 32px; border-top: 1px solid hsl(var(--border));">
                        <h3>
                            <iconify-icon icon="lucide:copy"></iconify-icon>
                            重复密钥检测
                        </h3>
                        <p style="color: hsl(var(--muted-foreground)); font-size: 14px; margin-bottom: 16px;">
                            检测并清理数据库中重复的API密钥(保留最早导入的一个)
                        </p>
                        <button class="import-btn" onclick="checkDuplicates()" style="background: hsl(var(--warning)); color: hsl(var(--warning-foreground));">
                            <span id="checkDupSpinner" style="display: none;" class="spinner"></span>
                            <iconify-icon icon="lucide:search" id="checkDupIcon"></iconify-icon>
                            <span id="checkDupText">检测重复密钥</span>
                        </button>
                        <div id="duplicateResult" class="import-result" style="display: none;"></div>
                        <div id="duplicateList" style="margin-top: 16px; display: none;"></div>
                    </div>

                    <div class="import-section" style="margin-top: 32px; padding-top: 32px; border-top: 1px solid hsl(var(--border));">
                        <h3>
                            <iconify-icon icon="lucide:timer"></iconify-icon>
                            自动刷新设置
                        </h3>
                        <p style="color: hsl(var(--muted-foreground)); font-size: 14px; margin-bottom: 16px;">
                            设置自动刷新间隔时间（分钟）
                        </p>
                        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                            <input type="number" id="refreshInterval" min="1" max="1440" value="30"
                                   style="width: 120px; padding: 10px 12px; background: hsl(var(--background)); border: 1px solid hsl(var(--input)); border-radius: var(--radius); font-size: 14px; font-family: 'Fira Code', monospace; color: hsl(var(--foreground));">
                            <span style="color: hsl(var(--muted-foreground)); font-size: 14px;">分钟</span>
                        </div>
                        <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                            <button class="import-btn" onclick="saveRefreshSettings()" style="background: hsl(var(--success)); color: hsl(var(--success-foreground));">
                                <iconify-icon icon="lucide:save"></iconify-icon>
                                保存设置
                            </button>
                            <button class="import-btn" onclick="toggleAutoRefresh()" id="toggleRefreshBtn" style="background: hsl(var(--warning)); color: hsl(var(--warning-foreground));">
                                <iconify-icon icon="lucide:pause" id="toggleRefreshIcon"></iconify-icon>
                                <span id="toggleRefreshText">暂停自动刷新</span>
                            </button>
                        </div>
                        <div id="refreshStatus" style="color: hsl(var(--muted-foreground)); font-size: 14px; font-weight: 500;">
                            下次刷新: <span id="nextRefreshDisplay">计算中...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="stats-cards" id="statsCards"></div>

        <div class="table-container">
            <div id="tableContent">
                <div class="loading">正在加载数据...</div>
            </div>
        </div>
    </div>

    <!-- 清理无效密钥弹窗 -->
    <div class="export-zero-modal" id="exportInvalidModal" style="display: none;">
        <div class="export-zero-content">
            <button class="close-btn" onclick="closeExportInvalidModal()">
                <iconify-icon icon="lucide:x"></iconify-icon>
            </button>
            <div class="export-zero-header" style="background: hsl(var(--warning));">
                <h2>
                    <iconify-icon icon="lucide:trash-2"></iconify-icon>
                    清理无效密钥
                </h2>
            </div>
            <div class="export-zero-body">
                <div class="export-zero-info" id="exportInvalidInfo">
                    正在分析密钥状态...
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;">
                    <div style="padding: 16px; background: hsl(var(--muted) / 0.3); border-radius: var(--radius); border: 1px solid hsl(var(--border));">
                        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: hsl(var(--destructive)); display: flex; align-items: center; gap: 8px;">
                            <iconify-icon icon="lucide:alert-circle"></iconify-icon>
                            失效密钥 (<span id="failedCount">0</span>)
                        </h4>
                        <p style="font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0;">HTTP 401等错误，可能已被官方删除</p>
                    </div>
                    <div style="padding: 16px; background: hsl(var(--muted) / 0.3); border-radius: var(--radius); border: 1px solid hsl(var(--border));">
                        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: hsl(var(--warning)); display: flex; align-items: center; gap: 8px;">
                            <iconify-icon icon="lucide:battery-low"></iconify-icon>
                            零额度密钥 (<span id="zeroCount">0</span>)
                        </h4>
                        <p style="font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0;">剩余额度 ≤ 0，已无可用额度</p>
                    </div>
                </div>
                <textarea
                    class="export-zero-textarea"
                    id="exportInvalidTextarea"
                    readonly
                    placeholder="暂无无效密钥"
                    style="margin-top: 16px;">
                </textarea>
            </div>
            <div class="export-zero-actions">
                <button class="export-action-btn copy" onclick="copyInvalidKeys()">
                    <iconify-icon icon="lucide:copy"></iconify-icon>
                    <span id="copyInvalidBtnText">复制全部</span>
                </button>
                <button class="export-action-btn clear" onclick="clearInvalidKeysFromModal()">
                    <span class="spinner" style="display: none;" id="modalInvalidClearSpinner"></span>
                    <iconify-icon icon="lucide:trash-2" id="modalInvalidClearIcon"></iconify-icon>
                    <span id="modalInvalidClearBtnText">清除这些密钥</span>
                </button>
            </div>
        </div>
    </div>

    <!-- 导出有效密钥弹窗 -->
    <div class="export-zero-modal" id="exportValidModal" style="display: none;">
        <div class="export-zero-content">
            <button class="close-btn" onclick="closeExportValidModal()">
                <iconify-icon icon="lucide:x"></iconify-icon>
            </button>
            <div class="export-zero-header" style="background: hsl(var(--success));">
                <h2>
                    <iconify-icon icon="lucide:check-circle"></iconify-icon>
                    有效密钥列表
                </h2>
            </div>
            <div class="export-zero-body">
                <div class="export-zero-info" id="exportValidInfo">
                    正在加载有效密钥...
                </div>
                <textarea
                    class="export-zero-textarea"
                    id="exportValidTextarea"
                    readonly
                    placeholder="暂无有效密钥">
                </textarea>
            </div>
            <div class="export-zero-actions">
                <button class="export-action-btn copy" onclick="copyValidKeys()">
                    <iconify-icon icon="lucide:copy"></iconify-icon>
                    <span id="copyValidBtnText">复制全部</span>
                </button>
            </div>
        </div>
    </div>

    <button class="export-valid-btn" onclick="openExportValidModal()">
        <iconify-icon icon="lucide:check-circle"></iconify-icon>
        <span>导出有效密钥</span>
    </button>

    <button class="export-zero-btn" onclick="openExportInvalidModal()">
        <iconify-icon icon="lucide:trash-2"></iconify-icon>
        <span>清理无效密钥</span>
    </button>

    <button class="refresh-btn" onclick="loadData()">
        <span class="spinner" style="display: none;" id="spinner"></span>
        <iconify-icon icon="lucide:refresh-cw" id="refreshIcon"></iconify-icon>
        <span id="btnText">刷新数据</span>
    </button>

    <script>
        // 分页变量
        let currentPage = 1;
        let itemsPerPage = 10;
        let allData = null;

        // 自动刷新变量
        let autoRefreshInterval = null;
        let autoRefreshMinutes = 30; // 默认30分钟
        let nextRefreshTime = null;
        let countdownInterval = null;

        function formatNumber(num) {
            if (num === undefined || num === null) {
                return '0';
            }
            return new Intl.NumberFormat('en-US').format(num);
        }

        function formatPercentage(ratio) {
            if (ratio === undefined || ratio === null) {
                return '0.00%';
            }
            return (ratio * 100).toFixed(2) + '%';
        }

        function loadData() {
            const spinner = document.getElementById('spinner');
            const icon = document.getElementById('refreshIcon');
            const btnText = document.getElementById('btnText');

            spinner.style.display = 'inline-block';
            icon.style.display = 'none';
            btnText.textContent = '加载中...';

            // 先快速加载密钥列表，不等待额度数据
            fetch('/api/keys')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('无法加载密钥列表: ' + response.statusText);
                    }
                    return response.json();
                })
                .then(keys => {
                    // 立即显示密钥列表的占位符
                    const beijingTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
                    const timeStr = beijingTime.toISOString().replace('T', ' ').substring(0, 19);

                    allData = {
                        update_time: timeStr,
                        total_count: keys.length,
                        totals: {
                            total_totalAllowance: 0,
                            total_orgTotalTokensUsed: 0
                        },
                        data: keys.map(k => ({
                            id: k.id,
                            key: k.masked,
                            loading: true,
                            totalAllowance: 0,
                            orgTotalTokensUsed: 0,
                            startDate: '加载中...',
                            endDate: '加载中...',
                            usedRatio: 0
                        }))
                    };

                    // 立即渲染表格骨架
                    displayData(allData);

                    // 然后异步加载每个密钥的额度数据
                    return loadUsageDataProgressively(keys);
                })
                .catch(error => {
                    document.getElementById('tableContent').innerHTML = \`<div class="error"><iconify-icon icon="lucide:alert-circle"></iconify-icon> 加载失败: \${error.message}</div>\`;
                    document.getElementById('updateTime').textContent = "加载失败";
                })
                .finally(() => {
                    spinner.style.display = 'none';
                    icon.style.display = 'inline-block';
                    btnText.textContent = '刷新数据';
                });
        }

        // 渐进式加载额度数据
        async function loadUsageDataProgressively(keys) {
            let completedCount = 0;
            const totalCount = keys.length;

            console.log('[loadUsageDataProgressively] 开始加载 ' + totalCount + ' 个密钥的额度数据');

            // 并发加载，但限制并发数量
            const concurrency = 5; // 同时最多5个请求
            const results = [];

            for (let i = 0; i < keys.length; i += concurrency) {
                const batch = keys.slice(i, i + concurrency);
                console.log('[loadUsageDataProgressively] 处理批次 ' + (Math.floor(i / concurrency) + 1) + '，包含 ' + batch.length + ' 个密钥');

                const batchPromises = batch.map(async (keyEntry) => {
                    console.log('[Key ' + keyEntry.id + '] 开始加载');
                    try {
                        // 调用后端 API 获取使用数据(后端会代理到 Factory.ai)
                        console.log('[Key ' + keyEntry.id + '] 获取额度数据...');
                        const usageResponse = await fetch('/api/keys/' + keyEntry.id + '/usage');
                        console.log('[Key ' + keyEntry.id + '] 额度数据响应状态: ' + usageResponse.status);

                        if (!usageResponse.ok) {
                            const errorData = await usageResponse.json();
                            console.error('[Key ' + keyEntry.id + '] 额度API返回错误: ' + usageResponse.status + ', 内容: ' + JSON.stringify(errorData));
                            return {
                                id: keyEntry.id,
                                key: keyEntry.masked,
                                error: 'HTTP ' + usageResponse.status
                            };
                        }

                        const apiData = await usageResponse.json();
                        console.log('[Key ' + keyEntry.id + '] 额度数据结构:', Object.keys(apiData));

                        if (!apiData.usage || !apiData.usage.standard) {
                            console.error('[Key ' + keyEntry.id + '] 额度数据结构无效:', apiData);
                            return {
                                id: keyEntry.id,
                                key: keyEntry.masked,
                                error: 'Invalid response'
                            };
                        }

                        const usageInfo = apiData.usage;
                        const standardUsage = usageInfo.standard;

                        const formatDate = (timestamp) => {
                            if (!timestamp && timestamp !== 0) return 'N/A';
                            try {
                                return new Date(timestamp).toISOString().split('T')[0];
                            } catch (e) {
                                return 'Invalid Date';
                            }
                        };

                        console.log('[Key ' + keyEntry.id + '] ✅ 加载成功 - 总额度: ' + standardUsage.totalAllowance + ', 已使用: ' + standardUsage.orgTotalTokensUsed);

                        return {
                            id: keyEntry.id,
                            key: keyEntry.masked,
                            startDate: formatDate(usageInfo.startDate),
                            endDate: formatDate(usageInfo.endDate),
                            orgTotalTokensUsed: standardUsage.orgTotalTokensUsed,
                            totalAllowance: standardUsage.totalAllowance,
                            usedRatio: standardUsage.usedRatio,
                        };
                    } catch (error) {
                        console.error('[Key ' + keyEntry.id + '] ❌ 加载失败:', error);
                        console.error('[Key ' + keyEntry.id + '] 错误详情:', {
                            name: error.name,
                            message: error.message,
                            stack: error.stack
                        });
                        return {
                            id: keyEntry.id,
                            key: keyEntry.masked,
                            error: error.message || 'Failed to fetch'
                        };
                    }
                });

                // 等待当前批次完成
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);

                // 更新已完成的数据
                completedCount += batchResults.length;
                console.log('[loadUsageDataProgressively] 已完成 ' + completedCount + '/' + totalCount);

                // 更新 allData
                batchResults.forEach(result => {
                    const index = allData.data.findIndex(item => item.id === result.id);
                    if (index !== -1) {
                        allData.data[index] = result;
                    }
                });

                // 重新计算总计
                const validResults = allData.data.filter(r => !r.error && !r.loading);
                allData.totals = {
                    total_totalAllowance: validResults.reduce((sum, r) => sum + (r.totalAllowance || 0), 0),
                    total_orgTotalTokensUsed: validResults.reduce((sum, r) => sum + (r.orgTotalTokensUsed || 0), 0)
                };

                // 实时更新界面
                displayData(allData);

                // 更新进度提示
                document.getElementById('updateTime').textContent = '加载中: ' + completedCount + '/' + totalCount + ' | 共 ' + totalCount + ' 个API Key';
            }

            console.log('[loadUsageDataProgressively] ✅ 全部加载完成！成功: ' + results.filter(r => !r.error).length + ', 失败: ' + results.filter(r => r.error).length);

            // 全部完成后重置自动刷新
            resetAutoRefresh();

            return results;
        }

        function displayData(data) {
            allData = data; // 保存数据

            // 如果还有加载中的项，显示进度
            const loadingCount = data.data.filter(item => item.loading).length;
            if (loadingCount > 0) {
                document.getElementById('updateTime').textContent = '加载中: ' + (data.total_count - loadingCount) + '/' + data.total_count + ' | 共 ' + data.total_count + ' 个API Key';
            } else {
                document.getElementById('updateTime').textContent = '最后更新: ' + data.update_time + ' | 共 ' + data.total_count + ' 个API Key';
            }

            const totalAllowance = data.totals.total_totalAllowance;
            const totalUsed = data.totals.total_orgTotalTokensUsed;
            const totalRemaining = totalAllowance - totalUsed;
            const overallRatio = totalAllowance > 0 ? totalUsed / totalAllowance : 0;

            // 计算有效和无效密钥数量（排除加载中和错误的）
            const completedData = data.data.filter(item => !item.loading && !item.error);
            const validKeysCount = completedData.filter(item => {
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining > 0;
            }).length;
            const invalidKeysCount = completedData.length - validKeysCount;

            const statsCards = document.getElementById('statsCards');
            statsCards.innerHTML = \`
                <div class="stat-card"><div class="label">总计额度 (Total Allowance)</div><div class="value">\${formatNumber(totalAllowance)}</div></div>
                <div class="stat-card"><div class="label">已使用 (Total Used)</div><div class="value">\${formatNumber(totalUsed)}</div></div>
                <div class="stat-card"><div class="label">剩余额度 (Remaining)</div><div class="value">\${formatNumber(totalRemaining)}</div></div>
                <div class="stat-card"><div class="label">使用百分比 (Usage %)</div><div class="value">\${formatPercentage(overallRatio)}</div></div>
                <div class="stat-card"><div class="label">有效密钥 (Valid Keys)</div><div class="value" style="color: hsl(var(--success));">\${validKeysCount}\${loadingCount > 0 ? '<span style="font-size: 0.875rem; opacity: 0.7; margin-left: 0.25rem;">(' + completedData.length + '/' + data.total_count + ')</span>' : ''}</div></div>
                <div class="stat-card"><div class="label">无效密钥 (Invalid Keys)</div><div class="value" style="color: hsl(var(--destructive));">\${invalidKeysCount}</div></div>
            \`;

            renderTable();
        }

        function renderTable() {
            if (!allData) return;

            const data = allData;
            const totalPages = Math.ceil(data.data.length / itemsPerPage);
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const pageData = data.data.slice(startIndex, endIndex);

            const totalAllowance = data.totals.total_totalAllowance;
            const totalUsed = data.totals.total_orgTotalTokensUsed;
            const totalRemaining = totalAllowance - totalUsed;
            const overallRatio = totalAllowance > 0 ? totalUsed / totalAllowance : 0;

            let tableHTML = \`
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>API Key</th>
                            <th>开始时间</th>
                            <th>结束时间</th>
                            <th class="number">总计额度</th>
                            <th class="number">已使用</th>
                            <th class="number">剩余额度</th>
                            <th class="number">使用百分比</th>
                            <th style="text-align: center; width: 100px;">操作</th>
                        </tr>
                    </thead>
                    <tbody>\`;

            // 总计行放在第一行
            tableHTML += \`
                <tr class="total-row">
                    <td colspan="4">总计 (SUM)</td>
                    <td class="number">\${formatNumber(totalAllowance)}</td>
                    <td class="number">\${formatNumber(totalUsed)}</td>
                    <td class="number">\${formatNumber(totalRemaining)}</td>
                    <td class="number">\${formatPercentage(overallRatio)}</td>
                    <td></td>
                </tr>\`;

            // 数据行 - 只显示当前页
            pageData.forEach(item => {
                if (item.loading) {
                    // 加载中状态
                    tableHTML += \`
                        <tr style="opacity: 0.6;">
                            <td>\${item.id}</td>
                            <td class="key-cell" title="\${item.key}">\${item.key}</td>
                            <td colspan="6" style="text-align: center; color: hsl(var(--muted-foreground));"><span class="spinner" style="display: inline-block; margin-right: 8px;"></span>加载额度数据中...</td>
                            <td style="text-align: center;">
                                <button class="table-delete-btn" onclick="deleteKeyFromTable('\${item.id}')" style="background: hsl(var(--destructive));" title="删除密钥">
                                    <iconify-icon icon="lucide:trash-2" style="font-size: 12px;"></iconify-icon>
                                </button>
                            </td>
                        </tr>\`;
                } else if (item.error) {
                    tableHTML += \`
                        <tr>
                            <td>\${item.id}</td>
                            <td class="key-cell" title="\${item.key}">\${item.key}</td>
                            <td colspan="6" class="error-row">
                                加载失败: \${item.error}
                            </td>
                            <td style="text-align: center;">
                                <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                                    <button class="table-delete-btn" onclick="refreshSingleKey('\${item.id}')" style="background: hsl(var(--warning));" title="重试">
                                        <iconify-icon icon="lucide:refresh-cw" style="font-size: 12px;"></iconify-icon>
                                    </button>
                                    <button class="table-delete-btn" onclick="deleteKeyFromTable('\${item.id}')" style="background: hsl(var(--destructive));" title="删除密钥">
                                        <iconify-icon icon="lucide:trash-2" style="font-size: 12px;"></iconify-icon>
                                    </button>
                                </div>
                            </td>
                        </tr>\`;
                } else {
                    const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                    tableHTML += \`
                        <tr>
                            <td>\${item.id}</td>
                            <td class="key-cell" title="\${item.key}">\${item.key}</td>
                            <td>\${item.startDate}</td>
                            <td>\${item.endDate}</td>
                            <td class="number">\${formatNumber(item.totalAllowance)}</td>
                            <td class="number">\${formatNumber(item.orgTotalTokensUsed)}</td>
                            <td class="number">\${formatNumber(remaining)}</td>
                            <td class="number">\${formatPercentage(item.usedRatio)}</td>
                            <td style="text-align: center;">
                                <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                                    <button class="table-delete-btn" onclick="refreshSingleKey('\${item.id}')" style="background: hsl(var(--primary));" title="刷新此密钥">
                                        <iconify-icon icon="lucide:refresh-cw" style="font-size: 12px;"></iconify-icon>
                                    </button>
                                    <button class="table-delete-btn" onclick="deleteKeyFromTable('\${item.id}')" style="background: hsl(var(--destructive));" title="删除密钥">
                                        <iconify-icon icon="lucide:trash-2" style="font-size: 12px;"></iconify-icon>
                                    </button>
                                </div>
                            </td>
                        </tr>\`;
                }
            });

            tableHTML += \`
                    </tbody>
                </table>\`;

            // 添加分页控件
            if (totalPages > 1 || data.data.length > 10) {
                tableHTML += \`<div class="pagination">\`;

                // 每页条数选择
                tableHTML += \`
                    <div class="pagination-controls">
                        <label style="font-size: 14px; color: hsl(var(--muted-foreground)); font-weight: 500;">每页显示:</label>
                        <select class="pagination-select" onchange="changeItemsPerPage(this.value)">
                            <option value="10" \${itemsPerPage === 10 ? 'selected' : ''}>10 条</option>
                            <option value="20" \${itemsPerPage === 20 ? 'selected' : ''}>20 条</option>
                            <option value="50" \${itemsPerPage === 50 ? 'selected' : ''}>50 条</option>
                            <option value="100" \${itemsPerPage === 100 ? 'selected' : ''}>100 条</option>
                            <option value="\${data.data.length}" \${itemsPerPage === data.data.length ? 'selected' : ''}>全部 (\${data.data.length} 条)</option>
                        </select>
                    </div>
                \`;

                // 上一页按钮
                tableHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}><iconify-icon icon="lucide:chevron-left"></iconify-icon> 上一页</button>\`;

                // 页码信息
                tableHTML += \`<span class="pagination-info">第 \${currentPage} / \${totalPages} 页 (共 \${data.data.length} 条)</span>\`;

                // 下一页按钮
                tableHTML += \`<button class="pagination-btn" onclick="changePage(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}>下一页 <iconify-icon icon="lucide:chevron-right"></iconify-icon></button>\`;

                // 跳转页面
                tableHTML += \`
                    <div class="pagination-jump">
                        <label style="font-size: 14px; color: hsl(var(--muted-foreground)); font-weight: 500;">跳转到:</label>
                        <input type="number" id="jumpPageInput" min="1" max="\${totalPages}" value="\${currentPage}" onkeypress="if(event.key==='Enter')jumpToPage()">
                        <button onclick="jumpToPage()">GO</button>
                    </div>
                \`;

                tableHTML += \`</div>\`;
            }

            document.getElementById('tableContent').innerHTML = tableHTML;
        }

        function changeItemsPerPage(value) {
            itemsPerPage = parseInt(value);
            currentPage = 1;
            renderTable();
        }

        function jumpToPage() {
            const input = document.getElementById('jumpPageInput');
            const page = parseInt(input.value);
            if (allData) {
                const totalPages = Math.ceil(allData.data.length / itemsPerPage);
                if (page >= 1 && page <= totalPages) {
                    changePage(page);
                } else {
                    alert('请输入有效的页码 (1-' + totalPages + ')');
                    input.value = currentPage;
                }
            }
        }

        function changePage(page) {
            if (!allData) return;
            const totalPages = Math.ceil(allData.data.length / itemsPerPage);
            if (page < 1 || page > totalPages) return;

            currentPage = page;
            renderTable();

            // 滚动到表格顶部
            document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Toggle manage panel
        function toggleManagePanel() {
            const panel = document.getElementById('managePanel');
            if (panel.style.display === 'none') {
                panel.style.display = 'flex';
            } else {
                panel.style.display = 'none';
            }
        }

        // Import keys
        async function importKeys() {
            const textarea = document.getElementById('importKeys');
            const spinner = document.getElementById('importSpinner');
            const icon = document.getElementById('importIcon');
            const text = document.getElementById('importText');
            const result = document.getElementById('importResult');

            const keysText = textarea.value.trim();
            if (!keysText) {
                result.className = 'import-result error';
                result.innerHTML = '<iconify-icon icon="lucide:alert-circle"></iconify-icon><span>请输入至少一个 API Key</span>';
                return;
            }

            const keys = keysText.split('\\n').map(k => k.trim()).filter(k => k.length > 0);

            spinner.style.display = 'inline-block';
            icon.style.display = 'none';
            text.textContent = '导入中...';
            result.textContent = '';
            result.className = 'import-result';

            try {
                const response = await fetch('/api/keys/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keys })
                });

                const data = await response.json();

                if (response.ok) {
                    let message = '成功导入 ' + data.success + ' 个密钥';
                    if (data.duplicates > 0) {
                        message += ', ' + data.duplicates + ' 个重复已跳过';
                    }
                    if (data.failed > 0) {
                        message += ', ' + data.failed + ' 个失败';
                    }

                    result.className = 'import-result success';
                    result.innerHTML = \`<iconify-icon icon="lucide:check-circle"></iconify-icon><span>\${message}</span>\`;

                    // 如果有重复的密钥,显示详细信息
                    if (data.duplicates > 0 && data.duplicateKeys && data.duplicateKeys.length > 0) {
                        const duplicateList = data.duplicateKeys.slice(0, 5).join(', ');
                        const moreText = data.duplicateKeys.length > 5 ? ' 等 ' + data.duplicateKeys.length + ' 个' : '';
                        result.innerHTML += \`<div style="margin-top: 8px; font-size: 12px; opacity: 0.9;">重复密钥: \${duplicateList}\${moreText}</div>\`;
                    }

                    textarea.value = '';
                    // 关闭弹窗并刷新主页面数据
                    setTimeout(() => {
                        toggleManagePanel();
                        loadData();
                    }, 2500);
                } else {
                    result.className = 'import-result error';
                    result.innerHTML = \`<iconify-icon icon="lucide:alert-circle"></iconify-icon><span>导入失败: \${data.error}</span>\`;
                }
            } catch (error) {
                result.className = 'import-result error';
                result.innerHTML = \`<iconify-icon icon="lucide:alert-circle"></iconify-icon><span>导入失败: \${error.message}</span>\`;
            } finally {
                spinner.style.display = 'none';
                icon.style.display = 'inline-block';
                text.textContent = '导入密钥';
            }
        }

        // Delete key from table - 从表格中删除密钥
        async function deleteKeyFromTable(id) {
            if (!confirm('确定要删除这个密钥吗？删除后需要刷新页面查看更新。')) {
                return;
            }

            try {
                const response = await fetch(\`/api/keys/\${id}\`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    // 删除成功后重新加载数据
                    loadData();
                } else {
                    const data = await response.json();
                    alert('删除失败: ' + data.error);
                }
            } catch (error) {
                alert('删除失败: ' + error.message);
            }
        }

        // 刷新单个密钥的数据
        async function refreshSingleKey(keyId) {
            if (!allData) return;

            // 找到这个密钥在 allData 中的位置
            const index = allData.data.findIndex(item => item.id === keyId);
            if (index === -1) return;

            // 先获取密钥的基本信息
            try {
                const keyInfoResponse = await fetch('/api/keys');
                if (!keyInfoResponse.ok) {
                    throw new Error('无法获取密钥信息');
                }
                const allKeys = await keyInfoResponse.json();
                const keyInfo = allKeys.find(k => k.id === keyId);

                if (!keyInfo) {
                    alert('找不到该密钥');
                    return;
                }

                // 设置为加载中状态
                allData.data[index] = {
                    id: keyId,
                    key: keyInfo.masked,
                    loading: true,
                    totalAllowance: 0,
                    orgTotalTokensUsed: 0,
                    startDate: '加载中...',
                    endDate: '加载中...',
                    usedRatio: 0
                };

                // 立即更新界面
                displayData(allData);

                // 调用后端 API 获取使用数据
                const usageResponse = await fetch('/api/keys/' + keyId + '/usage');

                if (!usageResponse.ok) {
                    allData.data[index] = {
                        id: keyId,
                        key: keyInfo.masked,
                        error: 'HTTP ' + usageResponse.status
                    };
                    displayData(allData);
                    return;
                }

                const apiData = await usageResponse.json();
                if (!apiData.usage || !apiData.usage.standard) {
                    allData.data[index] = {
                        id: keyId,
                        key: keyInfo.masked,
                        error: 'Invalid response'
                    };
                    displayData(allData);
                    return;
                }

                const usageInfo = apiData.usage;
                const standardUsage = usageInfo.standard;

                const formatDate = (timestamp) => {
                    if (!timestamp && timestamp !== 0) return 'N/A';
                    try {
                        return new Date(timestamp).toISOString().split('T')[0];
                    } catch (e) {
                        return 'Invalid Date';
                    }
                };

                // 更新数据
                allData.data[index] = {
                    id: keyId,
                    key: keyInfo.masked,
                    startDate: formatDate(usageInfo.startDate),
                    endDate: formatDate(usageInfo.endDate),
                    orgTotalTokensUsed: standardUsage.orgTotalTokensUsed,
                    totalAllowance: standardUsage.totalAllowance,
                    usedRatio: standardUsage.usedRatio,
                };

                // 重新计算总计
                const validResults = allData.data.filter(r => !r.error && !r.loading);
                allData.totals = {
                    total_totalAllowance: validResults.reduce((sum, r) => sum + (r.totalAllowance || 0), 0),
                    total_orgTotalTokensUsed: validResults.reduce((sum, r) => sum + (r.orgTotalTokensUsed || 0), 0)
                };

                // 更新界面
                displayData(allData);

            } catch (error) {
                console.error(\`刷新密钥 \${keyId} 失败:\`, error);
                allData.data[index] = {
                    id: keyId,
                    key: allData.data[index].key,
                    error: error.message || 'Failed to fetch'
                };
                displayData(allData);
            }
        }

        // Check for duplicate keys - 检测重复密钥
        async function checkDuplicates() {
            const spinner = document.getElementById('checkDupSpinner');
            const icon = document.getElementById('checkDupIcon');
            const text = document.getElementById('checkDupText');
            const result = document.getElementById('duplicateResult');
            const listDiv = document.getElementById('duplicateList');

            spinner.style.display = 'inline-block';
            icon.style.display = 'none';
            text.textContent = '检测中...';
            result.style.display = 'none';
            listDiv.style.display = 'none';

            try {
                const response = await fetch('/api/keys/duplicates');
                if (!response.ok) {
                    throw new Error('检测失败');
                }

                const data = await response.json();

                if (data.duplicates.length === 0) {
                    result.className = 'import-result success';
                    result.innerHTML = '<iconify-icon icon="lucide:check-circle"></iconify-icon><span>太好了！没有发现重复密钥</span>';
                    result.style.display = 'flex';
                } else {
                    result.className = 'import-result error';
                    result.innerHTML = \`<iconify-icon icon="lucide:alert-circle"></iconify-icon><span>发现 \${data.duplicates.length} 组重复密钥(共 \${data.duplicates.reduce((sum, d) => sum + d.count, 0)} 个密钥)</span>\`;
                    result.style.display = 'flex';

                    // Display duplicate details
                    let listHTML = '<div style="max-height: 300px; overflow-y: auto; background: hsl(var(--muted) / 0.3); border: 1px solid hsl(var(--border)); border-radius: var(--radius); padding: 16px;">';
                    listHTML += '<div style="font-weight: 600; margin-bottom: 12px; color: hsl(var(--foreground));">重复密钥详情:</div>';

                    data.duplicates.forEach((dup, index) => {
                        listHTML += \`
                            <div style="padding: 12px; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: var(--radius); margin-bottom: 8px;">
                                <div style="font-size: 13px; color: hsl(var(--muted-foreground)); margin-bottom: 6px;">
                                    <strong>密钥:</strong> <code style="font-family: 'Fira Code', monospace; background: hsl(var(--muted) / 0.5); padding: 2px 6px; border-radius: 3px;">\${dup.key}</code>
                                </div>
                                <div style="font-size: 13px; color: hsl(var(--muted-foreground));">
                                    <strong>重复次数:</strong> \${dup.count} 次 | <strong>ID:</strong> \${dup.ids.join(', ')}
                                </div>
                            </div>
                        \`;
                    });

                    listHTML += '</div>';
                    listHTML += \`
                        <button class="import-btn" onclick="cleanDuplicates()" style="margin-top: 16px; background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground));">
                            <span id="cleanDupSpinner" style="display: none;" class="spinner"></span>
                            <iconify-icon icon="lucide:trash-2" id="cleanDupIcon"></iconify-icon>
                            <span id="cleanDupText">清除重复密钥(保留最早的)</span>
                        </button>
                    \`;

                    listDiv.innerHTML = listHTML;
                    listDiv.style.display = 'block';
                }
            } catch (error) {
                result.className = 'import-result error';
                result.innerHTML = \`<iconify-icon icon="lucide:alert-circle"></iconify-icon><span>检测失败: \${error.message}</span>\`;
                result.style.display = 'flex';
            } finally {
                spinner.style.display = 'none';
                icon.style.display = 'inline-block';
                text.textContent = '检测重复密钥';
            }
        }

        // Clean duplicate keys - 清除重复密钥
        async function cleanDuplicates() {
            if (!confirm('确定要清除所有重复密钥吗？每组重复密钥将保留最早导入的一个,删除其余的。此操作不可恢复！')) {
                return;
            }

            const spinner = document.getElementById('cleanDupSpinner');
            const icon = document.getElementById('cleanDupIcon');
            const text = document.getElementById('cleanDupText');

            spinner.style.display = 'inline-block';
            icon.style.display = 'none';
            text.textContent = '清除中...';

            try {
                const response = await fetch('/api/keys/duplicates/clean', {
                    method: 'POST'
                });

                if (!response.ok) {
                    throw new Error('清除失败');
                }

                const data = await response.json();
                alert(\`清除完成！已删除 \${data.deletedCount} 个重复密钥\`);

                // 重新检测
                checkDuplicates();

                // 刷新主页面数据
                loadData();
            } catch (error) {
                alert('清除失败: ' + error.message);
            } finally {
                spinner.style.display = 'none';
                icon.style.display = 'inline-block';
                text.textContent = '清除重复密钥(保留最早的)';
            }
        }

        // 打开清理无效密钥弹窗 - 直接从allData中获取，无需重新调用API
        async function openExportInvalidModal() {
            if (!allData) {
                alert('请先加载数据');
                return;
            }

            const modal = document.getElementById('exportInvalidModal');
            const textarea = document.getElementById('exportInvalidTextarea');
            const info = document.getElementById('exportInvalidInfo');
            const failedCountEl = document.getElementById('failedCount');
            const zeroCountEl = document.getElementById('zeroCount');

            // 显示弹窗
            modal.style.display = 'flex';

            // 直接从已加载的数据中筛选失效密钥（有错误的）
            const failedItems = allData.data.filter(item => item.error);

            // 直接从已加载的数据中筛选零额度密钥（剩余额度 ≤ 0）
            const zeroBalanceItems = allData.data.filter(item => {
                if (item.error) return false;
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining <= 0;
            });

            // 更新计数
            failedCountEl.textContent = failedItems.length;
            zeroCountEl.textContent = zeroBalanceItems.length;

            const totalInvalid = failedItems.length + zeroBalanceItems.length;

            if (totalInvalid === 0) {
                info.innerHTML = '<iconify-icon icon="lucide:check-circle" style="color: hsl(var(--success));"></iconify-icon> 太棒了！没有找到无效密钥';
                textarea.value = '';
                textarea.placeholder = '暂无无效密钥';
                return;
            }

            // 显示统计信息（无需获取完整密钥，只显示数量）
            let message = `找到 <strong>${totalInvalid}</strong> 个无效密钥`;
            if (failedItems.length > 0 && zeroBalanceItems.length > 0) {
                message += ` (<strong>${failedItems.length}</strong> 个失效 + <strong>${zeroBalanceItems.length}</strong> 个零额度)`;
            } else if (failedItems.length > 0) {
                message += ` (全部为失效密钥)`;
            } else {
                message += ` (全部为零额度密钥)`;
            }
            info.innerHTML = `<iconify-icon icon="lucide:alert-triangle" style="color: hsl(var(--warning));"></iconify-icon> ${message}`;

            // 设置提示信息：点击"复制全部"按钮时才会获取完整密钥
            textarea.value = '';
            textarea.placeholder = '点击下方"复制全部"按钮获取完整密钥列表...';
        }

        // 关闭清理无效密钥弹窗
        function closeExportInvalidModal() {
            const modal = document.getElementById('exportInvalidModal');
            modal.style.display = 'none';
        }

        // 复制无效密钥 - 按需获取完整密钥
        async function copyInvalidKeys() {
            const textarea = document.getElementById('exportInvalidTextarea');
            const copyBtn = document.getElementById('copyInvalidBtnText');
            const info = document.getElementById('exportInvalidInfo');

            if (!allData) {
                alert('请先加载数据');
                return;
            }

            // 如果已经有密钥内容，直接复制
            if (textarea.value && textarea.value.length > 0 && !textarea.value.includes('点击')) {
                try {
                    await navigator.clipboard.writeText(textarea.value);
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '已复制!';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 2000);
                } catch (error) {
                    textarea.select();
                    document.execCommand('copy');
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '已复制!';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 2000);
                }
                return;
            }

            // 如果还没有获取完整密钥，现在获取
            const failedItems = allData.data.filter(item => item.error);
            const zeroBalanceItems = allData.data.filter(item => {
                if (item.error) return false;
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining <= 0;
            });

            const allInvalidItems = [...failedItems, ...zeroBalanceItems];

            if (allInvalidItems.length === 0) {
                alert('没有可复制的内容');
                return;
            }

            // 显示加载状态
            const originalBtnText = copyBtn.textContent;
            copyBtn.textContent = '获取中...';
            info.innerHTML = `<iconify-icon icon="lucide:loader-2" style="animation: spin 1s linear infinite;"></iconify-icon> 正在获取 ${allInvalidItems.length} 个完整密钥...`;

            try {
                const fullKeys = [];
                for (const item of allInvalidItems) {
                    try {
                        const response = await fetch(\`/api/keys/\${item.id}/full\`);
                        if (response.ok) {
                            const data = await response.json();
                            fullKeys.push(data.key);
                        }
                    } catch (error) {
                        console.error(\`获取密钥 \${item.id} 失败:\`, error);
                    }
                }

                if (fullKeys.length === 0) {
                    alert('无法获取完整密钥');
                    copyBtn.textContent = originalBtnText;
                    info.innerHTML = '<iconify-icon icon="lucide:alert-circle" style="color: hsl(var(--destructive));"></iconify-icon> 获取完整密钥失败';
                    return;
                }

                // 更新textarea内容
                textarea.value = fullKeys.join('\\n');
                textarea.placeholder = '';

                // 更新信息
                let message = `找到 <strong>${fullKeys.length}</strong> 个无效密钥`;
                if (failedItems.length > 0 && zeroBalanceItems.length > 0) {
                    message += ` (<strong>${failedItems.length}</strong> 个失效 + <strong>${zeroBalanceItems.length}</strong> 个零额度)`;
                }
                info.innerHTML = `<iconify-icon icon="lucide:alert-triangle" style="color: hsl(var(--warning));"></iconify-icon> ${message}`;

                // 复制到剪贴板
                await navigator.clipboard.writeText(textarea.value);
                copyBtn.textContent = '已复制!';
                setTimeout(() => {
                    copyBtn.textContent = originalBtnText;
                }, 2000);

            } catch (error) {
                // 降级方案
                if (textarea.value) {
                    textarea.select();
                    document.execCommand('copy');
                    copyBtn.textContent = '已复制!';
                } else {
                    alert('复制失败: ' + error.message);
                    copyBtn.textContent = originalBtnText;
                }

                setTimeout(() => {
                    copyBtn.textContent = originalBtnText;
                }, 2000);
            }
        }

        // 清除无效密钥（包括失效密钥和零额度密钥）
        async function clearInvalidKeysFromModal() {
            if (!allData) {
                alert('请先加载数据');
                return;
            }

            // 找出失效密钥（有错误的）
            const failedKeys = allData.data.filter(item => item.error);

            // 找出零额度密钥（剩余额度 ≤ 0）
            const zeroBalanceKeys = allData.data.filter(item => {
                if (item.error) return false;
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining <= 0;
            });

            const allInvalidKeys = [...failedKeys, ...zeroBalanceKeys];

            if (allInvalidKeys.length === 0) {
                alert('没有需要清除的无效密钥');
                return;
            }

            let confirmMsg = \`确定要删除 \${allInvalidKeys.length} 个无效密钥吗？\`;
            if (failedKeys.length > 0 && zeroBalanceKeys.length > 0) {
                confirmMsg += \`\\n\\n包括:\\n- \${failedKeys.length} 个失效密钥(HTTP 401等错误)\\n- \${zeroBalanceKeys.length} 个零额度密钥(剩余额度≤0)\`;
            } else if (failedKeys.length > 0) {
                confirmMsg += \`\\n\\n这些密钥因 HTTP 401 等错误无法加载，可能已被官方删除。\`;
            } else {
                confirmMsg += \`\\n\\n这些密钥的剩余额度已 ≤ 0。\`;
            }
            confirmMsg += \`\\n\\n此操作不可恢复！\`;

            if (!confirm(confirmMsg)) {
                return;
            }

            const clearSpinner = document.getElementById('modalInvalidClearSpinner');
            const clearIcon = document.getElementById('modalInvalidClearIcon');
            const clearBtnText = document.getElementById('modalInvalidClearBtnText');

            clearSpinner.style.display = 'inline-block';
            clearIcon.style.display = 'none';
            clearBtnText.textContent = '清除中...';

            try {
                // 使用批量删除 API
                const ids = allInvalidKeys.map(item => item.id);
                const response = await fetch('/api/keys/batch-delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ ids })
                });

                const result = await response.json();

                clearSpinner.style.display = 'none';
                clearIcon.style.display = 'inline-block';
                clearBtnText.textContent = '清除这些密钥';

                if (response.ok) {
                    const failedCount = result.failedIds?.length || 0;
                    let message = \`清除完成！\\n成功删除: \${result.deletedCount} 个\`;
                    if (failedCount > 0) {
                        message += \`\\n失败: \${failedCount} 个\`;
                    }
                    alert(message);

                    // 关闭弹窗
                    closeExportInvalidModal();

                    // 重新加载数据
                    loadData();
                } else {
                    alert('清除失败: ' + result.error);
                }
            } catch (error) {
                clearSpinner.style.display = 'none';
                clearIcon.style.display = 'inline-block';
                clearBtnText.textContent = '清除这些密钥';
                alert('清除失败: ' + error.message);
            }
        }

        // 获取零额度的完整密钥
        async function getZeroBalanceFullKeys() {
            if (!allData) {
                return [];
            }

            // 找出剩余额度小于等于0的密钥
            const zeroBalanceItems = allData.data.filter(item => {
                if (item.error) return false;
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining <= 0;
            });

            if (zeroBalanceItems.length === 0) {
                return [];
            }

            // 从服务器获取完整的key
            const fullKeys = [];
            for (const item of zeroBalanceItems) {
                try {
                    const response = await fetch(\`/api/keys/\${item.id}/full\`);
                    if (response.ok) {
                        const data = await response.json();
                        fullKeys.push(data.key);
                    }
                } catch (error) {
                    console.error(\`获取密钥 \${item.id} 失败:\`, error);
                }
            }

            return fullKeys;
        }

        // 获取有效密钥（剩余额度>0）- 直接从allData中获取，无需重新调用API
        async function getValidBalanceFullKeys() {
            if (!allData) {
                return [];
            }

            // 找出剩余额度大于0的密钥
            const validBalanceItems = allData.data.filter(item => {
                if (item.error) return false;
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining > 0;
            });

            if (validBalanceItems.length === 0) {
                return [];
            }

            // 从服务器获取完整的key
            const fullKeys = [];
            for (const item of validBalanceItems) {
                try {
                    const response = await fetch(\`/api/keys/\${item.id}/full\`);
                    if (response.ok) {
                        const data = await response.json();
                        fullKeys.push(data.key);
                    }
                } catch (error) {
                    console.error(\`获取密钥 \${item.id} 失败:\`, error);
                }
            }

            return fullKeys;
        }

        // 打开导出有效密钥弹窗
        async function openExportValidModal() {
            if (!allData) {
                alert('请先加载数据');
                return;
            }

            const modal = document.getElementById('exportValidModal');
            const textarea = document.getElementById('exportValidTextarea');
            const info = document.getElementById('exportValidInfo');

            // 显示弹窗
            modal.style.display = 'flex';

            // 直接从已有数据中筛选有效密钥（剩余额度 > 0）
            const validBalanceItems = allData.data.filter(item => {
                if (item.error) return false;
                const remaining = item.totalAllowance - item.orgTotalTokensUsed;
                return remaining > 0;
            });

            if (validBalanceItems.length === 0) {
                info.innerHTML = '<iconify-icon icon="lucide:alert-circle" style="color: hsl(var(--warning));\"></iconify-icon> 没有找到有效密钥（剩余额度 > 0）';
                textarea.value = '';
                textarea.placeholder = '暂无有效密钥';
                return;
            }

            // 设置加载状态
            info.innerHTML = \`<iconify-icon icon="lucide:loader-2" style="animation: spin 1s linear infinite;"></iconify-icon> 正在获取 \${validBalanceItems.length} 个有效密钥...\`;
            textarea.value = '';

            // 获取完整密钥
            try {
                const fullKeys = [];
                for (const item of validBalanceItems) {
                    try {
                        const response = await fetch(\`/api/keys/\${item.id}/full\`);
                        if (response.ok) {
                            const data = await response.json();
                            fullKeys.push(data.key);
                        }
                    } catch (error) {
                        console.error(\`获取密钥 \${item.id} 失败:\`, error);
                    }
                }

                info.innerHTML = \`<iconify-icon icon="lucide:check-circle" style="color: hsl(var(--success));\"></iconify-icon> 找到 <strong>\${fullKeys.length}</strong> 个有效密钥(剩余额度 > 0)\`;
                textarea.value = fullKeys.join('\\n');
                textarea.placeholder = '';
            } catch (error) {
                info.innerHTML = '<iconify-icon icon="lucide:alert-circle" style="color: hsl(var(--destructive));\"></iconify-icon> 加载失败: ' + error.message;
                textarea.value = '';
            }
        }

        // 关闭导出有效密钥弹窗
        function closeExportValidModal() {
            const modal = document.getElementById('exportValidModal');
            modal.style.display = 'none';
        }

        // 复制有效密钥
        async function copyValidKeys() {
            const textarea = document.getElementById('exportValidTextarea');
            const copyBtn = document.getElementById('copyValidBtnText');

            if (!textarea.value) {
                alert('没有可复制的内容');
                return;
            }

            try {
                await navigator.clipboard.writeText(textarea.value);

                // 更新按钮文字
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '已复制!';

                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
            } catch (error) {
                // 降级方案：使用传统的复制方法
                textarea.select();
                document.execCommand('copy');

                const originalText = copyBtn.textContent;
                copyBtn.textContent = '已复制!';

                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
            }
        }

        // 自动刷新功能
        function initAutoRefresh() {
            // 从 localStorage 加载设置
            const savedInterval = localStorage.getItem('autoRefreshInterval');
            const isEnabled = localStorage.getItem('autoRefreshEnabled');

            if (savedInterval) {
                autoRefreshMinutes = parseInt(savedInterval);
                document.getElementById('refreshInterval').value = autoRefreshMinutes;
            }

            // 默认启用自动刷新
            if (isEnabled === null || isEnabled === 'true') {
                startAutoRefresh();
            } else {
                updateToggleButton(false);
            }
        }

        function startAutoRefresh() {
            // 清除现有的计时器
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }

            // 设置下次刷新时间
            nextRefreshTime = Date.now() + (autoRefreshMinutes * 60 * 1000);

            // 启动自动刷新计时器
            autoRefreshInterval = setInterval(() => {
                console.log('自动刷新数据...');
                loadData();
            }, autoRefreshMinutes * 60 * 1000);

            // 启动倒计时显示
            updateCountdown();
            countdownInterval = setInterval(updateCountdown, 1000);

            // 更新状态显示
            document.getElementById('autoRefreshStatus').innerHTML = '自动刷新: <span style="color: #34C759;">启用中</span> | 下次刷新: <span id="headerNextRefresh">计算中...</span>';
            updateToggleButton(true);
            localStorage.setItem('autoRefreshEnabled', 'true');
        }

        function stopAutoRefresh() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
            nextRefreshTime = null;
            document.getElementById('nextRefreshDisplay').textContent = '已暂停';
            document.getElementById('headerNextRefresh').textContent = '已暂停';
            document.getElementById('autoRefreshStatus').innerHTML = '自动刷新: <span style="color: #FF9500;">已暂停</span>';
            updateToggleButton(false);
            localStorage.setItem('autoRefreshEnabled', 'false');
        }

        function resetAutoRefresh() {
            if (autoRefreshInterval) {
                // 如果自动刷新已启用，重置计时器
                startAutoRefresh();
            }
        }

        function updateCountdown() {
            if (!nextRefreshTime) return;

            const now = Date.now();
            const remaining = nextRefreshTime - now;

            if (remaining <= 0) {
                document.getElementById('nextRefreshDisplay').textContent = '正在刷新...';
                document.getElementById('headerNextRefresh').textContent = '正在刷新...';
                return;
            }

            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            const timeText = minutes + ' 分 ' + seconds + ' 秒后';

            document.getElementById('nextRefreshDisplay').textContent = timeText;
            document.getElementById('headerNextRefresh').textContent = timeText;
        }

        function updateToggleButton(isRunning) {
            const btn = document.getElementById('toggleRefreshBtn');
            const icon = document.getElementById('toggleRefreshIcon');
            const text = document.getElementById('toggleRefreshText');
            if (isRunning) {
                icon.setAttribute('icon', 'lucide:pause');
                text.textContent = '暂停自动刷新';
                btn.style.background = 'hsl(38 92% 50%)'; // warning color
                btn.style.color = 'hsl(0 0% 100%)'; // warning-foreground
            } else {
                icon.setAttribute('icon', 'lucide:play');
                text.textContent = '启动自动刷新';
                btn.style.background = 'hsl(142 71% 45%)'; // success color
                btn.style.color = 'hsl(0 0% 100%)'; // success-foreground
            }
        }

        function saveRefreshSettings() {
            const input = document.getElementById('refreshInterval');
            const newInterval = parseInt(input.value);

            if (isNaN(newInterval) || newInterval < 1 || newInterval > 1440) {
                alert('请输入有效的时间间隔（1-1440分钟）');
                return;
            }

            autoRefreshMinutes = newInterval;
            localStorage.setItem('autoRefreshInterval', newInterval.toString());

            // 如果自动刷新正在运行，重启以应用新设置
            if (autoRefreshInterval) {
                startAutoRefresh();
            }

            alert('自动刷新间隔已设置为 ' + newInterval + ' 分钟');
        }

        function toggleAutoRefresh() {
            if (autoRefreshInterval) {
                stopAutoRefresh();
            } else {
                startAutoRefresh();
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            loadData();
            initAutoRefresh();
        });
    </script>
</body>
</html>
`;

// Continue with API functions...
async function fetchApiKeyData(id: string, key: string) {
  try {
    const response = await fetch('https://app.factory.ai/api/organization/members/chat-usage', {
      headers: {
        'Authorization': `Bearer ${key}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Error fetching data for key ID ${id}: ${response.status} ${errorBody}`);
      return { id, key: `${key.substring(0, 4)}...`, error: `HTTP ${response.status}` };
    }

    const apiData = await response.json();
    if (!apiData.usage || !apiData.usage.standard) {
        return { id, key: `${key.substring(0, 4)}...`, error: 'Invalid API response structure' };
    }

    const usageInfo = apiData.usage;
    const standardUsage = usageInfo.standard;

    const formatDate = (timestamp: number) => {
        if (!timestamp && timestamp !== 0) return 'N/A';
        try {
            return new Date(timestamp).toISOString().split('T')[0];
        } catch (e) {
            return 'Invalid Date';
        }
    }

    const maskedKey = `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
    return {
      id,
      key: maskedKey,
      startDate: formatDate(usageInfo.startDate),
      endDate: formatDate(usageInfo.endDate),
      orgTotalTokensUsed: standardUsage.orgTotalTokensUsed,
      totalAllowance: standardUsage.totalAllowance,
      usedRatio: standardUsage.usedRatio,
    };
  } catch (error) {
    console.error(`Failed to process key ID ${id}:`, error);
    return { id, key: `${key.substring(0, 4)}...`, error: 'Failed to fetch' };
  }
}

async function getAggregatedData() {
  const keyEntries = await getAllApiKeys();

  if (keyEntries.length === 0) {
    throw new Error("No API keys found in storage. Please import keys first.");
  }

  const results = await Promise.all(keyEntries.map(entry => fetchApiKeyData(entry.id, entry.key)));
  const validResults = results.filter(r => !r.error);

  const totals = validResults.reduce((acc, res) => {
    acc.total_orgTotalTokensUsed += res.orgTotalTokensUsed || 0;
    acc.total_totalAllowance += res.totalAllowance || 0;
    return acc;
  }, {
    total_orgTotalTokensUsed: 0,
    total_totalAllowance: 0,
  });

  const beijingTime = new Date(Date.now() + 8 * 60 * 60 * 1000);

  const keysWithBalance = validResults.filter(r => {
    const remaining = (r.totalAllowance || 0) - (r.orgTotalTokensUsed || 0);
    return remaining > 0;
  });

  if (keysWithBalance.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("📋 剩余额度大于0的API Keys:");
    console.log("-".repeat(80));
    keysWithBalance.forEach(item => {
      const originalEntry = keyEntries.find(e => e.id === item.id);
      if (originalEntry) {
        console.log(originalEntry.key);
      }
    });
    console.log("=".repeat(80) + "\n");
  } else {
    console.log("\n⚠️  没有剩余额度大于0的API Keys\n");
  }

  return {
    update_time: format(beijingTime, "yyyy-MM-dd HH:mm:ss"),
    total_count: keyEntries.length,
    totals,
    data: results,
  };
}

// Main HTTP request handler
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // Login endpoint
  if (url.pathname === "/api/login" && req.method === "POST") {
    try {
      const body = await req.json();
      const { password } = body;

      if (password === ADMIN_PASSWORD) {
        const sessionId = await createSession();
        const response = new Response(JSON.stringify({ success: true }), { headers });

        setCookie(response.headers, {
          name: "session",
          value: sessionId,
          maxAge: 7 * 24 * 60 * 60, // 7 days
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        });

        return response;
      } else {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401,
          headers,
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Show login page if password is set and not authenticated
  if (ADMIN_PASSWORD && url.pathname === "/") {
    const authenticated = await isAuthenticated(req);
    if (!authenticated) {
      return new Response(LOGIN_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  // Home page
  if (url.pathname === "/") {
    return new Response(HTML_CONTENT, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // Protected routes - require authentication
  const authenticated = await isAuthenticated(req);
  if (ADMIN_PASSWORD && !authenticated) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers,
    });
  }

  // Get usage data
  if (url.pathname === "/api/data") {
    try {
      const data = await getAggregatedData();
      return new Response(JSON.stringify(data), { headers });
    } catch (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Get all keys
  if (url.pathname === "/api/keys" && req.method === "GET") {
    try {
      const keys = await getAllApiKeys();
      const safeKeys = keys.map(k => ({
        id: k.id,
        name: k.name,
        createdAt: k.createdAt,
        masked: `${k.key.substring(0, 4)}...${k.key.substring(k.key.length - 4)}`
      }));
      return new Response(JSON.stringify(safeKeys), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Batch import keys
  if (url.pathname === "/api/keys/import" && req.method === "POST") {
    try {
      const body = await req.json();
      const keys = body.keys as string[];

      if (!Array.isArray(keys)) {
        return new Response(JSON.stringify({ error: "Invalid request: 'keys' must be an array" }), {
          status: 400,
          headers,
        });
      }

      const result = await batchImportKeys(keys);
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Find duplicate keys in existing database
  if (url.pathname === "/api/keys/duplicates" && req.method === "GET") {
    try {
      const result = await findDuplicateKeys();
      return new Response(JSON.stringify(result), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Batch delete duplicate keys (keep only one)
  if (url.pathname === "/api/keys/duplicates/clean" && req.method === "POST") {
    try {
      const result = await findDuplicateKeys();
      let deletedCount = 0;

      for (const duplicate of result.duplicates) {
        // Keep the first one, delete the rest
        for (let i = 1; i < duplicate.ids.length; i++) {
          await deleteApiKey(duplicate.ids[i]);
          deletedCount++;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        deletedCount,
        message: `Successfully deleted ${deletedCount} duplicate keys`
      }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Batch delete keys by IDs
  if (url.pathname === "/api/keys/batch-delete" && req.method === "POST") {
    try {
      const body = await req.json();
      const ids = body.ids as string[];

      if (!Array.isArray(ids)) {
        return new Response(JSON.stringify({ error: "Invalid request: 'ids' must be an array" }), {
          status: 400,
          headers,
        });
      }

      let deletedCount = 0;
      const failedIds: string[] = [];

      for (const id of ids) {
        try {
          await deleteApiKey(id);
          deletedCount++;
        } catch (error) {
          failedIds.push(id);
          console.error(`Failed to delete key ${id}:`, error);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        deletedCount,
        totalRequested: ids.length,
        failedIds,
        message: `Successfully deleted ${deletedCount} out of ${ids.length} keys`
      }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Batch delete zero balance keys
  if (url.pathname === "/api/keys/zero-balance/delete" && req.method === "POST") {
    try {
      const allKeys = await getAllApiKeys();
      const keysToDelete: string[] = [];

      // Check each key's balance
      for (const keyEntry of allKeys) {
        try {
          const response = await fetch('https://app.factory.ai/api/organization/members/chat-usage', {
            headers: {
              'Authorization': `Bearer ${keyEntry.key}`,
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
          });

          if (response.ok) {
            const usageData = await response.json();
            const standardUsage = usageData.usage?.standard;
            if (standardUsage) {
              const remaining = standardUsage.totalAllowance - standardUsage.orgTotalTokensUsed;
              if (remaining <= 0) {
                keysToDelete.push(keyEntry.id);
              }
            }
          }
        } catch (error) {
          console.error(`Failed to check balance for key ${keyEntry.id}:`, error);
        }
      }

      // Delete identified keys
      let deletedCount = 0;
      for (const id of keysToDelete) {
        try {
          await deleteApiKey(id);
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete key ${id}:`, error);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        deletedCount,
        totalZeroBalance: keysToDelete.length,
        message: `Successfully deleted ${deletedCount} zero balance keys`
      }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Get full key (for export functionality)
  if (url.pathname.match(/^\/api\/keys\/[^/]+\/full$/) && req.method === "GET") {
    try {
      const pathParts = url.pathname.split("/");
      const id = pathParts[pathParts.length - 2];

      if (!id) {
        return new Response(JSON.stringify({ error: "Key ID required" }), {
          status: 400,
          headers,
        });
      }

      const keyEntry = await getApiKey(id);
      if (!keyEntry) {
        return new Response(JSON.stringify({ error: "Key not found" }), {
          status: 404,
          headers,
        });
      }

      return new Response(JSON.stringify({ key: keyEntry.key }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Get usage data for a specific key (proxy to Factory.ai API)
  if (url.pathname.match(/^\/api\/keys\/[^/]+\/usage$/) && req.method === "GET") {
    try {
      const pathParts = url.pathname.split("/");
      const id = pathParts[pathParts.length - 2];

      if (!id) {
        return new Response(JSON.stringify({ error: "Key ID required" }), {
          status: 400,
          headers,
        });
      }

      const keyEntry = await getApiKey(id);
      if (!keyEntry) {
        return new Response(JSON.stringify({ error: "Key not found" }), {
          status: 404,
          headers,
        });
      }

      // Call Factory.ai API from server side to avoid CORS
      const response = await fetch('https://app.factory.ai/api/organization/members/chat-usage', {
        headers: {
          'Authorization': `Bearer ${keyEntry.key}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(JSON.stringify({
          error: `Factory.ai API error: ${response.status}`,
          details: errorText
        }), {
          status: response.status,
          headers,
        });
      }

      const usageData = await response.json();
      return new Response(JSON.stringify(usageData), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Delete a key
  if (url.pathname.startsWith("/api/keys/") && req.method === "DELETE") {
    try {
      const id = url.pathname.split("/").pop();
      if (!id) {
        return new Response(JSON.stringify({ error: "Key ID required" }), {
          status: 400,
          headers,
        });
      }

      await deleteApiKey(id);
      return new Response(JSON.stringify({ success: true }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Add a single key
  if (url.pathname === "/api/keys" && req.method === "POST") {
    try {
      const body = await req.json();
      const { key, name } = body;

      if (!key) {
        return new Response(JSON.stringify({ error: "Key is required" }), {
          status: 400,
          headers,
        });
      }

      const id = `key-${Date.now()}`;
      await saveApiKey(id, key, name);
      return new Response(JSON.stringify({ success: true, id }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  }

  return new Response("Not Found", { status: 404 });
}

console.log(`🚀 Server running on http://localhost:${PORT}`);
console.log(`🔐 Password Protection: ${ADMIN_PASSWORD ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
serve(handler, { port: PORT });
