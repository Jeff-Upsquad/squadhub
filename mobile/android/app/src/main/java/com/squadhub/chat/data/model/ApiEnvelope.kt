package com.squadhub.chat.data.model

import kotlinx.serialization.Serializable

/**
 * Every server response is wrapped in { success, data?, error? } except
 * /chat/app/config which returns the raw config object. We model both
 * shapes with this envelope; consumers of raw endpoints use the type
 * directly instead of `ApiEnvelope<T>`.
 */
@Serializable
data class ApiEnvelope<T>(
    val success: Boolean,
    val data: T? = null,
    val error: String? = null,
    val message: String? = null,
)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class LoginResponseData(
    val user: User,
    val access_token: String,
    val refresh_token: String,
)

@Serializable
data class RefreshRequest(val refresh_token: String)

@Serializable
data class RefreshResponseData(
    val access_token: String,
    val refresh_token: String,
)
