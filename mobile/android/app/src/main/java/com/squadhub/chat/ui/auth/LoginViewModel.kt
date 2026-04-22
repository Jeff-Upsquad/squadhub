package com.squadhub.chat.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.squadhub.chat.data.model.ChatAppVariant
import com.squadhub.chat.data.repo.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    data class UiState(
        val email: String = "",
        val password: String = "",
        val submitting: Boolean = false,
        val error: String? = null,
        val wrongAppFor: ChatAppVariant? = null,
        val signedIn: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun onEmailChange(v: String) = _state.update { it.copy(email = v.trim(), error = null) }
    fun onPasswordChange(v: String) = _state.update { it.copy(password = v, error = null) }

    fun submit() {
        val s = _state.value
        if (s.email.isBlank() || s.password.isBlank() || s.submitting) return
        _state.update { it.copy(submitting = true, error = null, wrongAppFor = null) }

        viewModelScope.launch {
            val result = authRepository.login(s.email, s.password)
            when (result) {
                is AuthRepository.LoginResult.Success -> {
                    _state.update { it.copy(submitting = false, signedIn = true) }
                }
                is AuthRepository.LoginResult.VariantMismatch -> {
                    _state.update {
                        it.copy(
                            submitting = false,
                            wrongAppFor = result.actualForUser,
                        )
                    }
                }
                is AuthRepository.LoginResult.ServerError -> {
                    _state.update { it.copy(submitting = false, error = result.message) }
                }
                is AuthRepository.LoginResult.NetworkError -> {
                    _state.update { it.copy(submitting = false, error = result.message) }
                }
            }
        }
    }
}
