# CYBR Light Progress — Windows app

Double-click `CYBR-Light-Progress.exe`. No installation, browser, Python,
network connection, or additional package is required to run the monitor.
It uses Windows' .NET Framework and reads the existing D: bake folder.

- Refreshes the actual batch state every three seconds.
- Overall progress is completed final views / expected views, not an estimate.
- Red tiles are completed views; the outlined tile is the active checkpoint.
- The moving indicator means the supervisor is running, not a sample percentage.
- With the OptiX supervisor, that indicator becomes a measured current-view
  sample bar, reading the renderer's atomic progress file. GPU timing estimates
  use GPU-completed views only, not the slower CPU history.
- Native CPU and working memory are matched by process ancestry to this batch.
- Remaining time is explicitly approximate, based on median completed-view duration.
- Shows the latest completed PNG without holding a file lock.
- Detects a stopped supervisor or failed batch; does not keep animating as if running.
- Gallery, bake folder, worker log, and always-on-top controls are provided.

This app is read-only. Closing it does not stop the renderer. It never restarts,
pauses, changes quality, or launches an additional bake. The gallery button
requires the existing local portfolio web server; monitoring does not.

Alternate build directory:

```
CYBR-Light-Progress.exe --build D:/CYBR-build/exploded-instrument
```

Rebuild from source: run `powershell.exe -NoProfile -File build.ps1`.
The source uses only framework libraries. The executable is locally built and
unsigned, not an installer or a background service.

QA: the `--snapshot <absolute-png-path>` option opens a test instance, captures
its rendered form and a JSON state record after eight seconds, and exits. The
live test verified the 5/49 state, native renderer ancestry, 0.67 GB working
memory, the active frame, and the latest completed image. The layout was
visually inspected at 858 × 628; it showed no overlapping controls.

GPU QA on 2026-09-22 verified 12/49 completed views, native OptiX process
ancestry, and the measured 16/128 sample count on view 10. The rebuilt window
was visually inspected; it labels GPU timing as calibrating until a production
GPU receipt is available. Renderer RAM is host working memory, not GPU VRAM.

The monitor now queries NVIDIA device 0 (the native renderer's device) every
refresh for utilization and used/total VRAM. These counters include all apps
on that device and are labeled accordingly. The hidden query runs off the UI
thread with a 1.5-second timeout; unavailable readings are not shown as zero.
Live QA verified 97% GPU utilization, 823/8188 MiB VRAM, and 14/49 completed
views. The expanded 858 x 688 window was visually checked for overlap.
