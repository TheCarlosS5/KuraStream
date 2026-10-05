<?php
require_once __DIR__ . '/../config.php';

/**
 * Typed access to request input. Request bodies are attacker-controlled JSON: a field that should be a
 * string may arrive as an array or object, which would otherwise crash trim()/strlen() with a TypeError.
 */
class Input {
    /** Decoded JSON object body (an empty array when the body is empty, invalid or not an object). */
    public static function json(?string $raw = null): array {
        $raw = $raw ?? (string)file_get_contents('php://input');
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    /**
     * A string field. Missing/null gives ''. Arrays, objects and booleans are refused with 400, and so are
     * values longer than $maxLength characters (never silently truncated).
     */
    public static function string(array $source, string $key, int $maxLength = 255, bool $trim = true): string {
        if (!array_key_exists($key, $source) || $source[$key] === null) {
            return '';
        }
        $value = $source[$key];
        if (is_int($value) || is_float($value)) {
            $value = (string)$value;
        }
        if (!is_string($value)) {
            jsonError("El campo '{$key}' debe ser texto", 400);
        }
        if ($trim) {
            $value = trim($value);
        }
        if (mb_strlen($value, 'UTF-8') > $maxLength) {
            jsonError("El campo '{$key}' es demasiado largo (máximo {$maxLength} caracteres)", 400);
        }
        return $value;
    }
}
