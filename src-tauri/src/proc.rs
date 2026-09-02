//! Cross-platform process control shared by `sidecar.rs` and
//! `process_discovery`: liveness, termination and parent lookup by PID.
//!
//! Unix uses `libc::kill` / `ps`. Windows uses Win32 directly (windows-sys):
//! `OpenProcess` + `GetExitCodeProcess` for liveness, `TerminateProcess` for
//! termination and a Toolhelp32 snapshot for the parent PID. Before this
//! module the Windows side was stubbed (`pid_is_alive` always `true`,
//! `send_signal` a no-op, `parent_pid` `None`), so every shutdown on Windows
//! burned the full grace window, orphan reaping never fired and stale lock
//! files were never pruned.
//!
//! Only the shared surface below is `pub`; the per-OS bodies live in `imp`.

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Signal {
    /// Graceful stop. SIGTERM on Unix. Windows has no graceful signal, so this
    /// is `TerminateProcess` too -- callers that want a graceful stop on
    /// Windows must use the sidecar's `POST /api/shutdown` first.
    Term,
    /// Forced stop. SIGKILL on Unix, `TerminateProcess` on Windows.
    Kill,
}

/// `CREATE_NO_WINDOW` for `Command::creation_flags` -- prevents a console
/// window flashing when a GUI process spawns `powershell`/`cmd`.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub use imp::{parent_pid, pid_is_alive, send_signal};

/// True when `pid`'s parent is gone: reparented to PID 1 on Unix, parent PID
/// no longer alive on Windows (the parent id in the process table is not
/// rewritten when the parent exits).
pub fn is_orphaned(pid: u32) -> bool {
    match parent_pid(pid) {
        None => false,
        Some(ppid) => {
            if cfg!(unix) {
                ppid == 1
            } else {
                !pid_is_alive(ppid)
            }
        }
    }
}

#[cfg(unix)]
mod imp {
    use super::Signal;

    /// `kill(pid, 0)` succeeds when the process exists and we may signal it.
    /// EPERM means it exists but belongs to another user -- still alive.
    /// errno is captured immediately after the call (0832 F-003).
    pub fn pid_is_alive(pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
        if rc == 0 {
            return true;
        }
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }

    pub fn send_signal(pid: u32, sig: Signal) {
        let signum = match sig {
            Signal::Term => libc::SIGTERM,
            Signal::Kill => libc::SIGKILL,
        };
        unsafe {
            libc::kill(pid as libc::pid_t, signum);
        }
    }

    pub fn parent_pid(pid: u32) -> Option<u32> {
        let output = std::process::Command::new("ps")
            .args(["-o", "ppid=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout).trim().parse().ok()
    }
}

#[cfg(windows)]
mod imp {
    use super::Signal;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE,
    };

    const ERROR_ACCESS_DENIED: i32 = 5;

    /// Owned Win32 handle; closed on drop.
    struct Handle(HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: the handle was returned by OpenProcess /
            // CreateToolhelp32Snapshot and is closed exactly once here.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    fn open(pid: u32, access: u32) -> Option<Handle> {
        // SAFETY: plain Win32 call; a null return means failure.
        let h = unsafe { OpenProcess(access, 0, pid) };
        if h.is_null() {
            None
        } else {
            Some(Handle(h))
        }
    }

    pub fn pid_is_alive(pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        let Some(h) = open(pid, PROCESS_QUERY_LIMITED_INFORMATION) else {
            // ERROR_ACCESS_DENIED: the process exists but is protected (other
            // session / elevated). Treat as alive, mirroring EPERM on Unix.
            // ERROR_INVALID_PARAMETER: no such process.
            return std::io::Error::last_os_error().raw_os_error() == Some(ERROR_ACCESS_DENIED);
        };
        let mut code: u32 = 0;
        // SAFETY: `h` is a valid process handle with QUERY_LIMITED_INFORMATION
        // and `code` outlives the call.
        let ok = unsafe { GetExitCodeProcess(h.0, &mut code) };
        ok != 0 && code == STILL_ACTIVE as u32
    }

    pub fn send_signal(pid: u32, _sig: Signal) {
        if pid == 0 {
            return;
        }
        if let Some(h) = open(pid, PROCESS_TERMINATE) {
            // SAFETY: `h` carries PROCESS_TERMINATE; exit code 1 mirrors the
            // Unix "killed" convention closely enough for our supervisor.
            unsafe {
                TerminateProcess(h.0, 1);
            }
        }
    }

    pub fn parent_pid(pid: u32) -> Option<u32> {
        // SAFETY: plain Win32 call; INVALID_HANDLE_VALUE means failure.
        let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if raw == INVALID_HANDLE_VALUE || raw.is_null() {
            return None;
        }
        let snap = Handle(raw);
        // SAFETY: PROCESSENTRY32 is plain-old-data; dwSize must be set before
        // the first call per the Toolhelp contract.
        let mut entry: PROCESSENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;
        // SAFETY: `snap` is a valid snapshot handle, `entry` is initialised.
        if unsafe { Process32First(snap.0, &mut entry) } == 0 {
            return None;
        }
        loop {
            if entry.th32ProcessID == pid {
                return Some(entry.th32ParentProcessID);
            }
            // SAFETY: same as above; returns 0 at the end of the list.
            if unsafe { Process32Next(snap.0, &mut entry) } == 0 {
                return None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn own_pid_is_alive_and_has_a_parent() {
        let me = std::process::id();
        assert!(pid_is_alive(me));
        let ppid = parent_pid(me).expect("parent pid resolvable");
        assert_ne!(ppid, me);
    }

    #[test]
    fn nonexistent_pid_is_not_alive() {
        // PID 999_999_999 isn't a valid pid on any real system (Linux caps at
        // 4_194_304, Windows pids are multiples of 4 well below this).
        assert!(!pid_is_alive(999_999_999));
        assert!(!pid_is_alive(0));
    }

    #[test]
    fn send_signal_kill_terminates_a_child() {
        // Cross-platform long-running child: `sleep` on Unix, `ping` on Windows
        // (the `timeout` builtin needs a console with stdin).
        let mut child = if cfg!(windows) {
            std::process::Command::new("ping")
                .args(["-n", "30", "127.0.0.1"])
                .stdout(std::process::Stdio::null())
                .spawn()
                .expect("spawn ping")
        } else {
            std::process::Command::new("sleep")
                .arg("30")
                .spawn()
                .expect("spawn sleep")
        };
        let pid = child.id();
        assert!(pid_is_alive(pid));
        assert_eq!(parent_pid(pid), Some(std::process::id()));

        send_signal(pid, Signal::Kill);

        let started = Instant::now();
        let mut reaped = false;
        while started.elapsed() < Duration::from_secs(5) {
            if child.try_wait().expect("try_wait").is_some() {
                reaped = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(reaped, "child did not exit within 5 s after send_signal(Kill)");
        assert!(!pid_is_alive(pid));
    }
}
