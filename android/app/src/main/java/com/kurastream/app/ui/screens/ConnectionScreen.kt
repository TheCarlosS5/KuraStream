package com.kurastream.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kurastream.app.data.KuraStreamApi
import com.kurastream.app.data.PreferencesManager
import com.kurastream.app.ui.theme.BgDark
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionScreen(
    preferencesManager: PreferencesManager,
    onConnected: () -> Unit
) {
    var ipAddress by remember { mutableStateOf(preferencesManager.getServerUrl() ?: "http://192.168.1.100:3000") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDark)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "KuraStream",
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        Text(
            text = "Acompañante Móvil Premium",
            fontSize = 16.sp,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
            modifier = Modifier.padding(bottom = 32.dp)
        )

        OutlinedTextField(
            value = ipAddress,
            onValueChange = { 
                ipAddress = it 
                errorMessage = null
            },
            label = { Text("URL del Servidor Local") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            isError = errorMessage != null
        )

        errorMessage?.let {
            Text(
                text = it,
                color = MaterialTheme.colorScheme.error,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 8.dp)
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = {
                val urlToTest = ipAddress.trim()
                if (urlToTest.isBlank()) {
                    errorMessage = "La URL no puede estar vacía"
                    return@Button
                }
                isLoading = true
                errorMessage = null
                scope.launch {
                    try {
                        val testApi = KuraStreamApi.create(urlToTest, preferencesManager)
                        testApi.getShows() // Ping shows to verify server availability
                        preferencesManager.saveServerUrl(urlToTest)
                        onConnected()
                    } catch (e: Exception) {
                        errorMessage = "Error de conexión: ${e.localizedMessage ?: e.message}"
                    } finally {
                        isLoading = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !isLoading
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.5.dp
                )
            } else {
                Text("Conectar", fontWeight = FontWeight.Bold)
            }
        }
    }
}
