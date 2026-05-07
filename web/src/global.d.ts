/* eslint-disable no-var */
export {};

declare global {
  interface Window {
    /** Set by MainLayout deep-link handler so InboxView can auto-select a notification */
    __pendingInboxNotificationId?: string;
  }
}
