//! Native macOS notifications via UNUserNotificationCenter with click-through.

use block::ConcreteBlock;
use objc::declare::ClassDecl;
use objc::runtime::{Object, Protocol, Sel, BOOL};
use objc::{class, msg_send, sel, sel_impl};
use std::collections::HashMap;
use std::ffi::{c_void, CStr};
use std::sync::{atomic::AtomicU64, atomic::Ordering, Mutex, OnceLock};

// ---- Logging helper ----

fn log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/sh-notif.log")
    {
        let _ = writeln!(f, "{msg}");
    }
}

// ---- Pending URL storage ----

fn pending_urls() -> &'static Mutex<HashMap<String, String>> {
    static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

// ---- ObjC delegate callbacks ----

extern "C" fn did_receive_response(
    _self: &Object,
    _cmd: Sel,
    _center: *mut Object,
    response: *mut Object,
    completion: *const c_void,
) {
    log("[delegate] did_receive_response called");
    unsafe {
        let notification: *mut Object = msg_send![response, notification];
        let request: *mut Object = msg_send![notification, request];
        let identifier: *mut Object = msg_send![request, identifier];
        let cstr: *const i8 = msg_send![identifier, UTF8String];

        if !cstr.is_null() {
            let id_str = CStr::from_ptr(cstr).to_string_lossy().to_string();
            log(&format!("[delegate] notification clicked: {id_str}"));

            if let Ok(mut urls) = pending_urls().lock() {
                if let Some(url) = urls.remove(&id_str) {
                    log(&format!("[delegate] opening URL: {url}"));
                    std::thread::spawn(move || {
                        let _ = open::that(&url);
                    });
                }
            }
        }
        call_void_block(completion);
    }
}

extern "C" fn will_present_notification(
    _self: &Object,
    _cmd: Sel,
    _center: *mut Object,
    _notification: *mut Object,
    completion: *const c_void,
) {
    log("[delegate] will_present called — showing banner");
    unsafe {
        let options: u64 = 16 | 8 | 4 | 2; // banner | list | alert | sound
        call_options_block(completion, options);
    }
}

// ---- Block-calling helpers ----

#[repr(C)]
struct VoidBlock {
    _isa: *const c_void,
    _flags: i32,
    _reserved: i32,
    invoke: unsafe extern "C" fn(*const VoidBlock),
}

#[repr(C)]
struct OptionsBlock {
    _isa: *const c_void,
    _flags: i32,
    _reserved: i32,
    invoke: unsafe extern "C" fn(*const OptionsBlock, u64),
}

unsafe fn call_void_block(ptr: *const c_void) {
    if ptr.is_null() { return; }
    let blk = ptr as *const VoidBlock;
    ((*blk).invoke)(blk);
}

unsafe fn call_options_block(ptr: *const c_void, options: u64) {
    if ptr.is_null() { return; }
    let blk = ptr as *const OptionsBlock;
    ((*blk).invoke)(blk, options);
}

// ---- NSString helper ----

unsafe fn nsstring(s: &str) -> *mut Object {
    let obj: *mut Object = msg_send![class!(NSString), alloc];
    let obj: *mut Object = msg_send![obj,
        initWithBytes: s.as_ptr()
        length: s.len()
        encoding: 4u64 // NSUTF8StringEncoding
    ];
    obj
}

// ---- Public API ----

pub fn setup() {
    log("[setup] starting notification setup");
    unsafe {
        // Build the delegate class
        let superclass = class!(NSObject);
        let mut decl = ClassDecl::new("SHNotifDelegate", superclass)
            .expect("failed to declare SHNotifDelegate class");

        if let Some(proto) = Protocol::get("UNUserNotificationCenterDelegate") {
            decl.add_protocol(proto);
            log("[setup] added UNUserNotificationCenterDelegate protocol");
        } else {
            log("[setup] WARNING: UNUserNotificationCenterDelegate protocol not found");
        }

        decl.add_method(
            sel!(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:),
            did_receive_response
                as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *const c_void),
        );
        decl.add_method(
            sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:),
            will_present_notification
                as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *const c_void),
        );

        let delegate_class = decl.register();
        let delegate: *mut Object = msg_send![delegate_class, new];
        let center: *mut Object =
            msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
        let _: () = msg_send![center, setDelegate: delegate];
        log("[setup] delegate set on notification center");

        // Request notification authorization
        let options: u64 = 4 | 2 | 1; // .alert | .sound | .badge
        let handler = ConcreteBlock::new(move |granted: BOOL, error: *mut Object| {
            if !error.is_null() {
                let desc: *mut Object = msg_send![error, localizedDescription];
                let cstr: *const i8 = msg_send![desc, UTF8String];
                if !cstr.is_null() {
                    let msg = CStr::from_ptr(cstr).to_string_lossy();
                    log(&format!("[setup] auth error: {msg}"));
                }
            }
            log(&format!("[setup] auth granted: {granted}"));
        });
        let handler = handler.copy();
        let _: () = msg_send![center,
            requestAuthorizationWithOptions: options
            completionHandler: &*handler
        ];
        log("[setup] authorization requested");
    }
}

#[tauri::command]
pub fn send_notification(title: String, body: String, url: String) {
    let id = format!("sh_{}", COUNTER.fetch_add(1, Ordering::SeqCst));
    log(&format!("[send] id={id} title={title}"));

    if let Ok(mut urls) = pending_urls().lock() {
        urls.insert(id.clone(), url);
        if urls.len() > 100 {
            if let Some(key) = urls.keys().next().cloned() {
                urls.remove(&key);
            }
        }
    }

    unsafe {
        let center: *mut Object =
            msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];

        let content: *mut Object = msg_send![class!(UNMutableNotificationContent), new];
        let ns_title = nsstring(&title);
        let _: () = msg_send![content, setTitle: ns_title];
        let ns_body = nsstring(&body);
        let _: () = msg_send![content, setBody: ns_body];
        let sound: *mut Object = msg_send![class!(UNNotificationSound), defaultSound];
        let _: () = msg_send![content, setSound: sound];

        let ns_id = nsstring(&id);
        let trigger: *const Object = std::ptr::null();
        let request: *mut Object = msg_send![
            class!(UNNotificationRequest),
            requestWithIdentifier: ns_id
            content: content
            trigger: trigger
        ];

        let handler = ConcreteBlock::new(move |error: *mut Object| {
            if error.is_null() {
                log(&format!("[send] delivered OK"));
            } else {
                let desc: *mut Object = msg_send![error, localizedDescription];
                let cstr: *const i8 = msg_send![desc, UTF8String];
                let msg = if !cstr.is_null() {
                    CStr::from_ptr(cstr).to_string_lossy().to_string()
                } else {
                    "unknown error".to_string()
                };
                log(&format!("[send] delivery ERROR: {msg}"));
            }
        });
        let handler = handler.copy();
        let _: () = msg_send![center,
            addNotificationRequest: request
            withCompletionHandler: &*handler
        ];
        log("[send] request submitted");
    }
}
