package com.kurastream.app.core.designsystem.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

object KuraShapes {
    val Control = RoundedCornerShape(8.dp)
    val Card = RoundedCornerShape(12.dp)
    val Panel = RoundedCornerShape(14.dp)
    val Modal = RoundedCornerShape(16.dp)
    val Pill = RoundedCornerShape(999.dp)
    val Small = RoundedCornerShape(4.dp)
}

val MaterialShapes = Shapes(
    small = KuraShapes.Control,
    medium = KuraShapes.Card,
    large = KuraShapes.Modal
)
