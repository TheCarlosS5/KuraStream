package com.kurastream.app.feature.profiles

import com.kurastream.app.core.network.ServerUrlResolver
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChildCare
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.*
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.Profile
import com.kurastream.app.core.model.UiState

@Composable
fun ProfileSelectScreen(
    viewModel: ProfileViewModel,
    onProfileSelected: (Profile) -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            KuraTopBar(title = stringResource(R.string.who_is_watching))
        },
        containerColor = KuraColors.Background
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val state = uiState.state) {
                is UiState.Loading -> {
                    KuraLoadingView(message = "Cargando perfiles…")
                }
                is UiState.Error -> {
                    KuraErrorView(
                        message = state.message,
                        onRetry = viewModel::loadProfiles
                    )
                }
                is UiState.Empty -> {
                    KuraEmptyView(message = state.message)
                }
                is UiState.Content, is UiState.Refreshing -> {
                    val profiles = if (state is UiState.Content) state.data else (state as UiState.Refreshing).currentData

                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = KuraDimens.Space5),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Spacer(modifier = Modifier.height(KuraDimens.Space6))
                        Text(
                            text = "¿Quién está viendo?",
                            style = MaterialTheme.typography.displayMedium,
                            fontWeight = FontWeight.Bold,
                            color = KuraColors.TextMain
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space8))

                        LazyVerticalGrid(
                            columns = GridCells.Adaptive(minSize = 130.dp),
                            horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space5),
                            verticalArrangement = Arrangement.spacedBy(KuraDimens.Space6),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            items(profiles, key = { it.id }) { profile ->
                                ProfileCardItem(
                                    profile = profile,
                                    avatarUrl = if (profile.avatar.isNotBlank()) {
                                        ServerUrlResolver.buildMediaUrl(uiState.mediaBaseUrl, profile.avatar)
                                    } else {
                                        ""
                                    },
                                    onClick = { viewModel.onProfileClicked(profile, onProfileSelected) }
                                )
                            }
                        }
                    }
                }
            }

            // PIN Modal Dialog
            if (uiState.selectedProfilePendingPin != null) {
                ProfilePinDialog(
                    profile = uiState.selectedProfilePendingPin!!,
                    pinInput = uiState.pinInput,
                    errorMessage = uiState.pinError,
                    onPinChanged = viewModel::onPinChanged,
                    onConfirm = { viewModel.confirmPin(onProfileSelected) },
                    onDismiss = viewModel::dismissPinDialog
                )
            }
        }
    }
}

@Composable
private fun ProfileCardItem(
    profile: Profile,
    avatarUrl: String,
    onClick: () -> Unit
) {
    val avatarColor = remember(profile.color) {
        try {
            Color(android.graphics.Color.parseColor(profile.color))
        } catch (_: Exception) {
            KuraColors.Primary
        }
    }

    Column(
        modifier = Modifier
            .clip(KuraShapes.Card)
            .clickable(onClick = onClick)
            .padding(KuraDimens.Space2),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier.size(96.dp),
            contentAlignment = Alignment.Center
        ) {
            if (avatarUrl.isNotBlank()) {
                // Photo or preset chosen on the web (same circle as the web profile picker)
                KuraAsyncImage(
                    model = avatarUrl,
                    contentDescription = profile.name,
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(CircleShape)
                        .border(2.dp, avatarColor, CircleShape)
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(avatarColor.copy(alpha = 0.2f), CircleShape)
                        .border(2.dp, avatarColor, CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = profile.name.take(1).uppercase(),
                        style = MaterialTheme.typography.displayMedium,
                        fontWeight = FontWeight.Bold,
                        color = avatarColor
                    )
                }
            }

            if (profile.hasPin) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(KuraDimens.Space1)
                        .background(KuraColors.Background, KuraShapes.Small)
                        .padding(2.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = "Protegido con PIN",
                        tint = KuraColors.TextSecondary,
                        modifier = Modifier.size(14.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(KuraDimens.Space2))

        Text(
            text = profile.name,
            style = MaterialTheme.typography.titleMedium,
            color = KuraColors.TextMain,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        if (profile.isKids) {
            Spacer(modifier = Modifier.height(2.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.ChildCare,
                    contentDescription = null,
                    tint = KuraColors.Secondary,
                    modifier = Modifier.size(12.dp)
                )
                Spacer(modifier = Modifier.width(3.dp))
                Text(
                    text = "Infantil",
                    style = MaterialTheme.typography.labelSmall,
                    color = KuraColors.Secondary,
                    fontSize = 10.sp
                )
            }
        }
    }
}
