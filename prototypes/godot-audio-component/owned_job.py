"""Run only the requested executable tree inside a Windows kill-on-close job."""
import _winapi
import ctypes as c
from ctypes import wintypes as w
import os
import subprocess

kernel=c.WinDLL("kernel32",use_last_error=True)
def bind(name,args,restype):
    fn=getattr(kernel,name)
    fn.argtypes=args
    fn.restype=restype
    return fn
create=bind("CreateJobObjectW",[c.c_void_p,w.LPCWSTR],w.HANDLE)
configure=bind("SetInformationJobObject",[w.HANDLE,c.c_int,c.c_void_p,w.DWORD],w.BOOL)
assign=bind("AssignProcessToJobObject",[w.HANDLE,w.HANDLE],w.BOOL)
resume=bind("ResumeThread",[w.HANDLE],w.DWORD)
close=bind("CloseHandle",[w.HANDLE],w.BOOL)
class Basic(c.Structure):
    _fields_=[("perTask",c.c_longlong),("perJob",c.c_longlong),("flags",w.DWORD),
              ("min",c.c_size_t),("max",c.c_size_t),("active",w.DWORD),("affinity",c.c_size_t),
              ("priority",w.DWORD),("scheduler",w.DWORD)]
class IO(c.Structure):
    _fields_=[(k,c.c_ulonglong) for k in ("reads","writes","other","readBytes","writeBytes","otherBytes")]
class Limits(c.Structure):
    _fields_=[("basic",Basic),("io",IO),("processBytes",c.c_size_t),("jobBytes",c.c_size_t),
              ("peakProcess",c.c_size_t),("peakJob",c.c_size_t)]

def launch(argv,cwd,timeout_ms=20000):
    job=create(None,None)
    if not job:raise c.WinError(c.get_last_error())
    proc=thread=None
    attached=False
    try:
        limits=Limits()
        limits.basic.flags=0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not configure(job,9,c.byref(limits),c.sizeof(limits)):raise c.WinError(c.get_last_error())
        proc,thread,pid,_=_winapi.CreateProcess(argv[0],subprocess.list2cmdline(argv),None,None,False,
            subprocess.CREATE_NO_WINDOW|4,None,str(cwd),subprocess.STARTUPINFO())
        if not assign(job,proc):raise c.WinError(c.get_last_error())
        attached=True
        if resume(thread)==0xffffffff:raise c.WinError(c.get_last_error())
        if _winapi.WaitForSingleObject(proc,timeout_ms)!=0:raise TimeoutError(f"Owned process {pid} exceeded {timeout_ms} ms")
        status=_winapi.GetExitCodeProcess(proc)
        if status:raise RuntimeError(f"Owned process {pid} exited with {status}")
        return pid
    finally:
        if proc and not attached:_winapi.TerminateProcess(proc,1)
        close(job)
        if proc:
            _winapi.WaitForSingleObject(proc,2000)
            _winapi.CloseHandle(proc)
        if thread:_winapi.CloseHandle(thread)
