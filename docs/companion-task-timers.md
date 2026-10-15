# Companion task timers

The companion's Timer tab mirrors task clocks from an open, signed-in SquadHub web app. Keep a browser tab open (it can be in the background). When that browser disconnects, task controls become unavailable; work/break/no-work clocks continue to use the server APIs independently. Pending "Start timer" tasks created in Quick Add are picked up by the existing browser handoff, including from a background tab.

The server relays `companion_timer_*` socket events only within the authenticated user's connections. A browser publishes snapshots every ten seconds and on state changes. One browser owns commands, so multiple tabs do not each log the same stop. Requests and browser execution are deduplicated by request ID. Disconnects, invalid selections, timeouts and failures are returned explicitly.

Pause closes the current task segment through `useParallelTimers.stopTimer`, preserving parallel splits, work-block/group-run accounting and the persistent offline upload queue. The paused task and elapsed display are saved in the existing PM store. Resume switches the work clock to Work and starts a fresh task segment while preserving the displayed session. Stop on a paused task clears the saved pause without logging it again. Switching to Break or No work from the companion pauses running tasks before changing the work clock.

The notch renders actual titles, estimates and list names. It seeds 30-minute reminder marks from the first snapshot, so reconnecting or launching does not replay old milestones. No sample tasks are included in the production build.

Validation:

- Relay integration tests cover user isolation, one executor across multiple browser tabs, request retry deduplication, stale task selection and missing acknowledgments/disconnects.
- Browser-owner tests use the real PM store and verify parallel split accounting, excluded paused time, resume identity and stopping a paused task without double logging.
- UI review uses an isolated local preview with mocked native APIs and sample data, without changing live tasks or timesheets.
