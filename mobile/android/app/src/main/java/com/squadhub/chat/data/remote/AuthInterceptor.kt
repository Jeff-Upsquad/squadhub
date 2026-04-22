package com.squadhub.chat.data.remote

import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Attaches Authorization: Bearer <access_token> to every outbound request.
 * Endpoints that don't need auth (POST /auth/login, POST /auth/refresh,
 * GET /chat/app/config) still receive the header if available — the server
 * ignores it there, which is safe.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: AuthTokenStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenStore.accessToken.value
        val request = if (token.isNullOrBlank()) {
            chain.request()
        } else {
            chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(request)
    }
}
