<?php
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Testing ASS Subtitle Shifting...\n";

$ass = <<<ASS
[Script Info]
Title: Default Aegisub file

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:10.00,Default,,0,0,0,,Hello
Dialogue: 0,0:00:08.50,0:00:15.20,Default,,0,0,0,,World
Dialogue: 0,1:05:10.00,1:05:15.00,Default,,0,0,0,,Long Movie
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Cut
ASS;

// Test 1: Offset 6.5s
$expectedOffset = <<<ASS
[Script Info]
Title: Default Aegisub file

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:03.50,Default,,0,0,0,,Hello
Dialogue: 0,0:00:02.00,0:00:08.70,Default,,0,0,0,,World
Dialogue: 0,1:05:03.50,1:05:08.50,Default,,0,0,0,,Long Movie
ASS;

$shifted = PlayerController::shiftAssTimestamps($ass, 6.5);
if ($shifted !== $expectedOffset) {
    echo "FAIL: Expected offset 6.5 output did not match.\n";
    echo "EXPECTED:\n$expectedOffset\n";
    echo "GOT:\n$shifted\n";
    exit(1);
}

// Test 2: Offset 0 (should return original)
$shiftedZero = PlayerController::shiftAssTimestamps($ass, 0);
if ($shiftedZero !== $ass) {
    echo "FAIL: Expected offset 0 output to match exactly.\n";
    exit(1);
}

// Test 3: centisecond rounding must never produce an invalid "60.00" seconds field
$edge = "Dialogue: 0,0:01:00.00,0:01:05.00,Default,,0,0,0,,Edge";
$shiftedEdge = PlayerController::shiftAssTimestamps($edge, 0.004);
if ($shiftedEdge !== "Dialogue: 0,0:01:00.00,0:01:05.00,Default,,0,0,0,,Edge") {
    echo "FAIL: Rounding edge produced: $shiftedEdge\n";
    exit(1);
}

echo "OK\n";
