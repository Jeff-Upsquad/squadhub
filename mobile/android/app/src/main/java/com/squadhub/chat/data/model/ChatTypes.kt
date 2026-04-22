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

// Mirror of shared/src/index.ts:1316 — keep in sync manually.
@Serializable
enum class ChatMessageType {
    @SerialName("text") TEXT,
    @SerialName("voice") VOICE,
    @SerialName("image") IMAGE,
    @SerialName("video") VIDEO,
    @SerialName("document") DOCUMENT,
    @SerialName("system") SYSTEM;

    val wireValue: String get() = name.lowercase()
}

@Serializable
enum class ChatConversationType {
    @SerialName("group") GROUP,
    @SerialName("dm") DM;

    val wireValue: String get() = name.lowercase()
}

// Client-side only — never sent to the server. Drives the composer UI state.
enum class ChatMessageLocalState { QUEUED, SENDING, SENT, FAILED }
