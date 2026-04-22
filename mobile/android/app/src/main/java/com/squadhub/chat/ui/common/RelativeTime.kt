package com.squadhub.chat.ui.common

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * WhatsApp-style timestamp formatter.
 *
 *   today        → "3:45 PM"
 *   yesterday    → "Yesterday"
 *   last 7 days  → weekday (e.g. "Monday")
 *   older        → "dd/MM/yy"
 */
fun formatInboxTimestamp(iso: String?, now: Instant = Instant.now()): String {
    val t = parseIsoOrNull(iso) ?: return ""
    val zone = ZoneId.systemDefault()
    val today = LocalDate.ofInstant(now, zone)
    val day = LocalDate.ofInstant(t, zone)
    val daysBetween = Duration.between(day.atStartOfDay(zone), today.atStartOfDay(zone)).toDays()

    return when {
        day == today -> timeFmt.format(t.atZone(zone))
        daysBetween == 1L -> "Yesterday"
        daysBetween in 2..6 -> day.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.getDefault())
        else -> shortDate.format(day)
    }
}

/**
 * Day header shown above a block of messages ("Today", "Yesterday", "14 Mar 2026").
 */
fun formatDayHeader(iso: String, now: Instant = Instant.now()): String {
    val t = parseIsoOrNull(iso) ?: return ""
    val zone = ZoneId.systemDefault()
    val today = LocalDate.ofInstant(now, zone)
    val day = LocalDate.ofInstant(t, zone)
    val daysBetween = Duration.between(day.atStartOfDay(zone), today.atStartOfDay(zone)).toDays()
    return when (daysBetween) {
        0L -> "Today"
        1L -> "Yesterday"
        else -> longDate.format(day)
    }
}

/** "3:45 PM" style for the timestamp under each chat message bubble. */
fun formatMessageTime(iso: String): String {
    val t = parseIsoOrNull(iso) ?: return ""
    return timeFmt.format(t.atZone(ZoneId.systemDefault()))
}

private fun parseIsoOrNull(iso: String?): Instant? = iso?.let {
    runCatching { Instant.parse(it) }.getOrNull()
}

private val timeFmt = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
private val shortDate = DateTimeFormatter.ofPattern("dd/MM/yy", Locale.getDefault())
private val longDate = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault())
