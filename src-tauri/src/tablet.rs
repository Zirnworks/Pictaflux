/// Native macOS tablet pressure capture.
///
/// WKWebView does not forward Wacom pen pressure through PointerEvent.
/// We hook into NSEvent directly and emit the real pressure/tilt values
/// to the frontend via a Tauri event.
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask};
use std::ptr::NonNull;
use tauri::{AppHandle, Emitter};

/// Serialized payload for the "native-tablet" event.
#[derive(Clone, serde::Serialize)]
struct TabletPayload {
    pressure: f32,
    tilt_x: f64,
    tilt_y: f64,
}

/// Start monitoring NSEvent for tablet point data.
/// Must be called on the main thread (Tauri setup runs on main).
pub fn start_tablet_monitor(app: AppHandle) {
    let mask = NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::LeftMouseDragged
        | NSEventMask::MouseMoved
        | NSEventMask::TabletPoint;

    let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let ev = unsafe { event.as_ref() };

        // subtype 1 = NSTabletPointEventSubtype
        // subtype() can panic for certain event types, so guard with catch
        let is_tablet = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ev.subtype().0 == 1
        }))
        .unwrap_or(false);

        if is_tablet {
            let pressure = ev.pressure();
            let tilt = ev.tilt();

            let _ = app.emit(
                "native-tablet",
                TabletPayload {
                    pressure,
                    tilt_x: tilt.x,
                    tilt_y: tilt.y,
                },
            );
        }

        event.as_ptr()
    });

    let _monitor: Option<Retained<AnyObject>> = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block)
    };

    // Leak the monitor — it must stay alive for the lifetime of the app.
    // The block is moved into the monitor, so leaking the monitor keeps both alive.
    std::mem::forget(_monitor);
}
