<?php
declare(strict_types=1);

/* PHP + SQLite front controller for Appunti 5IB. Start locally with:
 * NOTION_TOKEN=... NOTION_DATABASE_ID=... php -S 127.0.0.1:8000 server.php
 */

const NOTION_VERSION = '2026-03-11';
const NOTION_BASE = 'https://api.notion.com/v1';
const SESSION_SECONDS = 604800;
const PASSWORD_OPTIONS = ['cost' => 12];
const ROSTER = [
    ['bashar', 'Bashar Ifutrahman'], ['batista', 'Batista Rodriguez Sofia'],
    ['brusegan', 'Brusegan Samuele'], ['busetto', 'Busetto Enrico'],
    ['canziani', 'Canziani Alvise'], ['cotelea', 'Cotelea Alessandro'],
    ['della-ratta', 'Della Ratta Giuseppe'], ['di-battista', 'Di Battista Alessio'],
    ['don', 'Don Nicolas'], ['guerra', 'Guerra Matteo'],
    ['giuglielmi', 'Giuglielmi Giacomo'], ['guo', 'Guo Xinhao William'],
    ['isandelli', 'Isandelli Lorenzo'], ['lghoul', 'Lghoul Zainab'],
    ['maestri', 'Maestri Daniele'], ['mauriello', 'Mauriello Alessandro'],
    ['morettin', 'Morettin Matteo'], ['roibu', 'Roibu Marco'],
    ['rossi', 'Rossi Emanuele'], ['tonini', 'Tonini Riccardo'],
    ['yasashiniy', 'Yasashiniy Nikita'], ['zambelli', 'Zambelli Anna'],
    ['zhang', 'Zhang Lelihao'],
];

// Lightweight .env reader: process environment variables take precedence.
function loadDotEnv(): void {
    $file = __DIR__ . '/.env';
    if (!is_file($file) || !is_readable($file)) return;
    foreach (file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) continue;
        if (!preg_match('/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/', $line, $match)) continue;
        $key = $match[1];
        if (getenv($key) !== false) continue;
        $value = trim($match[2]);
        if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
            $quote = $value[0];
            $value = substr($value, 1, -1);
            if ($quote === '"') $value = stripcslashes($value);
        } else {
            $value = preg_replace('/\s+#.*$/', '', $value) ?? $value;
        }
        putenv($key . '=' . $value);
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
    }
}
loadDotEnv();

final class HttpError extends RuntimeException {
    public function __construct(public int $status, string $message) { parent::__construct($message); }
}

function envValue(string $key, ?string $default = null): ?string {
    $value = getenv($key);
    return $value === false || $value === '' ? $default : $value;
}
function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    if (!extension_loaded('pdo_sqlite')) throw new RuntimeException('Estensione PHP pdo_sqlite non installata.');
    $file = envValue('SQLITE_FILE', __DIR__ . '/.private/appunti.sqlite');
    $dir = dirname($file);
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('Impossibile creare la cartella dati.');
    chmod($dir, 0700);
    $pdo = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    chmod($file, 0600);
    $schema = file_get_contents(__DIR__ . '/database.sql');
    if ($schema === false) throw new RuntimeException('database.sql non leggibile.');
    $pdo->exec($schema);
    seedDatabase($pdo);
    return $pdo;
}
function seedDatabase(PDO $pdo): void {
    if ((int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) return;
    $legacy = [];
    $legacyPath = envValue('ACCOUNTS_FILE', __DIR__ . '/accounts.json');
    if (is_file($legacyPath)) {
        $parsed = json_decode((string)file_get_contents($legacyPath), true);
        foreach (($parsed['users'] ?? []) as $u) if (!empty($u['username'])) $legacy[strtolower($u['username'])] = $u;
    }
    $credentialPath = envValue('INITIAL_CREDENTIALS_FILE', __DIR__ . '/password-temporanee-5ib.csv');
    $credentials = [];
    if (is_file($credentialPath) && ($handle = fopen($credentialPath, 'rb'))) {
        fgetcsv($handle);
        while (($row = fgetcsv($handle)) !== false) if (isset($row[0], $row[1])) $credentials[strtolower(trim($row[0]))] = trim($row[1]);
        fclose($handle);
    }
    $generated = [];
    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare('INSERT INTO users (id, username, name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)');
        foreach (ROSTER as [$username, $name]) {
            $password = $credentials[$username] ?? rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
            if (!isset($credentials[$username])) $generated[] = [$username, $password];
            $oldId = $legacy[$username]['id'] ?? null;
            $id = $oldId ?: (string)newUuid();
            $role = $username === 'tonini' ? 'superuser' : 'user';
            $insert->execute([$id, $username, $name, $role, password_hash($password, PASSWORD_DEFAULT, PASSWORD_OPTIONS)]);
        }
        importLegacyPermissions($pdo, $legacyPath);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    if ($generated) writeCredentialFile($generated, envValue('PHP_INITIAL_CREDENTIALS_FILE', __DIR__ . '/password-temporanee-php.csv'));
    chmod(envValue('SQLITE_FILE', __DIR__ . '/.private/appunti.sqlite'), 0600);
}
function newUuid(): string {
    $b = random_bytes(16); $b[6] = chr((ord($b[6]) & 0x0f) | 0x40); $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
}
function writeCredentialFile(array $credentials, string $file): void {
    $lines = ["username,password"];
    foreach ($credentials as [$username, $password]) $lines[] = $username . ',' . $password;
    if (file_put_contents($file, implode("\n", $lines) . "\n", LOCK_EX) === false) throw new RuntimeException('Non riesco a salvare le password iniziali.');
    chmod($file, 0600);
    error_log('Creati gli account del registro. Credenziali iniziali: ' . $file . ' (file privato, eliminare dopo la consegna).');
}
function importLegacyPermissions(PDO $pdo, string $file): void {
    if (!is_file($file)) return;
    $legacy = json_decode((string)file_get_contents($file), true);
    if (!$legacy) return;
    $userIds = $pdo->query('SELECT id FROM users')->fetchAll(PDO::FETCH_COLUMN);
    foreach (($legacy['access']['notes'] ?? []) as $noteId => $ids) {
        if (!is_array($ids)) continue;
        $pdo->prepare('INSERT OR IGNORE INTO note_permissions(note_id, everyone) VALUES (?, 0)')->execute([$noteId]);
        foreach ($ids as $id) if (in_array($id, $userIds, true)) $pdo->prepare('INSERT OR IGNORE INTO note_permission_users(note_id,user_id) VALUES (?,?)')->execute([$noteId, $id]);
    }
    foreach (($legacy['access']['courses'] ?? []) as $course => $ids) {
        if (!is_array($ids)) continue;
        $pdo->prepare('INSERT OR IGNORE INTO course_permissions(course_name, everyone) VALUES (?, 0)')->execute([$course]);
        foreach ($ids as $id) if (in_array($id, $userIds, true)) $pdo->prepare('INSERT OR IGNORE INTO course_permission_users(course_name,user_id) VALUES (?,?)')->execute([$course, $id]);
    }
}
function jsonResponse(int $status, mixed $body, string $type = 'application/json'): never {
    http_response_code($status);
    header('Content-Type: ' . $type . '; charset=utf-8');
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    if ($type === 'application/json') echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    else echo $body;
    exit;
}
function requestBody(): array {
    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if ($raw === false || strlen($raw) > 16384) throw new HttpError(413, 'Richiesta troppo grande.');
    $body = json_decode($raw, true);
    if (!is_array($body)) throw new HttpError(400, 'JSON non valido.');
    return $body;
}
function checkOrigin(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') return;
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $proto = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? 'http')[0]);
    if (!in_array($proto, ['http', 'https'], true) || !hash_equals($proto . '://' . $host, $origin)) throw new HttpError(403, 'Origine non consentita.');
}
function clientIp(): string {
    return trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown')[0]);
}
function rateLimit(PDO $pdo): void {
    $ip = clientIp(); $now = time();
    $q = $pdo->prepare('SELECT window_started, attempts FROM login_attempts WHERE client_ip = ?'); $q->execute([$ip]); $row = $q->fetch();
    if ($row && $now - (int)$row['window_started'] < 900 && (int)$row['attempts'] >= 10) throw new HttpError(429, 'Troppi tentativi. Riprova tra 15 minuti.');
    if (!$row || $now - (int)$row['window_started'] >= 900) $pdo->prepare('INSERT INTO login_attempts(client_ip,window_started,attempts) VALUES(?,?,1) ON CONFLICT(client_ip) DO UPDATE SET window_started=excluded.window_started, attempts=1')->execute([$ip, $now]);
    else $pdo->prepare('UPDATE login_attempts SET attempts=attempts+1 WHERE client_ip=?')->execute([$ip]);
}
function clearRateLimit(PDO $pdo): void { $pdo->prepare('DELETE FROM login_attempts WHERE client_ip=?')->execute([clientIp()]); }
function cachedValue(PDO $pdo, string $key, int $ttl, callable $fetch): mixed {
    $q = $pdo->prepare('SELECT payload FROM api_cache WHERE cache_key=? AND expires_at>?'); $q->execute([$key, time()]); $payload = $q->fetchColumn();
    if ($payload !== false) { $decoded = json_decode((string)$payload, true); if (is_array($decoded)) return $decoded; }
    $value = $fetch();
    $q = $pdo->prepare('INSERT INTO api_cache(cache_key,payload,expires_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at');
    $q->execute([$key, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), time() + $ttl]);
    return $value;
}
function sessionUser(PDO $pdo): ?array {
    $token = $_COOKIE['session'] ?? '';
    if (!preg_match('/^[A-Za-z0-9_-]{40,60}$/', $token)) return null;
    $q = $pdo->prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1');
    $q->execute([hash('sha256', $token), time()]);
    return $q->fetch() ?: null;
}
function safeUser(array $user): array {
    return ['id' => $user['id'], 'username' => $user['username'], 'name' => $user['name'], 'role' => $user['role'], 'mustChangePassword' => (bool)$user['must_change_password']];
}
function setSession(PDO $pdo, array $user): void {
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $pdo->prepare('DELETE FROM sessions WHERE expires_at <= ?')->execute([time()]);
    $pdo->prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')->execute([hash('sha256', $token), $user['id'], time() + SESSION_SECONDS, time()]);
    setcookie('session', $token, ['expires' => time() + SESSION_SECONDS, 'path' => '/', 'secure' => envValue('COOKIE_SECURE', 'true') !== 'false', 'httponly' => true, 'samesite' => 'Strict']);
}
function destroySession(PDO $pdo): void {
    $token = $_COOKIE['session'] ?? '';
    if ($token !== '') $pdo->prepare('DELETE FROM sessions WHERE token_hash=?')->execute([hash('sha256', $token)]);
    setcookie('session', '', ['expires' => 1, 'path' => '/', 'secure' => envValue('COOKIE_SECURE', 'true') !== 'false', 'httponly' => true, 'samesite' => 'Strict']);
}

function notion(string $endpoint, string $method = 'GET', ?array $body = null, int $attempt = 0): array {
    if (!extension_loaded('curl')) throw new RuntimeException('Estensione PHP curl non installata.');
    $token = envValue('NOTION_TOKEN');
    if (!$token) throw new RuntimeException('NOTION_TOKEN non configurato.');
    $retryAfter = 1;
    $ch = curl_init(NOTION_BASE . $endpoint);
    $headers = ['Authorization: Bearer ' . $token, 'Notion-Version: ' . NOTION_VERSION, 'Content-Type: application/json'];
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 30, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$retryAfter): int { if (stripos($line, 'Retry-After:') === 0) $retryAfter = max(1, (int)trim(substr($line, 12))); return strlen($line); },
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $raw = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $error = curl_error($ch); curl_close($ch);
    if ($raw === false) throw new RuntimeException('Connessione a Notion non riuscita: ' . $error);
    if ($status === 429 && $attempt < 3) { sleep(min(10, $retryAfter)); return notion($endpoint, $method, $body, $attempt + 1); }
    if ($status < 200 || $status >= 300) throw new RuntimeException('Notion HTTP ' . $status . ': ' . substr($raw, 0, 300));
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new RuntimeException('Risposta JSON Notion non valida.');
    return $data;
}
function cleanId(?string $id): string { return strtolower(str_replace('-', '', $id ?? '')); }
function lowerText(string $value): string { return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value); }
function plainText(array $parts): string { return implode('', array_map(fn($p) => (string)($p['plain_text'] ?? ''), $parts)); }
function property(array $props, string $name): ?array {
    foreach ($props as $key => $value) if (strcasecmp(trim((string)$key), $name) === 0) return $value;
    return null;
}
function mapIcon(array $page, string $route = '/api/notes/'): ?array {
    $icon = $page['icon'] ?? null;
    if (!$icon) return null;
    if (($icon['type'] ?? '') === 'emoji') return ['type' => 'emoji', 'emoji' => $icon['emoji'] ?? ''];
    if (in_array($icon['type'] ?? '', ['external', 'custom_emoji'], true)) {
        $url = $icon[$icon['type']]['url'] ?? null;
        return $url ? ['type' => 'url', 'url' => $url] : null;
    }
    if (($icon['type'] ?? '') === 'file') return ['type' => 'url', 'url' => $route . $page['id'] . '/icon'];
    if (($icon['type'] ?? '') === 'icon' && !empty($icon['icon']['name'])) return ['type' => 'url', 'url' => 'https://www.notion.so/icons/' . $icon['icon']['name'] . '_' . ($icon['icon']['color'] ?? 'gray') . '.svg'];
    return null;
}
function mapPage(array $page): array {
    $props = $page['properties'] ?? []; $course = property($props, 'class');
    if (!$course) foreach ($props as $p) if (in_array($p['type'] ?? '', ['select', 'multi_select', 'status'], true)) { $course = $p; break; }
    $courseValue = [];
    if (($course['type'] ?? '') === 'select') $courseValue = $course['select'] ?? [];
    elseif (($course['type'] ?? '') === 'multi_select') $courseValue = $course['multi_select'] ?? [];
    elseif (($course['type'] ?? '') === 'status') $courseValue = $course['status'] ?? [];
    elseif (($course['type'] ?? '') === 'rich_text') $courseValue = plainText($course['rich_text'] ?? []);
    $titleKey = null; foreach ($props as $key => $value) if (($value['type'] ?? '') === 'title') { $titleKey = $key; break; }
    $authorProp = property($props, 'Autore'); $author = [];
    if (($authorProp['type'] ?? '') === 'people') $author = array_values(array_filter(array_column($authorProp['people'] ?? [], 'name')));
    elseif (($authorProp['type'] ?? '') === 'rich_text') $author = plainText($authorProp['rich_text'] ?? []);
    elseif (!empty($authorProp['created_by']['name'])) $author = [$authorProp['created_by']['name']];
    $dateProp = property($props, 'Data creazione');
    $date = $dateProp['created_time'] ?? $dateProp['date']['start'] ?? $page['created_time'] ?? null;
    return ['id' => $page['id'], 'titolo' => $titleKey ? (plainText($props[$titleKey]['title'] ?? []) ?: 'Senza titolo') : 'Senza titolo', 'pubblica' => ($props['Pubblica']['checkbox'] ?? false) === true, 'corso' => $courseValue, 'autore' => $author, 'dataCreazione' => $date, 'url' => $page['url'] ?? '', 'icon' => mapIcon($page)];
}
function resolveSources(): array {
    static $resolved = null;
    if ($resolved !== null) return $resolved;
    $database = envValue('NOTION_DATABASE_ID'); if (!$database) throw new RuntimeException('NOTION_DATABASE_ID non configurato.');
    $db = notion('/databases/' . rawurlencode($database)); $list = $db['data_sources'] ?? [];
    $isVoti = fn($s) => preg_match('/voti|correzion/i', $s['name'] ?? '') === 1;
    $notes = envValue('NOTION_DATA_SOURCE_ID') ?? null;
    if (!$notes) foreach ($list as $source) if (!$isVoti($source)) { $notes = $source['id']; break; }
    if (!$notes && isset($list[0]['id'])) $notes = $list[0]['id'];
    if (!$notes) throw new RuntimeException('Nessun data source trovato; configura NOTION_DATA_SOURCE_ID.');
    $voti = envValue('NOTION_VOTI_DATA_SOURCE_ID'); $dbs = [cleanId($database)];
    $votiDatabase = envValue('NOTION_VOTI_DATABASE_ID');
    if (!$voti && $votiDatabase) {
        try { $vdb = notion('/databases/' . rawurlencode($votiDatabase)); $voti = $vdb['data_sources'][0]['id'] ?? null; $dbs[] = cleanId($votiDatabase); } catch (Throwable) {}
    }
    if (!$voti) foreach ($list as $source) if (cleanId($source['id']) !== cleanId($notes) && $isVoti($source)) { $voti = $source['id']; break; }
    if ($voti && cleanId($voti) === cleanId($notes)) $voti = null;
    $resolved = ['notes' => $notes, 'voti' => $voti, 'sources' => array_values(array_filter([$notes, $voti])), 'dbs' => $dbs];
    return $resolved;
}
function listSource(string $source, string $label): array {
    $all = []; $cursor = null;
    do {
        $body = ['filter' => ['property' => 'Pubblica', 'checkbox' => ['equals' => true]], 'sorts' => [['timestamp' => 'created_time', 'direction' => 'descending']], 'page_size' => 100];
        if ($cursor) $body['start_cursor'] = $cursor;
        $r = notion('/data_sources/' . rawurlencode($source) . '/query', 'POST', $body);
        foreach ($r['results'] ?? [] as $page) if (($page['object'] ?? '') === 'page' && empty($page['in_trash'])) $all[] = mapPage($page);
        $cursor = !empty($r['has_more']) ? ($r['next_cursor'] ?? null) : null;
    } while ($cursor);
    return array_values(array_filter($all, fn($n) => $n['pubblica']));
}
function noteList(PDO $pdo): array {
    return cachedValue($pdo, 'notion:notes', (int)envValue('CACHE_SECONDS', '60'), function () { $s = resolveSources(); return listSource($s['notes'], 'notes'); });
}
function relationTitle(string $id): string {
    $page = notion('/pages/' . rawurlencode($id));
    foreach (($page['properties'] ?? []) as $p) if (($p['type'] ?? '') === 'title') return plainText($p['title'] ?? []);
    return '';
}
function correctionsList(PDO $pdo): array {
    return cachedValue($pdo, 'notion:corrections', (int)envValue('CACHE_SECONDS', '60'), function () use ($pdo) {
    $s = resolveSources(); if (!$s['voti']) return [];
    try {
        $colors = [];
        foreach (noteList($pdo) as $note) { $c = is_array($note['corso']) && array_is_list($note['corso']) ? ($note['corso'][0] ?? null) : $note['corso']; if (is_array($c) && !empty($c['name'])) $colors[lowerText(trim($c['name']))] = $c['color'] ?? 'default'; }
        $list = listSource($s['voti'], 'corrections');
        foreach ($list as &$note) {
            $page = notion('/pages/' . rawurlencode($note['id'])); $rel = property($page['properties'] ?? [], 'Materia');
            if (!$rel) foreach (($page['properties'] ?? []) as $p) if (($p['type'] ?? '') === 'relation') { $rel = $p; break; }
            $name = !empty($rel['relation'][0]['id']) ? relationTitle($rel['relation'][0]['id']) : ($rel['select']['name'] ?? '');
            $note['corso'] = $name ? ['name' => $name, 'color' => $colors[lowerText(trim($name))] ?? 'default'] : [];
        }
        unset($note); return $list;
    } catch (Throwable $e) { error_log('Fonte correzioni non leggibile: ' . $e->getMessage()); return []; }
    });
}
function noteAllowed(PDO $pdo, array $note, array $user): bool {
    if ($user['role'] === 'superuser') return true;
    $q = $pdo->prepare('SELECT everyone FROM note_permissions WHERE note_id=?'); $q->execute([$note['id']]); $rule = $q->fetchColumn();
    if ($rule !== false && (int)$rule !== 1) { $q = $pdo->prepare('SELECT 1 FROM note_permission_users WHERE note_id=? AND user_id=?'); $q->execute([$note['id'], $user['id']]); if (!$q->fetchColumn()) return false; }
    $courses = $note['corso'] ?? [];
    if (!is_array($courses) || !array_is_list($courses)) $courses = [$courses];
    foreach ($courses as $course) {
        $name = is_string($course) ? $course : ($course['name'] ?? ''); if ($name === '') continue;
        $q = $pdo->prepare('SELECT everyone FROM course_permissions WHERE course_name=? COLLATE NOCASE'); $q->execute([$name]); $rule = $q->fetchColumn();
        if ($rule !== false && (int)$rule !== 1) { $q = $pdo->prepare('SELECT 1 FROM course_permission_users WHERE course_name=? COLLATE NOCASE AND user_id=?'); $q->execute([$name, $user['id']]); if (!$q->fetchColumn()) return false; }
    }
    return true;
}
function visibleNotes(PDO $pdo, array $list, array $user): array { return array_values(array_filter($list, fn($n) => noteAllowed($pdo, $n, $user))); }
function publishedPage(string $id): array {
    $page = notion('/pages/' . rawurlencode($id)); $s = resolveSources(); $parent = $page['parent'] ?? [];
    $source = $parent['data_source_id'] ?? null; $database = $parent['database_id'] ?? null;
    $parentOk = $source ? in_array(cleanId($source), array_map('cleanId', $s['sources']), true) : in_array(cleanId($database), array_map('cleanId', $s['dbs']), true);
    if (($page['properties']['Pubblica']['checkbox'] ?? false) !== true || !empty($page['in_trash']) || !$parentOk) throw new HttpError(404, 'Not found');
    return $page;
}
function accessibleNote(PDO $pdo, string $id, array $user): array {
    publishedPage($id);
    foreach ([noteList($pdo), correctionsList($pdo)] as $list) foreach ($list as $note) if (cleanId($note['id']) === cleanId($id)) {
        if (!noteAllowed($pdo, $note, $user)) throw new HttpError(404, 'Not found');
        return $note;
    }
    throw new HttpError(404, 'Not found');
}
function listChildren(string $id): array {
    $all = []; $cursor = null;
    do { $query = '?page_size=100' . ($cursor ? '&start_cursor=' . rawurlencode($cursor) : ''); $r = notion('/blocks/' . rawurlencode($id) . '/children' . $query); array_push($all, ...($r['results'] ?? [])); $cursor = !empty($r['has_more']) ? ($r['next_cursor'] ?? null) : null; } while ($cursor);
    return $all;
}
function slug(string $text): string {
    if (function_exists('iconv')) $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
    $text = strtolower(preg_replace('/[^a-z0-9]+/', '-', $text) ?? '');
    return trim(substr($text, 0, 60), '-');
}
function imageName(array $block): string {
    $image = $block['image']; $url = $image['file']['url'] ?? $image['external']['url'] ?? '';
    $orig = basename((string)(parse_url($url, PHP_URL_PATH) ?? ''));
    $ext = preg_match('/\.(png|jpe?g|gif|webp|svg|avif)$/i', $orig, $m) ? strtolower($m[0]) : '.png';
    $caption = slug(plainText($image['caption'] ?? []));
    $base = $caption ?: slug((string)pathinfo($orig, PATHINFO_FILENAME)) ?: 'immagine';
    return $base . $ext;
}
function mapBlock(array $block, string $root): ?array {
    $type = $block['type'] ?? ''; $content = $block[$type] ?? [];
    if ($type === 'divider') return ['type' => 'divider'];
    if ($type === 'heading_4') return ['type' => 'heading_3', 'rich_text' => $content['rich_text'] ?? []];
    if ($type === 'equation') return ['type' => 'equation', 'expression' => $content['expression'] ?? ''];
    if ($type === 'image') {
        $img = $block['image']; $url = ($img['type'] ?? '') === 'file' ? '/api/notes/' . $root . '/img/' . $block['id'] . '/' . imageName($block) : ($img['external']['url'] ?? '');
        return ['type' => 'image', 'url' => $url, 'caption' => $img['caption'] ?? []];
    }
    $supported = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'to_do', 'callout', 'code', 'toggle'];
    if (!in_array($type, $supported, true)) return null;
    $mapped = ['type' => $type === 'toggle' ? 'paragraph' : $type, 'rich_text' => $content['rich_text'] ?? []];
    if ($type === 'to_do') $mapped['checked'] = (bool)($content['checked'] ?? false);
    if ($type === 'callout') $mapped['icon'] = $content['icon']['emoji'] ?? '💡';
    if ($type === 'code') $mapped['language'] = $content['language'] ?? 'plain text';
    return $mapped;
}
function fetchBlocks(string $blockId, int $depth = 0, ?string $root = null): array {
    $root ??= $blockId; $out = [];
    foreach (listChildren($blockId) as $block) {
        if (($block['type'] ?? '') === 'table') {
            $rows = []; foreach (listChildren($block['id']) as $row) if (($row['type'] ?? '') === 'table_row') $rows[] = $row['table_row']['cells'] ?? [];
            $out[] = ['type' => 'table', 'header_row' => ($block['table']['has_column_header'] ?? false) === true, 'header_col' => ($block['table']['has_row_header'] ?? false) === true, 'rows' => $rows]; continue;
        }
        $mapped = mapBlock($block, $root); if ($mapped) $out[] = $mapped;
        if (!empty($block['has_children']) && $depth < 3 && !in_array($block['type'] ?? '', ['child_page', 'child_database'], true)) array_push($out, ...fetchBlocks($block['id'], $depth + 1, $root));
    }
    return $out;
}
function noteBlocks(PDO $pdo, string $id): array {
    $page = publishedPage($id); $key = 'notion:blocks:' . $id . ':' . ($page['last_edited_time'] ?? '');
    return cachedValue($pdo, $key, 3600, fn() => fetchBlocks($id));
}
function noteImage(PDO $pdo, string $pageId, string $blockId, array $user): never {
    accessibleNote($pdo, $pageId, $user);
    $found = false;
    foreach (noteBlocks($pdo, $pageId) as $block) if (($block['type'] ?? '') === 'image' && str_contains($block['url'] ?? '', '/img/' . $blockId . '/')) { $found = true; break; }
    if (!$found) throw new HttpError(404, 'Not found');
    $block = notion('/blocks/' . rawurlencode($blockId)); $src = $block['image']['file']['url'] ?? $block['image']['external']['url'] ?? null;
    pipeImage($src, imageName($block));
}
function pipeImage(?string $url, string $name): never {
    if (!$url || !extension_loaded('curl')) throw new RuntimeException('Immagine Notion non disponibile.');
    $ch = curl_init($url); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 30]);
    $body = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $type = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE); curl_close($ch);
    if ($body === false || $status < 200 || $status >= 300 || !str_starts_with(strtolower($type), 'image/')) throw new HttpError(502, 'Immagine non disponibile.');
    header('Content-Type: ' . $type); header('Content-Disposition: inline; filename="' . preg_replace('/[^\w.\-]/', '_', substr($name, 0, 100)) . '"');
    header('Cache-Control: private, no-store'); header('X-Content-Type-Options: nosniff'); header('Content-Security-Policy: sandbox'); echo $body; exit;
}
function noteIcon(PDO $pdo, string $id, array $user): never {
    accessibleNote($pdo, $id, $user); $page = publishedPage($id); $icon = $page['icon'] ?? [];
    if (($icon['type'] ?? '') !== 'file') throw new HttpError(404, 'Not found');
    pipeImage($icon['file']['url'] ?? null, 'icona');
}
function listCourseIcons(PDO $pdo, array $user): array {
    $out = cachedValue($pdo, 'notion:course-icons', 300, function () use ($pdo) {
    $sources = resolveSources(); $voti = $sources['voti']; if (!$voti) return [];
    $schema = notion('/data_sources/' . rawurlencode($voti)); $props = $schema['properties'] ?? []; $relation = property($props, 'Materia');
    if (!$relation) foreach ($props as $p) if (($p['type'] ?? '') === 'relation') { $relation = $p; break; }
    $courseDs = envValue('NOTION_CORSI_DATA_SOURCE_ID') ?? ($relation['relation']['data_source_id'] ?? null);
    $pages = []; $ids = [];
    if ($courseDs) {
        try { $dbs = notion('/databases/' . rawurlencode($courseDs)); $dataSources = array_column($dbs['data_sources'] ?? [], 'id') ?: [$courseDs]; }
        catch (Throwable) { $dataSources = [$courseDs]; }
        foreach ($dataSources as $ds) { $cursor = null; do { $body = ['page_size' => 100]; if ($cursor) $body['start_cursor'] = $cursor; $r = notion('/data_sources/' . rawurlencode($ds) . '/query', 'POST', $body); array_push($pages, ...($r['results'] ?? [])); $cursor = !empty($r['has_more']) ? ($r['next_cursor'] ?? null) : null; } while ($cursor); }
    } else {
        $cursor = null; do { $body = ['page_size' => 100]; if ($cursor) $body['start_cursor'] = $cursor; $r = notion('/data_sources/' . rawurlencode($voti) . '/query', 'POST', $body); foreach ($r['results'] ?? [] as $row) { $rel = property($row['properties'] ?? [], 'Materia'); if (!$rel) foreach (($row['properties'] ?? []) as $p) if (($p['type'] ?? '') === 'relation') { $rel = $p; break; } foreach ($rel['relation'] ?? [] as $item) $ids[$item['id']] = true; } $cursor = !empty($r['has_more']) ? ($r['next_cursor'] ?? null) : null; } while ($cursor);
        foreach (array_keys($ids) as $id) $pages[] = notion('/pages/' . rawurlencode($id));
    }
    $out = [];
    foreach ($pages as $page) {
        if (($page['object'] ?? '') !== 'page' || !empty($page['in_trash'])) continue;
        $title = ''; foreach (($page['properties'] ?? []) as $p) if (($p['type'] ?? '') === 'title') { $title = trim(plainText($p['title'] ?? [])); break; }
        $icon = mapIcon($page, '/api/course-icon/');
        if ($title !== '' && $icon) { $out[lowerText($title)] = $icon; $ids[$page['id']] = true; }
    }
    return $out;
    });
    // La cache contiene solo icone; i permessi vengono ricalcolati per ogni risposta.
    foreach ($out as $name => $_) { $q = $pdo->prepare('SELECT everyone FROM course_permissions WHERE course_name=? COLLATE NOCASE'); $q->execute([$name]); $rule = $q->fetchColumn(); if ($rule !== false && (int)$rule !== 1 && $user['role'] !== 'superuser') { $q = $pdo->prepare('SELECT 1 FROM course_permission_users WHERE course_name=? COLLATE NOCASE AND user_id=?'); $q->execute([$name, $user['id']]); if (!$q->fetchColumn()) unset($out[$name]); } }
    return $out;
}
function courseIcon(PDO $pdo, string $pageId, array $user): never {
    $all = listCourseIcons($pdo, ['role' => 'superuser', 'id' => '', 'username' => '', 'name' => '', 'must_change_password' => 0]);
    $page = notion('/pages/' . rawurlencode($pageId)); $title = '';
    foreach (($page['properties'] ?? []) as $p) if (($p['type'] ?? '') === 'title') { $title = trim(plainText($p['title'] ?? [])); break; }
    $key = lowerText($title);
    if ($title === '' || !isset($all[$key]) || ($all[$key]['url'] ?? '') !== '/api/course-icon/' . $pageId . '/icon') throw new HttpError(404, 'Not found');
    $q = $pdo->prepare('SELECT everyone FROM course_permissions WHERE course_name=? COLLATE NOCASE'); $q->execute([$title]); $rule = $q->fetchColumn();
    if ($user['role'] !== 'superuser' && $rule !== false && (int)$rule !== 1) { $q = $pdo->prepare('SELECT 1 FROM course_permission_users WHERE course_name=? COLLATE NOCASE AND user_id=?'); $q->execute([$title, $user['id']]); if (!$q->fetchColumn()) throw new HttpError(404, 'Not found'); }
    if (($page['icon']['type'] ?? '') !== 'file') throw new HttpError(404, 'Not found');
    pipeImage($page['icon']['file']['url'] ?? null, 'icona');
}

function adminAccess(PDO $pdo): array {
    $users = array_map('safeUser', $pdo->query('SELECT * FROM users WHERE active=1 ORDER BY username')->fetchAll());
    $notes = [];
    foreach ([noteList($pdo), correctionsList($pdo)] as $list) foreach ($list as $n) {
        $courses = $n['corso'] ?? []; if (!is_array($courses) || !array_is_list($courses)) $courses = [$courses];
        $names = []; foreach ($courses as $course) { $name = is_string($course) ? $course : ($course['name'] ?? ''); if ($name !== '') $names[] = $name; }
        $notes[] = ['id' => $n['id'], 'title' => $n['titolo'], 'courses' => $names];
    }
    $access = ['notes' => [], 'courses' => []];
    foreach ($pdo->query('SELECT note_id FROM note_permissions WHERE everyone=0')->fetchAll(PDO::FETCH_COLUMN) as $id) { $q = $pdo->prepare('SELECT user_id FROM note_permission_users WHERE note_id=?'); $q->execute([$id]); $access['notes'][$id] = $q->fetchAll(PDO::FETCH_COLUMN); }
    foreach ($pdo->query('SELECT course_name FROM course_permissions WHERE everyone=0')->fetchAll(PDO::FETCH_COLUMN) as $name) { $q = $pdo->prepare('SELECT user_id FROM course_permission_users WHERE course_name=? COLLATE NOCASE'); $q->execute([$name]); $access['courses'][$name] = $q->fetchAll(PDO::FETCH_COLUMN); }
    return ['users' => $users, 'notes' => $notes, 'access' => $access];
}
function saveAccess(PDO $pdo, array $body): void {
    $valid = $pdo->query('SELECT id FROM users WHERE active=1')->fetchAll(PDO::FETCH_COLUMN); $notes = $body['notes'] ?? null; $courses = $body['courses'] ?? null;
    if (!is_array($notes) || !is_array($courses)) throw new HttpError(400, 'Permessi non validi.');
    foreach ([$notes, $courses] as $map) foreach ($map as $ids) if (!is_array($ids) || count($ids) > count($valid) || array_diff($ids, $valid)) throw new HttpError(400, 'Account non validi.');
    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM note_permissions'); $pdo->exec('DELETE FROM course_permissions');
        foreach ($notes as $id => $ids) { $pdo->prepare('INSERT INTO note_permissions(note_id,everyone) VALUES(?,0)')->execute([$id]); foreach (array_unique($ids) as $uid) $pdo->prepare('INSERT INTO note_permission_users(note_id,user_id) VALUES(?,?)')->execute([$id, $uid]); }
        foreach ($courses as $name => $ids) { $pdo->prepare('INSERT INTO course_permissions(course_name,everyone) VALUES(?,0)')->execute([$name]); foreach (array_unique($ids) as $uid) $pdo->prepare('INSERT INTO course_permission_users(course_name,user_id) VALUES(?,?)')->execute([$name, $uid]); }
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}

function route(PDO $pdo): never {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/'; $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') { header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS'); header('Access-Control-Allow-Headers: Content-Type'); jsonResponse(204, []); }
    if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) checkOrigin();
    if ($path === '/' || $path === '/index.html') {
        if ($method !== 'GET') throw new HttpError(405, 'Method not allowed.');
        header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-store'); readfile(__DIR__ . '/index.html'); exit;
    }
    if (!str_starts_with($path, '/api/')) throw new HttpError(404, 'Not found');
    if ($path === '/api/auth/login' && $method === 'POST') {
        rateLimit($pdo); $body = requestBody(); $username = strtolower(trim((string)($body['username'] ?? ''))); $password = (string)($body['password'] ?? '');
        $q = $pdo->prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1'); $q->execute([$username]); $user = $q->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) jsonResponse(401, ['error' => 'Utente o password non corretti']);
        clearRateLimit($pdo); setSession($pdo, $user); jsonResponse(200, safeUser($user));
    }
    if ($path === '/api/auth/logout' && $method === 'POST') { destroySession($pdo); jsonResponse(200, ['ok' => true]); }
    if ($path === '/api/auth/me' && $method === 'GET') { $user = sessionUser($pdo); if (!$user) jsonResponse(401, ['error' => 'Accesso richiesto']); jsonResponse(200, safeUser($user)); }
    if ($path === '/api/auth/change-password' && $method === 'POST') {
        rateLimit($pdo); $user = sessionUser($pdo); if (!$user) jsonResponse(401, ['error' => 'Accesso richiesto']);
        $body = requestBody(); $old = (string)($body['oldPassword'] ?? ''); $new = (string)($body['password'] ?? '');
        if (!password_verify($old, $user['password_hash'])) jsonResponse(401, ['error' => 'Password attuale non corretta']);
        if (strlen($new) < 12 || strlen($new) > 200 || hash_equals($old, $new)) jsonResponse(400, ['error' => 'Scegli una password diversa, di almeno 12 caratteri.']);
        $q = $pdo->prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?'); $q->execute([password_hash($new, PASSWORD_DEFAULT, PASSWORD_OPTIONS), $user['id']]);
        $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$user['id']]);
        clearRateLimit($pdo); $user['must_change_password'] = 0; setSession($pdo, $user); jsonResponse(200, safeUser($user));
    }
    if ($path === '/api/admin/access' && $method === 'GET') {
        $user = requireUser($pdo); if ($user['role'] !== 'superuser') throw new HttpError(403, 'Accesso negato.'); jsonResponse(200, adminAccess($pdo));
    }
    if ($path === '/api/admin/access' && $method === 'PUT') {
        $user = requireUser($pdo); if ($user['role'] !== 'superuser') throw new HttpError(403, 'Accesso negato.'); saveAccess($pdo, requestBody()); jsonResponse(200, ['ok' => true]);
    }
    $user = requireUser($pdo);
    if ($path === '/api/notes' && $method === 'GET') jsonResponse(200, visibleNotes($pdo, noteList($pdo), $user));
    if ($path === '/api/corrections' && $method === 'GET') jsonResponse(200, visibleNotes($pdo, correctionsList($pdo), $user));
    if ($path === '/api/course-icons' && $method === 'GET') jsonResponse(200, listCourseIcons($pdo, $user));
    if (preg_match('#^/api/course-icon/([0-9a-f-]{32,36})/icon$#i', $path, $m) && $method === 'GET') courseIcon($pdo, $m[1], $user);
    if (preg_match('#^/api/notes/([0-9a-f-]{32,36})/blocks$#i', $path, $m) && $method === 'GET') { accessibleNote($pdo, $m[1], $user); jsonResponse(200, noteBlocks($pdo, $m[1])); }
    if (preg_match('#^/api/notes/([0-9a-f-]{32,36})/icon$#i', $path, $m) && $method === 'GET') noteIcon($pdo, $m[1], $user);
    if (preg_match('#^/api/notes/([0-9a-f-]{32,36})/img/([0-9a-f-]{32,36})(?:/([^/]*))?$#i', $path, $m) && $method === 'GET') noteImage($pdo, $m[1], $m[2], $user);
    throw new HttpError(404, 'Not found');
}
function requireUser(PDO $pdo): array {
    $user = sessionUser($pdo); if (!$user) throw new HttpError(401, 'Accesso richiesto.');
    if ((bool)$user['must_change_password']) throw new HttpError(403, 'Devi cambiare la password al primo accesso.');
    return $user;
}

try {
    // PHP built-in server serves existing CSS/JS/image files as static files.
    $requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (PHP_SAPI === 'cli-server' && !str_starts_with($requestPath, '/api/') && $requestPath !== '/' && $requestPath !== '/index.html') {
        $candidate = realpath(__DIR__ . $requestPath);
        $publicExtensions = ['css', 'js', 'png', 'jpg', 'jpeg', 'ico', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'map'];
        $extension = strtolower(pathinfo($candidate ?: '', PATHINFO_EXTENSION));
        if ($candidate && str_starts_with($candidate, __DIR__ . DIRECTORY_SEPARATOR) && is_file($candidate) && in_array($extension, $publicExtensions, true)) return false;
    }
    route(db());
} catch (HttpError $e) {
    jsonResponse($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log($e->getMessage()); jsonResponse(502, ['error' => 'Errore del server.']);
}
