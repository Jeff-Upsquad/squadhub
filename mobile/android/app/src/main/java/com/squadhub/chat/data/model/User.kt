package com.squadhub.chat.data.model

import kotlinx.serialization.Serializable

// Mirror of shared/src/index.ts:9 (User). Only fields the Android app reads are listed.
@Serializable
data class User(
    val id: String,
    val email: String,
    val display_name: String,
    val avatar_url: String? = null,
    val is_admin: Boolean = false,
    val status: UserStatus = UserStatus.ACTIVE,
    val user_type: UserType,
)
