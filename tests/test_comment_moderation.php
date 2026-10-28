<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';

echo "Running comment moderation tests...\n";

function cm_status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}
function cm_as(string $user, string $role, callable $fn): ?int {
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . AuthMiddleware::createToken(['username' => $user, 'role' => $role, 'exp' => time() + 600]);
    try { return cm_status($fn); } finally { unset($_SERVER['HTTP_AUTHORIZATION']); }
}

$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$show = "cm_show_$sfx";
$ana = "cm_ana_$sfx";
$bob = "cm_bob_$sfx";
$db->prepare("INSERT INTO shows (id, title, synopsis, rating, year) VALUES (:id, 'T', 'd', 7.0, 2026)")->execute(['id' => $show]);

try {
    $c1 = DbHelper::addComment($show, $ana, 'Principal', 'hola de ana');
    $c2 = DbHelper::addComment($show, $bob, 'Principal', 'hola de bob');

    $forAna = array_column(DbHelper::getComments($show, $ana, false), 'can_delete', 'id');
    assert($forAna[$c1['id']] === true && $forAna[$c2['id']] === false, 'Each viewer may delete only their own comments');
    $forAdmin = array_column(DbHelper::getComments($show, 'someone_else', true), 'can_delete', 'id');
    assert($forAdmin[$c1['id']] === true && $forAdmin[$c2['id']] === true, 'An admin may delete any comment');
    $guest = DbHelper::getComments($show);
    assert(!in_array(true, array_column($guest, 'can_delete'), true), 'Guests may delete nothing');
    foreach ($guest as $row) assert(!array_key_exists('owner', $row) && !array_key_exists('username', $row), 'The login name is never exposed');
    echo "✓ can_delete is computed per viewer OK\n";

    assert(cm_status(fn() => ShowController::deleteComment($c1['id'])) === 401, 'Deleting needs a session');
    assert(cm_as($bob, 'user', fn() => ShowController::deleteComment($c1['id'])) === 403, "Bob cannot delete Ana's comment");
    assert(cm_as($bob, 'user', fn() => ShowController::deleteComment('comm_missing')) === 404, 'Unknown comment is a 404');
    assert(cm_as($ana, 'user', fn() => ShowController::deleteComment($c1['id'])) === 200, 'The author deletes their comment');
    assert(DbHelper::getCommentOwner($c1['id']) === null, 'It is gone');
    assert(cm_as('some_admin', 'admin', fn() => ShowController::deleteComment($c2['id'])) === 200, 'An admin deletes any comment');
    echo "✓ Deletion rules OK\n";
} finally {
    $db->prepare("DELETE FROM comments WHERE show_id = :s")->execute(['s' => $show]);
    $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $show]);
}
echo "Comment moderation tests passed!\n";
