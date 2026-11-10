<?php
declare(strict_types=1);

// CLI utility for the SQLite account store. Initialize the site once before using it.
$dbFile = getenv('SQLITE_FILE') ?: __DIR__ . '/.private/appunti.sqlite';
$command = $argv[1] ?? '';
try {
    if (!is_file($dbFile)) throw new RuntimeException('Database assente. Avvia prima server.php per inizializzare SQLite e gli account.');
    $pdo = new PDO('sqlite:' . $dbFile, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    if ($command === 'list') {
        foreach ($pdo->query('SELECT username,name,role,must_change_password FROM users WHERE active=1 ORDER BY username') as $row) {
            printf("%-18s %-30s %-10s %s\n", $row['username'], $row['name'], $row['role'], $row['must_change_password'] ? 'cambio password richiesto' : 'attivo');
        }
        exit(0);
    }
    if ($command === 'reset' && isset($argv[2]) && preg_match('/^[a-z0-9-]+$/i', $argv[2])) {
        $username = strtolower($argv[2]); $q = $pdo->prepare('SELECT id,username FROM users WHERE username=? COLLATE NOCASE AND active=1'); $q->execute([$username]); $user = $q->fetch();
        if (!$user) throw new RuntimeException('Account non trovato.');
        $password = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?')->execute([password_hash($password, PASSWORD_DEFAULT, ['cost' => 12]), $user['id']]);
        $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$user['id']]);
        $pdo->commit();
        $file = dirname($dbFile) . '/password-reset-' . $user['username'] . '.txt';
        file_put_contents($file, $user['username'] . "\n" . $password . "\n", LOCK_EX); chmod($file, 0600);
        echo "Password temporanea generata in {$file}. Consegnala privatamente e cancella il file.\n";
        exit(0);
    }
    fwrite(STDERR, "Uso: php manage-accounts.php list | reset <username>\n"); exit(2);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n"); exit(1);
}
