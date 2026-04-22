package com.squadhub.chat.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirror of shared/src/index.ts:1315-1318 — keep in sync manually.
@Serializable
enum class ChatAppVariant {
    @SerialName("clients") CLIENTS,
    @SerialName("team") TEAM;

    val wireValue: String get() = if (this == CLIENTS) "clients" else "team"
}

@Serializable
enum class UserType {
    @SerialName("internal") INTERNAL,
    @SerialName("client") CLIENT,
    @SerialName("client_staff") CLIENT_STAFF,
    @SerialName("partner") PARTNER,
}

@Serializable
enum class UserStatus {
    @SerialName("active") ACTIVE,
    @SerialName("pending") PENDING,
    @SerialName("rejected") REJECTED,
    @SerialName("banned") BANNED,
    @SerialName("suspended") SUSPENDED,
}
