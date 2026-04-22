package com.squadhub.chat.data.repo

import com.squadhub.chat.BuildConfig
import com.squadhub.chat.data.model.ChatAppConfig
import com.squadhub.chat.data.remote.ChatApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AppConfigRepository @Inject constructor(
    private val api: ChatApi,
) {
    suspend fun fetch(): Result<ChatAppConfig> = runCatching {
        api.appConfig(BuildConfig.APP_VARIANT)
    }

    /**
     * True when the installed versionName is below the server's min_version.
     * Both are dotted semver (major.minor.patch). Extra segments → treated as 0.
     */
    fun isUpdateRequired(config: ChatAppConfig, currentVersion: String = stripSuffix(BuildConfig.VERSION_NAME)): Boolean {
        val current = parse(currentVersion)
        val min = parse(config.min_version)
        for (i in 0..2) {
            if (current[i] < min[i]) return true
            if (current[i] > min[i]) return false
        }
        return false
    }

    private fun stripSuffix(v: String): String = v.substringBefore('-')

    private fun parse(v: String): IntArray {
        val parts = v.split('.').map { it.filter(Char::isDigit).ifEmpty { "0" }.toInt() }
        return intArrayOf(parts.getOrElse(0) { 0 }, parts.getOrElse(1) { 0 }, parts.getOrElse(2) { 0 })
    }
}
