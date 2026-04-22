package com.squadhub.chat.data.remote

import com.squadhub.chat.data.model.RefreshRequest
import com.squadhub.chat.data.model.RefreshResponseData
import com.squadhub.chat.data.model.ApiEnvelope
import dagger.Lazy
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

/**
 * On a 401, call /auth/refresh with the stored refresh token, persist the new
 * pair, and retry the original request with the fresh access token. If refresh
 * fails, clear tokens — UI observes accessToken going null and shows Login.
 *
 * Uses OkHttp's raw API (not Retrofit) for the refresh call to avoid a circular
 * dependency between the ChatApi and the client that hosts this authenticator.
 */
@Singleton
class TokenAuthenticator @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val json: Json,
    private val okHttpClient: Lazy<okhttp3.OkHttpClient>,
) : Authenticator {

    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.header("Authorization") == null) return null
        // Prevent infinite loops: only one retry per request.
        if (responseCount(response) >= 2) return null

        val refresh = tokenStore.refreshToken ?: return null

        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refresh))
            .toRequestBody("application/json".toMediaType())

        val baseUrl = response.request.url.newBuilder()
            .encodedPath("/auth/refresh")
            .query(null)
            .build()

        val refreshRequest = Request.Builder()
            .url(baseUrl)
            .post(body)
            .build()

        val refreshResponse = runBlocking {
            okHttpClient.get().newCall(refreshRequest).execute()
        }

        if (!refreshResponse.isSuccessful) {
            refreshResponse.close()
            tokenStore.clear()
            return null
        }

        val parsed = refreshResponse.body?.string()?.let {
            runCatching {
                json.decodeFromString(
                    ApiEnvelope.serializer(RefreshResponseData.serializer()),
                    it,
                )
            }.getOrNull()
        }
        refreshResponse.close()

        val data = parsed?.data
        if (data == null) {
            tokenStore.clear()
            return null
        }

        tokenStore.updateTokens(data.access_token, data.refresh_token)

        return response.request.newBuilder()
            .header("Authorization", "Bearer ${data.access_token}")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var r: Response? = response.priorResponse
        var count = 1
        while (r != null) {
            count++
            r = r.priorResponse
        }
        return count
    }
}
