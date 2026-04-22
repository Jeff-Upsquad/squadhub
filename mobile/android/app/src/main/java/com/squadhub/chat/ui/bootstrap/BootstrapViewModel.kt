package com.squadhub.chat.ui.bootstrap

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.squadhub.chat.data.remote.AuthTokenStore
import com.squadhub.chat.data.repo.AppConfigRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Single source of truth for "what screen should I show at app start?".
 * On first composition and on explicit refresh(), it:
 *   1) Checks the version gate — if below min, NeedsUpdate
 *   2) Checks the token store — empty → SignedOut; present → SignedIn
 *
 * AppNavigation observes state and routes accordingly.
 */
@HiltViewModel
class BootstrapViewModel @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val appConfigRepository: AppConfigRepository,
) : ViewModel() {

    sealed interface State {
        data object Loading : State
        data object SignedOut : State
        data object SignedIn : State
        data object NeedsUpdate : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            appConfigRepository.fetch().onSuccess { config ->
                if (appConfigRepository.isUpdateRequired(config)) {
                    _state.value = State.NeedsUpdate
                    return@launch
                }
            }
            // Version gate unreachable / offline → fall through. Don't block login
            // on a missing config — we'll re-check on next launch.
            _state.value = if (tokenStore.accessToken.value.isNullOrBlank())
                State.SignedOut else State.SignedIn
        }
    }
}
