package com.squadhub.chat.data.remote

import com.squadhub.chat.data.model.ApiEnvelope
import com.squadhub.chat.data.model.ChatAppConfig
import com.squadhub.chat.data.model.ChatDmConversation
import com.squadhub.chat.data.model.ChatGroup
import com.squadhub.chat.data.model.ChatMarkReadRequest
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessagesPage
import com.squadhub.chat.data.model.ChatSendRequest
import com.squadhub.chat.data.model.LoginRequest
import com.squadhub.chat.data.model.LoginResponseData
import com.squadhub.chat.data.model.RefreshRequest
import com.squadhub.chat.data.model.RefreshResponseData
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface ChatApi {

    // ---- Auth ----
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): ApiEnvelope<LoginResponseData>

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): ApiEnvelope<RefreshResponseData>

    @POST("auth/logout")
    suspend fun logout(): ApiEnvelope<Unit>

    // ---- App config (version gate). Public — no auth required. ----
    @GET("chat/app/config")
    suspend fun appConfig(@Query("variant") variant: String): ChatAppConfig

    // ---- Groups ----
    @GET("chat/groups")
    suspend fun listGroups(): ApiEnvelope<List<ChatGroup>>

    // ---- DMs (team app only; server enforces via requireTeamVariant) ----
    @GET("chat/dms")
    suspend fun listDms(): ApiEnvelope<List<ChatDmConversation>>

    // ---- Messages ----
    @GET("chat/messages")
    suspend fun listMessages(
        @Query("group_id") groupId: String? = null,
        @Query("dm_conversation_id") dmConversationId: String? = null,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 50,
    ): ChatMessagesPage

    @POST("chat/messages")
    suspend fun sendMessage(@Body body: ChatSendRequest): ApiEnvelope<ChatMessage>

    @POST("chat/receipts/read")
    suspend fun markRead(@Body body: ChatMarkReadRequest): ApiEnvelope<Unit>
}
