<?php
/**
 * Quick concurrency check without k6:  BASE_URL=http://127.0.0.1:3000 USERS=30 php tests/load/php_load_smoke.php
 *
 * Creates USERS throw-away accounts, then, in rounds, has every one of them fetch the catalogue and a show page at
 * the same time (curl_multi) and reports the latency percentiles. Exit code 1 when the p95 is above P95_MS
 * (default 1000) or any request failed: usable in CI and after a deployment.
 */
$base = rtrim(getenv('BASE_URL') ?: 'http://127.0.0.1:3000', '/');
$users = max(1, (int)(getenv('USERS') ?: 30));
$rounds = max(1, (int)(getenv('ROUNDS') ?: 10));
$limit = (float)(getenv('P95_MS') ?: 1000);
$run = bin2hex(random_bytes(3));

function call(string $method, string $url, ?array $body = null, array $headers = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers)]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$code, is_string($raw) ? json_decode($raw, true) : null];
}

echo "Preparing $users accounts on $base ...\n";
$auth = [];
for ($i = 0; $i < $users; $i++) {
    $name = "load_{$run}_$i";
    call('POST', "$base/api/register", ['username' => $name, 'password' => 'LoadTest!2026']);
    [$code, $login] = call('POST', "$base/api/login", ['username' => $name, 'password' => 'LoadTest!2026']);
    if ($code !== 200 || empty($login['token'])) { fwrite(STDERR, "login failed for $name (HTTP $code); is REGISTER_MAX_PER_HOUR high enough?\n"); exit(2); }
    $token = $login['token'];
    [, $profiles] = call('GET', "$base/api/profiles", null, ["Authorization: Bearer $token"]);
    $profileId = $profiles['profiles'][0]['id'] ?? null;
    if ($profileId) {
        [, $sel] = call('POST', "$base/api/profiles/select", ['profile_id' => $profileId], ["Authorization: Bearer $token"]);
        if (!empty($sel['token'])) $token = $sel['token'];
    }
    $auth[] = "Authorization: Bearer $token";
}
[, $shows] = call('GET', "$base/api/shows?limit=5", null, [$auth[0]]);
$showId = is_array($shows) && !empty($shows[0]['id']) ? $shows[0]['id'] : null;

$times = []; $failed = 0;
for ($round = 0; $round < $rounds; $round++) {
    $mh = curl_multi_init(); $handles = [];
    foreach ($auth as $header) {
        foreach (array_filter(["$base/api/shows", $showId ? "$base/api/shows/" . rawurlencode($showId) : null, "$base/api/history/continue"]) as $url) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => [$header]]);
            curl_multi_add_handle($mh, $ch);
            $handles[] = $ch;
        }
    }
    do { $status = curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 0.2); } while ($running && $status === CURLM_OK);
    foreach ($handles as $ch) {
        $times[] = curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000;
        if (curl_getinfo($ch, CURLINFO_RESPONSE_CODE) >= 400 || curl_errno($ch)) $failed++;
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
}
sort($times);
$pct = fn(float $p) => $times[(int)min(count($times) - 1, floor(count($times) * $p))];
printf("%d requests (%d users x %d rounds): p50 %.0f ms, p95 %.0f ms, p99 %.0f ms, max %.0f ms, failed %d\n",
    count($times), $users, $rounds, $pct(0.5), $pct(0.95), $pct(0.99), end($times), $failed);
exit(($pct(0.95) > $limit || $failed > 0) ? 1 : 0);
