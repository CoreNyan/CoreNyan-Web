import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_SESSIONS_FILE = path.join(__dirname, '..', 'data', 'auth-sessions.json');

const BLESSING_SKIN_DIR = 'C:\\MCSManager\\daemon\\data\\InstanceData\\FreeCore-Account';
const PHP_EXE = 'C:\\Program Files\\PHP\\php-8.1\\php.exe';

// Persisted + In-memory active authenticated admin sessions
const activeAuthTokens = new Map(); // token -> { token, user, expireAt }

function loadAuthSessionsFromDisk() {
  try {
    if (fs.existsSync(AUTH_SESSIONS_FILE)) {
      const list = JSON.parse(fs.readFileSync(AUTH_SESSIONS_FILE, 'utf-8'));
      const now = Date.now();
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.token && item.expireAt > now) {
            activeAuthTokens.set(item.token, item);
          }
        }
      }
    }
  } catch (e) {}
}

function saveAuthSessionsToDisk() {
  try {
    const dir = path.dirname(AUTH_SESSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const list = [];
    for (const [token, session] of activeAuthTokens.entries()) {
      if (session.expireAt > now) {
        list.push(session);
      } else {
        activeAuthTokens.delete(token);
      }
    }
    fs.writeFileSync(AUTH_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {}
}

loadAuthSessionsFromDisk();

export function parseBlessingSkinEnv() {
  const envPath = path.join(BLESSING_SKIN_DIR, '.env');
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) {
      let v = (m[2] || '').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[m[1]] = v;
    }
  }
  return env;
}

/**
 * Verify user credentials by executing PHP with database parameters piped dynamically from .env
 * Zero hardcoded passwords; dynamically queries MySQL and validates bcrypt password hash.
 */
export async function authenticateBlessingSkinAdmin(identification, password) {
  const env = parseBlessingSkinEnv();
  if (!env) {
    return { success: false, error: '未找到 Blessing Skin 配置文件 (.env)' };
  }

  return new Promise((resolve) => {
    // PHP runner script that connects using dynamic ENV variables passed in
    const phpCode = `<?php
$host = getenv('BS_DB_HOST') ?: '127.0.0.1';
$port = getenv('BS_DB_PORT') ?: '3306';
$dbname = getenv('BS_DB_DATABASE') ?: 'freecoreskin';
$user = getenv('BS_DB_USERNAME') ?: '';
$pass = getenv('BS_DB_PASSWORD') ?: '';
$ident = getenv('BS_AUTH_IDENT') ?: '';
$inputPass = getenv('BS_AUTH_PASS') ?: '';

try {
  $pdo = new PDO("mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4", $user, $pass, [
    PDO::ATTR_TIMEOUT => 3,
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
  ]);

  $columns = [];
  foreach ($pdo->query("SHOW COLUMNS FROM users") as $column) $columns[] = $column['Field'];
  $uuidColumn = in_array('uuid', $columns, true) ? ', uuid' : '';
  $stmt = $pdo->prepare("SELECT uid, email, nickname{$uuidColumn}, password, permission FROM users WHERE (email = ? OR nickname = ?) LIMIT 1");
  $stmt->execute([$ident, $ident]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);

  if (!$row) {
    echo json_encode(["success" => false, "error" => "用户不存在"]);
    exit;
  }

  $perm = (int)($row['permission'] ?? 0);
  if ($perm < 1) {
    echo json_encode(["success" => false, "error" => "权限不足：仅限管理员 (Admin) 及以上身份登录"]);
    exit;
  }

  if (!password_verify($inputPass, $row['password'])) {
    echo json_encode(["success" => false, "error" => "账号或密码错误"]);
    exit;
  }

  $avatarName = $row['nickname'];
  // Blessing Skin may store a Mojang UUID. Prefer it for正版用户，避免昵称改名后头像失效。
  $uuid = preg_replace('/[^a-fA-F0-9]/', '', (string)($row['uuid'] ?? ''));
  if (strlen($uuid) === 32) {
    $avatar = "https://mc-heads.net/avatar/" . $uuid . "/64";
  } else {
    $avatar = "https://mc-heads.net/avatar/" . rawurlencode($avatarName) . "/64";
  }
  $fallbackAvatar = "https://account.lynnhma.xyz/avatar/player/" . rawurlencode($avatarName) . "?size=64";

  echo json_encode([
    "success" => true,
    "user" => [
      "uid" => (int)$row['uid'],
      "email" => $row['email'],
      "nickname" => $row['nickname'],
      "permission" => $perm,
      "avatar" => $avatar,
       "avatarFallback" => $fallbackAvatar,
       "minecraftUuid" => $uuid ?: null
    ]
  ]);
} catch (Exception $e) {
  echo json_encode(["success" => false, "error" => "皮肤站数据库连接失败: " . $e->getMessage()]);
}
`;

    const proc = spawn(PHP_EXE, [], {
      env: {
        ...process.env,
        BS_DB_HOST: env.DB_HOST || '127.0.0.1',
        BS_DB_PORT: env.DB_PORT || '3306',
        BS_DB_DATABASE: env.DB_DATABASE || 'freecoreskin',
        BS_DB_USERNAME: env.DB_USERNAME || '',
        BS_DB_PASSWORD: env.DB_PASSWORD || '',
        BS_AUTH_IDENT: identification,
        BS_AUTH_PASS: password
      }
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });

    proc.on('close', () => {
      try {
        const json = JSON.parse(stdout.trim() || '{}');
        resolve(json);
      } catch (err) {
        resolve({ success: false, error: stderr.trim() || stdout.trim() || 'PHP 鉴权服务响应异常' });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: 'PHP 执行失败: ' + err.message });
    });

    proc.stdin.write(phpCode);
    proc.stdin.end();
  });
}

export function createAuthSession(user) {
  const token = 'fm_' + crypto.randomBytes(32).toString('hex');
  const expireAt = Date.now() + 7 * 24 * 3600 * 1000; // 7 days
  const sessionData = {
    token,
    user,
    expireAt
  };
  activeAuthTokens.set(token, sessionData);
  saveAuthSessionsToDisk();
  return sessionData;
}

export function verifyAuthSession(token) {
  if (!token) return null;
  const session = activeAuthTokens.get(token);
  if (!session) return null;
  if (Date.now() > session.expireAt) {
    activeAuthTokens.delete(token);
    saveAuthSessionsToDisk();
    return null;
  }
  return session.user;
}

export function revokeAuthSession(token) {
  if (token && activeAuthTokens.has(token)) {
    activeAuthTokens.delete(token);
    saveAuthSessionsToDisk();
  }
}
