# My Home time calendar

Start the local preview with `npm run dev:preview -w web`, then open:

http://localhost:3010/time-preview?theme=dark&calendar=open

This route uses clearly labeled sample data and the same calendar component as
My Home. Close the drawer and click the percentage ring to open it again. Day and
week views, date selection, category filters, session details, and local timer
controls are interactive. Sample timers reset when the page reloads.

My Home uses authenticated, workspace-scoped attendance sessions and task time
entries, plus active task/work-block timers. History is fetched for the displayed
range, including sessions that cross midnight. Calendar dates use IST to match
SquadHub attendance and office timing. Overtime is attendance work beyond the
current daily office-hours commitment; task and work-block totals are shown
separately because they can overlap attendance.

Run the calculation tests from the repository root:

```sh
./node_modules/.bin/tsx --test web/src/components/time-activity/__tests__/activityModel.test.ts
```
