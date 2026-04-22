package com.squadhub.chat.data.model

import kotlinx.serialization.Serializable

// Mirror of shared/src/index.ts:1412 — keep in sync manually.
@Serializable
data class ChatAppConfig(
    val variant: ChatAppVariant,
    val min_version: String,
    val download_url: String? = null,
    val updated_at: String,
)
