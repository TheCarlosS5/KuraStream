<?php
/**
 * Global error handling for the web entrypoint.
 *
 * Without it PHP prints uncaught exceptions to the response (display_errors defaults to on in the CLI
 * server image): file paths, SQL and call arguments (which can include passwords) reach the client.
 * Every failure is logged with a request id and the client only receives that id.
 */

if (!function_exists('kuraRequestId')) {
    function kuraRequestId(): string {
        static $id = null;
        if ($id === null) {
            $id = bin2hex(random_bytes(6));
        }
        return $id;
    }
}

if (!function_exists('kuraClassifyThrowable')) {
    /**
     * Maps a throwable to [httpStatus, clientMessage]. Client-caused failures (wrong JSON types, duplicate keys,
     * values longer than their column) become 4xx; everything else is a generic 500 that reveals nothing.
     */
    function kuraClassifyThrowable(Throwable $e): array {
        if ($e instanceof TypeError
            && preg_match('/\barray given\b|Illegal string offset|Cannot access offset of type/i', $e->getMessage())) {
            return [400, 'Solicitud inválida: algún campo tiene un tipo de dato incorrecto'];
        }
        if ($e instanceof PDOException) {
            $driverCode = (int)($e->errorInfo[1] ?? 0);
            if ($driverCode === 1062) {
                return [409, 'El registro ya existe'];
            }
            if ($driverCode === 1406 || ($e->errorInfo[0] ?? '') === '22001') {
                return [400, 'Algún valor es demasiado largo'];
            }
        }
        return [500, 'Error interno del servidor'];
    }
}

if (!function_exists('kuraLogThrowable')) {
    function kuraLogThrowable(Throwable $e, int $status): void {
        error_log(sprintf(
            "[KuraStream][%s] %s %s -> HTTP %d %s: %s in %s:%d\n%s",
            kuraRequestId(),
            $_SERVER['REQUEST_METHOD'] ?? 'CLI',
            $_SERVER['REQUEST_URI'] ?? '-',
            $status,
            get_class($e),
            $e->getMessage(),
            $e->getFile(),
            $e->getLine(),
            $e->getTraceAsString()
        ));
    }
}

if (!function_exists('kuraHandleThrowable')) {
    function kuraHandleThrowable(Throwable $e): void {
        [$status, $message] = kuraClassifyThrowable($e);
        kuraLogThrowable($e, $status);
        if (headers_sent() && !defined('TESTING_MODE')) {
            // A stream (video, SSE) was already under way: nothing sensible can be added to the body.
            return;
        }
        jsonResponse(['error' => $message, 'request_id' => kuraRequestId()], $status);
    }
}

if (!function_exists('kuraHandleShutdown')) {
    function kuraHandleShutdown(): void {
        $err = error_get_last();
        if (!$err || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
            return;
        }
        error_log(sprintf('[KuraStream][%s] fatal %s -> %s in %s:%d',
            kuraRequestId(), $_SERVER['REQUEST_URI'] ?? '-', $err['message'], $err['file'], $err['line']));
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => 'Error interno del servidor', 'request_id' => kuraRequestId()]);
        }
    }
}

if (!function_exists('kuraInstallErrorHandlers')) {
    function kuraInstallErrorHandlers(): void {
        // Never print errors to the client; keep them in the server log.
        ini_set('display_errors', '0');
        ini_set('display_startup_errors', '0');
        ini_set('log_errors', '1');
        // Stack traces must not carry call arguments (login bodies contain passwords).
        ini_set('zend.exception_ignore_args', '1');
        if (!headers_sent()) {
            header('X-Request-Id: ' . kuraRequestId());
        }
        set_exception_handler('kuraHandleThrowable');
        register_shutdown_function('kuraHandleShutdown');
    }
}
